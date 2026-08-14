const crypto = require('node:crypto')

const SCHEMA_VERSION = 2
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL, auth_mode TEXT NOT NULL DEFAULT 'dev-session', created_at TEXT NOT NULL, expires_at TEXT NOT NULL, refresh_token_hash TEXT, refresh_expires_at TEXT, last_seen_at TEXT NOT NULL, revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS finance_records (
  sync_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, entity_type TEXT NOT NULL, record_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, version INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 0, last_modified_by_device_id TEXT,
  UNIQUE(user_id, entity_type, record_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS sync_revisions (revision INTEGER PRIMARY KEY AUTOINCREMENT);
CREATE TABLE IF NOT EXISTS sync_requests (
  user_id TEXT NOT NULL, request_id TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, request_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_refresh_token_hash ON sessions(refresh_token_hash) WHERE refresh_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_finance_records_user_updated ON finance_records(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_finance_records_user_entity_record ON finance_records(user_id, entity_type, record_id);
CREATE INDEX IF NOT EXISTS idx_finance_records_user_revision ON finance_records(user_id, revision);
`
const SCHEMA_CHECKSUM = crypto.createHash('sha256').update(SCHEMA_SQL).digest('hex')

async function migrateRemoteDatabase(database, now = new Date()) {
  await database.exec('PRAGMA foreign_keys = ON')
  await database.transaction(async (transaction) => {
    await transaction.exec(SCHEMA_SQL)
    const existing = await transaction.get('SELECT checksum FROM schema_migrations WHERE version = ?', [SCHEMA_VERSION])
    if (existing && existing.checksum !== SCHEMA_CHECKSUM) throw new Error(`Schema migration ${SCHEMA_VERSION} checksum mismatch.`)
    if (!existing) await transaction.run('INSERT INTO schema_migrations (version, applied_at, checksum) VALUES (?, ?, ?)', [SCHEMA_VERSION, now.toISOString(), SCHEMA_CHECKSUM])
  })
}

module.exports = { SCHEMA_VERSION, SCHEMA_SQL, SCHEMA_CHECKSUM, migrateRemoteDatabase }
