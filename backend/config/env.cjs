const fs = require('node:fs')
const path = require('node:path')

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return
  }

  const content = fs.readFileSync(filePath, 'utf8')
  content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .forEach((line) => {
      const separator = line.indexOf('=')
      const key = line.slice(0, separator).trim()
      const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')
      if (!process.env[key]) {
        process.env[key] = value
      }
    })
}

loadEnvFile(path.resolve(process.cwd(), '.env'))
loadEnvFile(path.resolve(process.cwd(), '.env.backend'))

function getNumber(name, fallback) {
  const value = Number(process.env[name] ?? fallback)
  return Number.isFinite(value) ? value : fallback
}

function getFirstValue(...names) {
  for (const name of names) {
    const value = process.env[name]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return null
}

const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: getNumber('PORT', getNumber('MONEYWISE_BACKEND_PORT', 8787)),
  host: getFirstValue('HOST', 'MONEYWISE_BACKEND_HOST') ?? '0.0.0.0',
  databasePath: path.resolve(process.cwd(), getFirstValue('DATABASE_PATH', 'MONEYWISE_BACKEND_DB_PATH') ?? 'backend-data/moneywise-sync.sqlite'),
  sessionTtlDays: getNumber('MONEYWISE_BACKEND_SESSION_TTL_DAYS', 30),
  authMode: process.env.MONEYWISE_BACKEND_AUTH_MODE ?? 'hybrid',
  logLevel: process.env.MONEYWISE_BACKEND_LOG_LEVEL ?? 'info',
  authSecret: getFirstValue('AUTH_SECRET', 'MONEYWISE_BACKEND_AUTH_SECRET') ?? 'moneywise-dev-secret-change-me'
}

module.exports = {
  config
}
