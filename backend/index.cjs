const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { config } = require('./config/env.cjs')
const { createDatabase } = require('./data/sqlite.cjs')
const { runMigrations } = require('./data/migrations.cjs')
const { createUserRepository } = require('./data/userRepository.cjs')
const { createSessionRepository } = require('./data/sessionRepository.cjs')
const { createRecordRepository } = require('./data/recordRepository.cjs')
const { createAuthService } = require('./services/authService.cjs')
const { createSyncService } = require('./services/syncService.cjs')
const { createAuthHandlers } = require('./http/handlers/authHandlers.cjs')
const { createSyncHandlers } = require('./http/handlers/syncHandlers.cjs')
const { createRouter } = require('./http/router.cjs')
const { sendJson } = require('./http/sendJson.cjs')
const { createRateLimiter } = require('./http/rateLimiter.cjs')
const { createLogger } = require('./logging.cjs')
const { startBackupScheduler } = require('./operations/backupScheduler.cjs')
const { getBackupStatus } = require('./operations/backups.cjs')

function createBackend(runtimeConfig = config) {
  if (runtimeConfig.nodeEnv === 'production' && runtimeConfig.authMode !== 'password-only') {
    throw new Error('Unsafe authentication configuration: production requires password-only authentication.')
  }
  if (runtimeConfig.nodeEnv === 'production' && runtimeConfig.tlsTerminated === true && !(runtimeConfig.trustedProxies?.length > 0)) {
    throw new Error('Unsafe proxy configuration: production TLS termination requires trusted proxies.')
  }
  const db = createDatabase(runtimeConfig.databasePath)
  const activityLockPath = `${runtimeConfig.databasePath}.backend.lock`
  fs.writeFileSync(activityLockPath, String(process.pid), { flag: 'wx' })
  try {
    runMigrations(db)
  } catch (error) {
    db.sqlite.close()
    if (fs.existsSync(activityLockPath)) fs.unlinkSync(activityLockPath)
    throw error
  }
  const userRepository = createUserRepository(db)
  const sessionRepository = createSessionRepository(db)
  const recordRepository = createRecordRepository(db)
  const authService = createAuthService({ config: runtimeConfig, userRepository, sessionRepository })
  const syncService = createSyncService({ recordRepository })
  const logger = createLogger(runtimeConfig.logLevel)
  const backupDirectory = runtimeConfig.backupDirectory ?? path.join(path.dirname(runtimeConfig.databasePath), 'backups')
  const backupScheduler = startBackupScheduler({
    databasePath: runtimeConfig.databasePath,
    backupDirectory,
    intervalHours: runtimeConfig.backupIntervalHours,
    minimumFreeBytes: (runtimeConfig.backupMinimumFreeMb ?? 256) * 1024 * 1024,
    retentionPolicy: { hourlyHours: runtimeConfig.backupHourlyHours ?? 24, dailyDays: runtimeConfig.backupDailyDays ?? 30, weeklyWeeks: runtimeConfig.backupWeeklyWeeks ?? 12 },
    logger
  })
  const loginLimiter = createRateLimiter({ limit: 8, windowMs: 15 * 60 * 1000 })
  const requestLimiter = createRateLimiter({ limit: 120, windowMs: 60 * 1000 })
  const registrationLimiter = createRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000, maxKeys: 10_000 })
  const globalRegistrationLimiter = createRateLimiter({ limit: 100, windowMs: 60 * 60 * 1000, maxKeys: 1 })
  const authHandlers = createAuthHandlers({ authService, sendJson, loginLimiter, registrationLimiter, globalRegistrationLimiter })
  const syncHandlers = createSyncHandlers({ authService, syncService, sendJson })
  const router = createRouter({
    authHandlers,
    syncHandlers,
    backendInfo: { authMode: runtimeConfig.authMode, database: 'sqlite', nodeEnv: runtimeConfig.nodeEnv, requireHttps: runtimeConfig.tlsTerminated === true, trustedProxies: runtimeConfig.trustedProxies ?? [], backupStatus: () => getBackupStatus(backupDirectory) },
    requestLimiter,
    logger
  })
  const server = http.createServer((request, response) => void router(request, response))
  server.on('close', () => { if (fs.existsSync(activityLockPath)) fs.unlinkSync(activityLockPath) })
  server.requestTimeout = 15_000
  server.headersTimeout = 10_000
  server.keepAliveTimeout = 5_000
  return { db, server, backupScheduler }
}

function startBackend(runtimeConfig = config) {
  const backend = createBackend(runtimeConfig)
  backend.server.listen(runtimeConfig.port, runtimeConfig.host, () => {
    console.log(`[backend] MoneyWise sync backend listening on http://${runtimeConfig.host}:${runtimeConfig.port}`)
    console.log(`[backend] Auth mode: ${runtimeConfig.authMode}`)
    console.log(`[backend] Database: sqlite -> ${runtimeConfig.databasePath}`)
  })
  return backend
}

if (require.main === module) {
  const backend = startBackend(config)
  function shutdown(signal) {
    console.log(`[backend] Received ${signal}, shutting down`)
    backend.server.close(() => {
      backend.backupScheduler.stop()
      backend.db.sqlite.close()
      process.exit(0)
    })
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

module.exports = { createBackend, startBackend }
