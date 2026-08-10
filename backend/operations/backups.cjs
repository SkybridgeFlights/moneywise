const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const BetterSqlite3 = require('better-sqlite3')

function checksum(filePath) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
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

async function createBackup(databasePath, backupDirectory, now = new Date()) {
  assertHealthyDatabase(databasePath)
  fs.mkdirSync(backupDirectory, { recursive: true })
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

function findLatestBackup(backupDirectory) {
  if (!fs.existsSync(backupDirectory)) return null
  const candidates = fs.readdirSync(backupDirectory)
    .filter((name) => /^moneywise-.*\.sqlite$/.test(name))
    .map((name) => path.join(backupDirectory, name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)
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

module.exports = { assertHealthyDatabase, createBackup, findLatestBackup, verifyBackup }
