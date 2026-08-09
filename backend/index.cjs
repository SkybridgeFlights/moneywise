const http = require('node:http')
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

function createBackend(runtimeConfig = config) {
  if (runtimeConfig.nodeEnv === 'production' && runtimeConfig.authMode !== 'password-only') {
    throw new Error('Unsafe authentication configuration: production requires password-only authentication.')
  }
  const db = createDatabase(runtimeConfig.databasePath)
  runMigrations(db)
  const userRepository = createUserRepository(db)
  const sessionRepository = createSessionRepository(db)
  const recordRepository = createRecordRepository(db)
  const authService = createAuthService({ config: runtimeConfig, userRepository, sessionRepository })
  const syncService = createSyncService({ recordRepository })
  const authHandlers = createAuthHandlers({ authService, sendJson })
  const syncHandlers = createSyncHandlers({ authService, syncService, sendJson })
  const router = createRouter({
    authHandlers,
    syncHandlers,
    backendInfo: { authMode: runtimeConfig.authMode, database: 'sqlite' }
  })
  const server = http.createServer((request, response) => void router(request, response))
  return { db, server }
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
      backend.db.sqlite.close()
      process.exit(0)
    })
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

module.exports = { createBackend, startBackend }
