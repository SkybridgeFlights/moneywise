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

const productionEnvironment = process.env.NODE_ENV === 'production'
const allowEnvironmentFiles = process.env.MONEYWISE_ALLOW_ENV_FILES === 'true'
if (!productionEnvironment || allowEnvironmentFiles) {
  loadEnvFile(path.resolve(process.cwd(), '.env'))
  loadEnvFile(path.resolve(process.cwd(), '.env.backend'))
}

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

function getBoolean(name, fallback = false) {
  const value = process.env[name]
  if (value === undefined) return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be true or false.`)
}

const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: getNumber('PORT', getNumber('MONEYWISE_BACKEND_PORT', 8787)),
  host: getFirstValue('HOST', 'MONEYWISE_BACKEND_HOST') ?? '0.0.0.0',
  databasePath: path.resolve(process.cwd(), getFirstValue('DATABASE_PATH', 'MONEYWISE_BACKEND_DB_PATH') ?? 'backend-data/moneywise-sync.sqlite'),
  sessionTtlDays: getNumber('MONEYWISE_BACKEND_SESSION_TTL_DAYS', 30),
  accessTokenTtlMinutes: getNumber('MONEYWISE_BACKEND_ACCESS_TOKEN_TTL_MINUTES', 15),
  authMode: process.env.MONEYWISE_BACKEND_AUTH_MODE ?? (process.env.NODE_ENV === 'production' ? 'password-only' : 'hybrid'),
  logLevel: process.env.MONEYWISE_BACKEND_LOG_LEVEL ?? 'info',
  authSecret: getFirstValue('AUTH_SECRET', 'MONEYWISE_BACKEND_AUTH_SECRET') ?? 'moneywise-dev-secret-change-me',
  publicBaseUrl: getFirstValue('PUBLIC_BASE_URL', 'MONEYWISE_PUBLIC_BASE_URL', 'RENDER_EXTERNAL_URL'),
  tlsTerminated: getBoolean('MONEYWISE_TLS_TERMINATED'),
  backupDirectory: path.resolve(process.cwd(), getFirstValue('BACKUP_DIRECTORY', 'MONEYWISE_BACKUP_DIRECTORY') ?? 'backend-data/backups'),
  backupMaxAgeHours: getNumber('MONEYWISE_BACKUP_MAX_AGE_HOURS', 24),
  backupIntervalHours: getNumber('MONEYWISE_BACKUP_INTERVAL_HOURS', 24)
  ,backupMinimumFreeMb: getNumber('MONEYWISE_BACKUP_MIN_FREE_MB', 256)
  ,backupHourlyHours: getNumber('MONEYWISE_BACKUP_KEEP_HOURLY_HOURS', 24)
  ,backupDailyDays: getNumber('MONEYWISE_BACKUP_KEEP_DAILY_DAYS', 30)
  ,backupWeeklyWeeks: getNumber('MONEYWISE_BACKUP_KEEP_WEEKLY_WEEKS', 12)
  ,trustedProxies: (getFirstValue('MONEYWISE_TRUSTED_PROXIES') ?? '').split(',').map((value) => value.trim()).filter(Boolean)
}

if (!['password-only', 'hybrid'].includes(config.authMode)) {
  throw new Error('MONEYWISE_BACKEND_AUTH_MODE must be password-only or hybrid.')
}
if (config.nodeEnv === 'production' && config.authMode !== 'password-only') {
  throw new Error('Unsafe authentication configuration: production requires MONEYWISE_BACKEND_AUTH_MODE=password-only.')
}
if (config.nodeEnv === 'production' && (!config.authSecret || config.authSecret.length < 32 || config.authSecret === 'moneywise-dev-secret-change-me' || config.authSecret === 'change-me')) {
  throw new Error('Unsafe authentication configuration: production requires AUTH_SECRET with at least 32 characters.')
}
if (config.nodeEnv === 'production' && (!config.publicBaseUrl || !config.publicBaseUrl.startsWith('https://'))) {
  throw new Error('Unsafe transport configuration: production requires PUBLIC_BASE_URL (or RENDER_EXTERNAL_URL) using https://.')
}
if (config.nodeEnv === 'production' && !config.tlsTerminated) {
  throw new Error('Unsafe transport configuration: production requires MONEYWISE_TLS_TERMINATED=true behind the trusted TLS proxy.')
}
if (config.nodeEnv === 'production' && config.tlsTerminated && config.trustedProxies.length === 0) {
  throw new Error('Unsafe proxy configuration: production requires MONEYWISE_TRUSTED_PROXIES.')
}
if (config.nodeEnv === 'production' && (config.accessTokenTtlMinutes < 1 || config.accessTokenTtlMinutes > 30)) {
  throw new Error('Unsafe authentication configuration: access token TTL must be between 1 and 30 minutes.')
}
if (config.nodeEnv === 'production' && (config.sessionTtlDays < 1 || config.sessionTtlDays > 90)) {
  throw new Error('Unsafe authentication configuration: session TTL must be between 1 and 90 days.')
}
if (config.nodeEnv === 'production' && (config.backupMaxAgeHours < 1 || config.backupMaxAgeHours > 168)) {
  throw new Error('Unsafe backup configuration: MONEYWISE_BACKUP_MAX_AGE_HOURS must be between 1 and 168.')
}
if (config.nodeEnv === 'production' && (config.backupIntervalHours < 1 || config.backupIntervalHours > config.backupMaxAgeHours)) {
  throw new Error('Unsafe backup configuration: backup interval must be positive and no greater than maximum backup age.')
}
if (config.nodeEnv === 'production' && (config.backupMinimumFreeMb < 64 || config.backupHourlyHours < 1 || config.backupDailyDays < 1 || config.backupWeeklyWeeks < 1)) {
  throw new Error('Unsafe backup retention configuration.')
}

module.exports = {
  config
}
