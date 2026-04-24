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

const db = createDatabase(config.databasePath)
runMigrations(db)

const userRepository = createUserRepository(db)
const sessionRepository = createSessionRepository(db)
const recordRepository = createRecordRepository(db)
const authService = createAuthService({ config, userRepository, sessionRepository })
const syncService = createSyncService({ recordRepository })

const authHandlers = createAuthHandlers({ authService, sendJson })
const syncHandlers = createSyncHandlers({ authService, syncService, sendJson })
const router = createRouter({
  authHandlers,
  syncHandlers,
  backendInfo: {
    authMode: config.authMode,
    database: 'sqlite'
  }
})

const server = http.createServer((request, response) => {
  void router(request, response)
})

server.listen(config.port, config.host, () => {
  console.log(`[backend] MoneyWise sync backend listening on http://${config.host}:${config.port}`)
  console.log(`[backend] Auth mode: ${config.authMode}`)
  console.log(`[backend] Database: sqlite -> ${config.databasePath}`)
})

function shutdown(signal) {
  console.log(`[backend] Received ${signal}, shutting down`)
  try {
    db.sqlite.close()
  } finally {
    server.close(() => process.exit(0))
  }
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
