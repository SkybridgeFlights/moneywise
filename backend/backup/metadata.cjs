const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const BetterSqlite3 = require('better-sqlite3')

const EXPECTED_TABLES = ['finance_records', 'schema_migrations', 'sessions', 'sync_requests', 'sync_revisions', 'users']

function inspectDump(dump) {
  if (!Buffer.isBuffer(dump) || dump.length === 0) throw new Error('Turso dump must be non-empty.')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moneywise-backup-inspect-'))
  const databasePath = path.join(directory, 'restore.sqlite')
  let database
  try {
    database = new BetterSqlite3(databasePath)
    database.exec(dump.toString('utf8'))
    const tables = database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name)
    for (const table of EXPECTED_TABLES) if (!tables.includes(table)) throw new Error(`Backup is missing required table ${table}.`)
    const tableCounts = Object.fromEntries(tables.map((table) => [table, Number(database.prepare(`SELECT COUNT(*) AS count FROM "${table.replaceAll('"', '""')}"`).get().count)]))
    const migrations = database.prepare('SELECT version, applied_at, checksum FROM schema_migrations ORDER BY version').all().map((row) => ({ version: Number(row.version), appliedAt: row.applied_at, checksum: row.checksum }))
    if (migrations.length === 0) throw new Error('Backup contains no migration metadata.')
    const maximumRevision = Number(database.prepare('SELECT COALESCE(MAX(revision), 0) AS revision FROM sync_revisions').get().revision)
    const foreignKeyViolations = database.prepare('PRAGMA foreign_key_check').all()
    if (foreignKeyViolations.length > 0) throw new Error('Backup failed foreign-key integrity verification.')
    const invalidIdempotency = Number(database.prepare('SELECT COUNT(*) AS count FROM sync_requests WHERE json_valid(response_json) = 0').get().count)
    if (invalidIdempotency > 0) throw new Error('Backup contains invalid idempotency responses.')
    const invalidPayloads = Number(database.prepare('SELECT COUNT(*) AS count FROM finance_records WHERE json_valid(payload_json) = 0').get().count)
    if (invalidPayloads > 0) throw new Error('Backup contains invalid financial payloads.')
    const duplicateRevisions = Number(database.prepare('SELECT COUNT(*) AS count FROM (SELECT revision FROM finance_records GROUP BY revision HAVING COUNT(*) > 1)').get().count)
    if (duplicateRevisions > 0) throw new Error('Backup contains duplicate financial revisions.')
    const representative = {
      users: database.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get() ?? null,
      sessions: database.prepare('SELECT id, user_id FROM sessions ORDER BY id LIMIT 1').get() ?? null,
      financeRecords: database.prepare('SELECT sync_id, user_id, entity_type, record_id, payload_json, deleted_at, version, revision FROM finance_records ORDER BY revision DESC LIMIT 1').get() ?? null,
      syncRequests: database.prepare('SELECT user_id, request_id, response_json FROM sync_requests ORDER BY created_at DESC LIMIT 1').get() ?? null
    }
    const tombstoneCount = Number(database.prepare('SELECT COUNT(*) AS count FROM finance_records WHERE deleted_at IS NOT NULL').get().count)
    return { schemaVersion: Math.max(...migrations.map((item) => item.version)), migrations, tableCounts, maximumRevision, tombstoneCount, foreignKeyViolations: 0, invalidIdempotency: 0, invalidPayloads: 0, duplicateRevisions: 0, representative }
  } finally {
    database?.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

module.exports = { EXPECTED_TABLES, inspectDump }
