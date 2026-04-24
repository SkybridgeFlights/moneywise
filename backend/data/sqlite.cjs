const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

function readLegacyJsonState(filePath) {
  if (!fs.existsSync(filePath)) {
    return null
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      financeRecords: Array.isArray(parsed.financeRecords) ? parsed.financeRecords : []
    }
  } catch {
    return null
  }
}

function createDatabase(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  const sqlite = new DatabaseSync(databasePath)
  sqlite.exec('PRAGMA foreign_keys = ON')
  sqlite.exec('PRAGMA journal_mode = WAL')
  sqlite.exec('PRAGMA busy_timeout = 5000')

  return {
    sqlite,
    databasePath,
    findLegacyJsonState() {
      const extension = path.extname(databasePath).toLowerCase()
      const candidates = extension === '.json'
        ? [databasePath]
        : [
            databasePath.replace(/\.[^/.]+$/, '.json'),
            path.join(path.dirname(databasePath), 'moneywise-sync.json')
          ]
      for (const candidate of candidates) {
        const legacy = readLegacyJsonState(candidate)
        if (legacy) {
          return {
            filePath: candidate,
            ...legacy
          }
        }
      }
      return null
    }
  }
}

module.exports = {
  createDatabase
}
