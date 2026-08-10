const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const BetterSqlite3 = require('better-sqlite3')
const { createDatabase } = require('../data/sqlite.cjs')
const { runMigrations } = require('../data/migrations.cjs')

function temporaryDatabasePath() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moneywise-migration-'))
  return { directory, databasePath: path.join(directory, 'sync.sqlite') }
}

test('upgrades an existing schema without losing data and creates a recoverable backup', () => {
  const { directory, databasePath } = temporaryDatabasePath()
  const legacy = new BetterSqlite3(databasePath)
  legacy.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);
    CREATE TABLE finance_records (sync_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, entity_type TEXT NOT NULL, record_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, version INTEGER NOT NULL, last_modified_by_device_id TEXT);
    INSERT INTO users VALUES ('u1', 'owner@example.test', NULL, 'active', '2025-01-01', '2025-01-01');
  `)
  legacy.close()

  const db = createDatabase(databasePath)
  const migration = runMigrations(db)
  assert.equal(db.sqlite.prepare('SELECT email FROM users WHERE id = ?').get('u1').email, 'owner@example.test')
  assert.equal(db.sqlite.pragma('user_version', { simple: true }), 2)
  assert.ok(db.sqlite.prepare("PRAGMA table_info('sessions')").all().some((column) => column.name === 'refresh_token_hash'))
  db.sqlite.close()

  const backupPath = migration.backupPath
  assert.ok(fs.existsSync(backupPath))
  const backup = new BetterSqlite3(backupPath, { readonly: true })
  assert.equal(backup.prepare('SELECT email FROM users WHERE id = ?').get('u1').email, 'owner@example.test')
  assert.ok(!backup.prepare("PRAGMA table_info('sessions')").all().some((column) => column.name === 'refresh_token_hash'))
  backup.close()
})

test('a migration failure leaves the pre-migration backup readable', () => {
  const { directory, databasePath } = temporaryDatabasePath()
  const incompatible = new BetterSqlite3(databasePath)
  incompatible.exec('CREATE TABLE users (broken TEXT);')
  incompatible.close()

  const db = createDatabase(databasePath)
  assert.throws(() => runMigrations(db, { now: new Date('2026-08-10T00:00:00.000Z') }))
  db.sqlite.close()

  const backupPath = fs.readdirSync(directory).map((name) => path.join(directory, name)).find((name) => name.includes('.pre-v2-'))
  assert.ok(backupPath)
  const backup = new BetterSqlite3(backupPath, { readonly: true })
  assert.deepEqual(backup.prepare("PRAGMA table_info('users')").all().map((column) => column.name), ['broken'])
  backup.close()
})

for (const failureStep of ['transaction-started', 'schema-created', 'columns-created', 'data-normalized', 'before-version']) {
  test(`migration rolls back cleanly and retries after failure at ${failureStep}`, () => {
    const { directory, databasePath } = temporaryDatabasePath()
    const legacy = new BetterSqlite3(databasePath)
    legacy.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);
      CREATE TABLE finance_records (sync_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, entity_type TEXT NOT NULL, record_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, version INTEGER NOT NULL, last_modified_by_device_id TEXT);
      INSERT INTO users VALUES ('u1', 'retry@example.test', 'hash', 'active', '2025-01-01', '2025-01-01');
    `)
    legacy.close()
    const db = createDatabase(databasePath)
    assert.throws(() => runMigrations(db, { injectFailure: (step) => { if (step === failureStep) throw new Error(`failure:${step}`) } }), new RegExp(`failure:${failureStep}`))
    assert.equal(db.sqlite.pragma('user_version', { simple: true }), 0)
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1)
    assert.equal(db.sqlite.prepare("PRAGMA table_info('sessions')").all().some((column) => column.name === 'refresh_token_hash'), false)
    const retried = runMigrations(db, { now: new Date('2026-08-11T00:00:00.000Z') })
    assert.equal(db.sqlite.pragma('integrity_check', { simple: true }), 'ok')
    assert.equal(db.sqlite.pragma('foreign_keys', { simple: true }), 1)
    assert.equal(db.sqlite.pragma('user_version', { simple: true }), 2)
    assert.ok(retried.backupPath)
    db.sqlite.close(); fs.rmSync(directory, { recursive: true, force: true })
  })
}
