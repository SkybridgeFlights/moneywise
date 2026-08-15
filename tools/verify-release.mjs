import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const allowUnsigned = process.argv.includes('--allow-unsigned')
const checks = []
const failures = []

function check(name, operation) {
  try {
    const detail = operation()
    checks.push({ name, status: 'passed', detail: detail ?? null })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    checks.push({ name, status: 'failed', detail: message })
    failures.push(`${name}: ${message}`)
  }
}

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function newestModifiedTime(target) {
  const stat = fs.statSync(target)
  if (!stat.isDirectory()) return stat.mtimeMs
  return Math.max(stat.mtimeMs, ...fs.readdirSync(target).map((entry) => newestModifiedTime(path.join(target, entry))))
}

check('runtime', () => {
  const major = Number(process.versions.node.split('.')[0])
  if (major < 24) throw new Error(`Node 24 or newer is required; found ${process.version}.`)
  return process.version
})

check('builder configuration', () => {
  if (packageJson.build?.win?.signAndEditExecutable === false) throw new Error('Windows executable signing is explicitly disabled.')
  if (!packageJson.build?.win?.icon || !fs.existsSync(path.join(root, packageJson.build.win.icon))) throw new Error('Windows application icon is missing.')
  const targets = packageJson.build?.win?.target ?? []
  if (!targets.includes('nsis') || !targets.includes('portable')) throw new Error('Both NSIS and portable Windows targets are required.')
  return { targets, forceCodeSigning: packageJson.build.forceCodeSigning === true }
})

check('production environment', () => {
  if (allowUnsigned) return 'not required for unsigned packaging validation'
  if (required('NODE_ENV') !== 'production') throw new Error('NODE_ENV must equal production.')
  if (required('MONEYWISE_BACKEND_AUTH_MODE') !== 'password-only') throw new Error('MONEYWISE_BACKEND_AUTH_MODE must equal password-only.')
  if (required('AUTH_SECRET').length < 32) throw new Error('AUTH_SECRET must contain at least 32 characters.')
  const publicUrl = required('PUBLIC_BASE_URL')
  if (!publicUrl.startsWith('https://')) throw new Error('PUBLIC_BASE_URL must use HTTPS.')
  if (required('MONEYWISE_TLS_TERMINATED') !== 'true') throw new Error('MONEYWISE_TLS_TERMINATED must equal true.')
  const databasePath = required('DATABASE_PATH')
  const backupDirectory = required('BACKUP_DIRECTORY')
  if (!path.isAbsolute(databasePath) || !path.isAbsolute(backupDirectory)) throw new Error('DATABASE_PATH and BACKUP_DIRECTORY must be absolute persistent-volume paths.')
  if (path.dirname(databasePath) === backupDirectory) throw new Error('Backups must use a directory distinct from the live database directory.')
  return { publicUrl, databasePath, backupDirectory }
})

check('client environment consistency', () => {
  if (allowUnsigned) return 'not required for unsigned packaging validation'
  if (required('MONEYWISE_SYNC_ENABLED') !== 'true' || required('EXPO_PUBLIC_MONEYWISE_SYNC_ENABLED') !== 'true') {
    throw new Error('Desktop and mobile synchronization must both be enabled for a production release.')
  }
  const backend = new URL(required('PUBLIC_BASE_URL'))
  const desktop = new URL(required('MONEYWISE_SYNC_URL'))
  const mobile = new URL(required('EXPO_PUBLIC_MONEYWISE_SYNC_URL'))
  if (![desktop, mobile].every((url) => url.protocol === 'https:' && url.origin === backend.origin)) {
    throw new Error('Desktop and mobile synchronization URLs must use the production HTTPS origin.')
  }
  return backend.origin
})

check('backend startup validation', () => {
  if (allowUnsigned) return 'covered by backend integration tests'
  const result = spawnSync(process.execPath, ['-e', "require('./config/env.cjs')"], { cwd: path.join(root, 'backend'), env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8' })
  if (result.status !== 0) throw new Error((result.stderr || result.stdout).trim())
  return 'production environment accepted'
})

check('migrations and backup mechanism', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'moneywise-release-verify-'))
  try {
    const databasePath = path.join(temp, 'migration.sqlite')
    const backupDirectory = path.join(temp, 'backups')
    const { createDatabase } = require('../backend/data/sqlite.cjs')
    const { runMigrations } = require('../backend/data/migrations.cjs')
    const { createBackup, verifyBackup } = require('../backend/operations/backups.cjs')
    const db = createDatabase(databasePath)
    runMigrations(db)
    const version = db.sqlite.pragma('user_version', { simple: true })
    db.sqlite.close()
    if (version !== 2) throw new Error(`Unexpected schema version ${version}.`)
    return createBackup(databasePath, backupDirectory)
      .then(({ backupPath }) => {
        verifyBackup(backupPath, 1)
        return { schemaVersion: version, backupVerified: true }
      })
      .finally(() => fs.rmSync(temp, { recursive: true, force: true }))
  } finally {
    // Cleanup occurs after the asynchronous SQLite backup settles.
  }
})

