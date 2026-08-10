const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const BetterSqlite3 = require('better-sqlite3')

function checksum(filePath) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function assertInsideDirectory(candidate, directory) {
  const root = `${path.resolve(directory)}${path.sep}`
  const resolved = path.resolve(candidate)
  if (!resolved.startsWith(root)) throw new Error(`Backup path escapes configured directory: ${resolved}`)
  return resolved
}

function availableBytes(directory) {
  fs.mkdirSync(directory, { recursive: true })
  const stats = fs.statfsSync(directory)
  return Number(stats.bavail) * Number(stats.bsize)
}

function assertHealthyDatabase(filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) throw new Error(`SQLite database is missing or empty: ${filePath}`)
  const database = new BetterSqlite3(filePath, { readonly: true, fileMustExist: true })
  try {
    const result = database.pragma('integrity_check', { simple: true })
    if (result !== 'ok') throw new Error(`SQLite integrity check failed: ${result}`)
  } finally {
    database.close()
  }
}

async function createBackup(databasePath, backupDirectory, now = new Date(), options = {}) {
  assertHealthyDatabase(databasePath)
  fs.mkdirSync(backupDirectory, { recursive: true })
  const minimumFreeBytes = options.minimumFreeBytes ?? 0
  const requiredBytes = fs.statSync(databasePath).size + minimumFreeBytes
  const freeBytes = availableBytes(backupDirectory)
  if (freeBytes < requiredBytes) {
    const error = new Error(`Backup aborted: ${freeBytes} bytes available; ${requiredBytes} bytes required including safety reserve.`)
    error.code = 'insufficient_backup_space'
    throw error
  }
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(backupDirectory, `moneywise-${stamp}.sqlite`)
  const database = new BetterSqlite3(databasePath, { fileMustExist: true })
  try {
    await database.backup(backupPath)
  } finally {
    database.close()
  }
  assertHealthyDatabase(backupPath)
  const manifest = {
    format: 1,
    createdAt: now.toISOString(),
    source: path.basename(databasePath),
    backup: path.basename(backupPath),
    bytes: fs.statSync(backupPath).size,
    sha256: checksum(backupPath)
  }
  fs.writeFileSync(`${backupPath}.json`, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  return { backupPath, manifest }
}

function listBackups(backupDirectory) {
  if (!fs.existsSync(backupDirectory)) return []
  return fs.readdirSync(backupDirectory)
    .filter((name) => /^moneywise-.*\.sqlite$/.test(name))
    .map((name) => path.join(backupDirectory, name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)
}

function applyRetention(backupDirectory, policy, now = new Date()) {
  const candidates = listBackups(backupDirectory)
  const valid = []
  for (const backupPath of candidates) {
    try { valid.push(verifyBackup(backupPath, Number.MAX_SAFE_INTEGER, now)) } catch { /* invalid backups are retained for incident review */ }
  }
  const validPaths = new Set(valid.map((item) => item.backupPath))
  const deleted = []
  for (const backupPath of candidates.filter((candidate) => !validPaths.has(candidate)).slice(3)) {
    if (fs.existsSync(`${backupPath}.lock`)) continue
    const safeBackup = assertInsideDirectory(backupPath, backupDirectory)
    const manifestPath = assertInsideDirectory(`${backupPath}.json`, backupDirectory)
    if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath)
    fs.unlinkSync(safeBackup)
    deleted.push(path.basename(safeBackup))
  }
  if (valid.length <= 1) return { deleted, retained: listBackups(backupDirectory) }
  const keep = new Set([valid[0].backupPath])
  const buckets = new Set()
  for (const item of valid) {
    const created = new Date(item.manifest.createdAt)
    const ageHours = (now - created) / 3_600_000
    let bucket = null
    if (ageHours <= policy.hourlyHours) bucket = `h:${created.toISOString().slice(0, 13)}`
    else if (ageHours <= policy.dailyDays * 24) bucket = `d:${created.toISOString().slice(0, 10)}`
    else if (ageHours <= policy.weeklyWeeks * 7 * 24) {
      const week = new Date(Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate() - created.getUTCDay()))
      bucket = `w:${week.toISOString().slice(0, 10)}`
    }
    if (bucket && !buckets.has(bucket)) { buckets.add(bucket); keep.add(item.backupPath) }
  }
  for (const item of valid.slice(1)) {
    if (keep.has(item.backupPath) || fs.existsSync(`${item.backupPath}.lock`)) continue
    const backupPath = assertInsideDirectory(item.backupPath, backupDirectory)
    const manifestPath = assertInsideDirectory(`${item.backupPath}.json`, backupDirectory)
    if (!fs.existsSync(manifestPath)) continue
    fs.unlinkSync(manifestPath)
    fs.unlinkSync(backupPath)
    deleted.push(path.basename(backupPath))
  }
  return { deleted, retained: listBackups(backupDirectory) }
}

function getBackupStatus(backupDirectory, now = new Date()) {
  const backups = listBackups(backupDirectory)
  const valid = backups.flatMap((backupPath) => { try { return [verifyBackup(backupPath, Number.MAX_SAFE_INTEGER, now)] } catch { return [] } })
  return {
    backupCount: backups.length,
    newestValidBackup: valid[0]?.manifest.backup ?? null,
    oldestRetainedBackup: backups.at(-1) ? path.basename(backups.at(-1)) : null,
    directoryBytes: backups.reduce((sum, file) => sum + fs.statSync(file).size + (fs.existsSync(`${file}.json`) ? fs.statSync(`${file}.json`).size : 0), 0),
    availableBytes: availableBytes(backupDirectory)
  }
}

function findLatestBackup(backupDirectory) {
  if (!fs.existsSync(backupDirectory)) return null
  const candidates = listBackups(backupDirectory)
  return candidates[0] ?? null
}

function verifyBackup(backupPath, maxAgeHours, now = new Date()) {
  assertHealthyDatabase(backupPath)
  const manifestPath = `${backupPath}.json`
  if (!fs.existsSync(manifestPath)) throw new Error(`Backup manifest is missing: ${manifestPath}`)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (manifest.backup !== path.basename(backupPath)) throw new Error('Backup manifest filename does not match the database backup.')
  if (manifest.sha256 !== checksum(backupPath)) throw new Error('Backup checksum does not match its manifest.')
  const ageHours = (now.getTime() - new Date(manifest.createdAt).getTime()) / 3_600_000
  if (!Number.isFinite(ageHours) || ageHours < 0 || ageHours > maxAgeHours) {
    throw new Error(`Latest backup is ${ageHours.toFixed(1)} hours old; maximum allowed age is ${maxAgeHours} hours.`)
  }
  return { backupPath, manifest, ageHours }
}

module.exports = { applyRetention, assertHealthyDatabase, assertInsideDirectory, availableBytes, createBackup, findLatestBackup, getBackupStatus, listBackups, verifyBackup }