if (!allowUnsigned) {
  check('production backup availability', () => {
    const { findLatestBackup, verifyBackup } = require('../backend/operations/backups.cjs')
    const directory = path.resolve(required('BACKUP_DIRECTORY'))
    const latest = findLatestBackup(directory)
    if (!latest) throw new Error(`No backup exists in ${directory}.`)
    const verified = verifyBackup(latest, Number(process.env.MONEYWISE_BACKUP_MAX_AGE_HOURS ?? 24))
    return { backup: latest, ageHours: verified.ageHours }
  })
}

const expectedArtifacts = [
  path.join(root, 'release', `MoneyWise Setup ${packageJson.version}.exe`),
  path.join(root, 'release', `MoneyWise ${packageJson.version}.exe`)
]
check('Windows artifacts', () => expectedArtifacts.map((filePath) => {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 1_000_000) throw new Error(`Missing or implausibly small artifact: ${filePath}`)
  const newestInput = Math.max(newestModifiedTime(path.join(root, 'src')), newestModifiedTime(path.join(root, 'build')), fs.statSync(path.join(root, 'package.json')).mtimeMs)
  if (fs.statSync(filePath).mtimeMs < newestInput) throw new Error(`Artifact predates a release input and must be rebuilt: ${filePath}`)
  return { file: path.basename(filePath), bytes: fs.statSync(filePath).size, sha256: sha256(filePath) }
}))

check('packaged public sync configuration', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'main', 'sync-config.ts'), 'utf8')
  const match = source.match(/PRODUCTION_SYNC_BACKEND_URL\s*=\s*['"]([^'"]+)['"]/)
  if (!match) throw new Error('Authoritative production sync URL is missing.')
  const endpoint = new URL(match[1])
  if (endpoint.protocol !== 'https:' || endpoint.origin !== match[1]) throw new Error('Production sync URL must be an HTTPS origin.')
  const asarPath = path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar')
  if (!fs.existsSync(asarPath)) throw new Error('Packaged ASAR is missing.')
  const { extractFile } = require('@electron/asar')
  const bundledMain = extractFile(asarPath, path.join('out', 'main', 'index.js')).toString('utf8')
  if (!bundledMain.includes(match[1]) || !bundledMain.includes('packaged-production')) {
    throw new Error('Packaged main process does not contain the validated production sync configuration.')
  }
  return { endpoint: endpoint.origin, enabledWithoutEnvironment: true }
})

check('signing environment', () => {
  const link = process.env.CSC_LINK?.trim()
  const password = process.env.CSC_KEY_PASSWORD?.trim()
  if (Boolean(link) !== Boolean(password)) throw new Error('CSC_LINK and CSC_KEY_PASSWORD must be supplied together.')
  if (!allowUnsigned && (!link || !password)) throw new Error('Signed production releases require CSC_LINK and CSC_KEY_PASSWORD.')
  if (link && !fs.existsSync(link) && !/^https:\/\//i.test(link) && !/^data:/i.test(link) && link.length < 512) {
    throw new Error('CSC_LINK is neither an existing file nor a supported protected URL/base64 certificate value.')
  }
  return link ? 'signing credentials supplied' : 'unsigned validation mode'
})

check('Authenticode signatures', () => {
  if (process.platform !== 'win32') {
    if (!allowUnsigned) throw new Error('Strict Authenticode validation must run on Windows.')
    return 'skipped on non-Windows unsigned validation'
  }
  const quoted = expectedArtifacts.map((filePath) => `'${filePath.replaceAll("'", "''")}'`).join(',')
  const command = `Get-AuthenticodeSignature -FilePath ${quoted} | ForEach-Object { $_.Status.ToString() }`
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'Authenticode inspection failed.')
  const statuses = result.stdout.trim().split(/\r?\n/).filter(Boolean)
  if (!allowUnsigned && (statuses.length !== expectedArtifacts.length || statuses.some((status) => status !== 'Valid'))) {
    throw new Error(`Every production artifact must have a Valid signature; found ${statuses.join(', ') || 'none'}.`)
  }
  if (allowUnsigned && statuses.some((status) => !['Valid', 'NotSigned'].includes(status))) throw new Error(`Unexpected signature state: ${statuses.join(', ')}.`)
  return statuses
})

const settled = await Promise.all(checks.map(async (entry) => {
  if (entry.detail && typeof entry.detail.then === 'function') {
    try { entry.detail = await entry.detail } catch (error) { entry.status = 'failed'; entry.detail = error.message; failures.push(`${entry.name}: ${error.message}`) }
  }
  return entry
}))
const report = { generatedAt: new Date().toISOString(), mode: allowUnsigned ? 'unsigned-validation' : 'production', version: packageJson.version, passed: failures.length === 0, checks: settled }
fs.mkdirSync(path.join(root, 'release'), { recursive: true })
fs.writeFileSync(path.join(root, 'release', 'release-validation.json'), `${JSON.stringify(report, null, 2)}\n`)
settled.forEach((entry) => console.log(`${entry.status === 'passed' ? 'PASS' : 'FAIL'} ${entry.name}${entry.detail ? `: ${JSON.stringify(entry.detail)}` : ''}`))
if (failures.length) {
  console.error(`Release validation failed with ${failures.length} condition(s).`)
  process.exitCode = 1
} else {
  console.log(`Release validation passed in ${report.mode} mode.`)
}
