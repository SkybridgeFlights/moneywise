const path = require('node:path')
const fs = require('node:fs')
const BetterSqlite3 = require('better-sqlite3')
const { randomUUID } = require('node:crypto')
const { SCHEMA_VERSION, SCHEMA_CHECKSUM } = require('./schema.cjs')

function recordSchemaMigration(sqlite, now = new Date()) {
  sqlite.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT NOT NULL)')
  const existing = sqlite.prepare('SELECT checksum FROM schema_migrations WHERE version = ?').get(SCHEMA_VERSION)
  if (existing && existing.checksum !== SCHEMA_CHECKSUM) throw new Error(`Schema migration ${SCHEMA_VERSION} checksum mismatch.`)
  if (!existing) sqlite.prepare('INSERT INTO schema_migrations (version, applied_at, checksum) VALUES (?, ?, ?)').run(SCHEMA_VERSION, now.toISOString(), SCHEMA_CHECKSUM)
}

function applyMigrationV2(db, injectFailure = () => {}) {
  const sqlite = db.sqlite
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      auth_mode TEXT NOT NULL DEFAULT 'dev-session',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      refresh_token_hash TEXT,
      refresh_expires_at TEXT,
      last_seen_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS finance_records (
      sync_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      record_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      version INTEGER NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      last_modified_by_device_id TEXT,
      UNIQUE(user_id, entity_type, record_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_finance_records_user_updated ON finance_records(user_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_finance_records_user_entity_record ON finance_records(user_id, entity_type, record_id);
    CREATE TABLE IF NOT EXISTS sync_revisions (
      revision INTEGER PRIMARY KEY AUTOINCREMENT
    );
    CREATE TABLE IF NOT EXISTS sync_requests (
      user_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, request_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `)
  injectFailure('schema-created')

  const authModeColumn = sqlite.prepare("PRAGMA table_info('sessions')").all().some((row) => row.name === 'auth_mode')
  if (!authModeColumn) {
    sqlite.exec("ALTER TABLE sessions ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'dev-session'")
  }

  const revokedAtColumn = sqlite.prepare("PRAGMA table_info('sessions')").all().some((row) => row.name === 'revoked_at')
  if (!revokedAtColumn) {
    sqlite.exec('ALTER TABLE sessions ADD COLUMN revoked_at TEXT')
  }
  const refreshTokenColumn = sqlite.prepare("PRAGMA table_info('sessions')").all().some((row) => row.name === 'refresh_token_hash')
  if (!refreshTokenColumn) {
    sqlite.exec('ALTER TABLE sessions ADD COLUMN refresh_token_hash TEXT')
  }
  const refreshExpiresColumn = sqlite.prepare("PRAGMA table_info('sessions')").all().some((row) => row.name === 'refresh_expires_at')
  if (!refreshExpiresColumn) {
    sqlite.exec('ALTER TABLE sessions ADD COLUMN refresh_expires_at TEXT')
  }
  sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_refresh_token_hash ON sessions(refresh_token_hash) WHERE refresh_token_hash IS NOT NULL')
  const revisionColumn = sqlite.prepare("PRAGMA table_info('finance_records')").all().some((row) => row.name === 'revision')
  if (!revisionColumn) {
    sqlite.exec('ALTER TABLE finance_records ADD COLUMN revision INTEGER NOT NULL DEFAULT 0')
  }
  injectFailure('columns-created')
  sqlite.exec(`
    UPDATE finance_records SET revision = rowid WHERE revision = 0;
    INSERT OR IGNORE INTO sync_revisions(revision) SELECT MAX(revision) FROM finance_records HAVING MAX(revision) > 0;
    CREATE INDEX IF NOT EXISTS idx_finance_records_user_revision ON finance_records(user_id, revision);
    UPDATE users
    SET status = 'recovery-required', updated_at = datetime('now')
    WHERE password_hash IS NULL AND status != 'recovery-required';
    UPDATE sessions
    SET revoked_at = COALESCE(revoked_at, datetime('now'))
    WHERE auth_mode != 'password'
       OR user_id IN (SELECT id FROM users WHERE password_hash IS NULL OR status != 'active');
  `)
  injectFailure('data-normalized')

  const hasUsers = sqlite.prepare('SELECT COUNT(*) AS count FROM users').get().count > 0
  const hasSessions = sqlite.prepare('SELECT COUNT(*) AS count FROM sessions').get().count > 0
  const hasRecords = sqlite.prepare('SELECT COUNT(*) AS count FROM finance_records').get().count > 0
  if (hasUsers || hasSessions || hasRecords) {
    injectFailure('before-version')
    sqlite.pragma('user_version = 2')
    return
  }

  const legacy = db.findLegacyJsonState()
  if (!legacy) {
    injectFailure('before-version')
    sqlite.pragma('user_version = 2')
    return
  }

  const insertUser = sqlite.prepare(`
    INSERT OR IGNORE INTO users (id, email, password_hash, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const insertSession = sqlite.prepare(`
    INSERT OR IGNORE INTO sessions (id, user_id, token_hash, label, auth_mode, created_at, expires_at, refresh_token_hash, refresh_expires_at, last_seen_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertRecord = sqlite.prepare(`
    INSERT OR IGNORE INTO finance_records (
      sync_id, user_id, entity_type, record_id, payload_json, created_at, updated_at, deleted_at, version, last_modified_by_device_id, revision
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  try {
    legacy.users.forEach((user) => {
      insertUser.run(
        user.id,
        user.email,
        user.passwordHash ?? null,
        user.status ?? 'active',
        user.createdAt,
        user.updatedAt
      )
    })
    legacy.sessions.forEach((session) => {
      insertSession.run(
        session.id,
        session.userId,
        session.tokenHash,
        session.label ?? 'Imported session',
        session.authMode ?? 'dev-session',
        session.createdAt,
        session.expiresAt,
        null,
        null,
        session.lastSeenAt ?? session.createdAt,
        session.revokedAt ?? null
      )
    })
    legacy.financeRecords.forEach((record) => {
      insertRecord.run(
        record.syncId,
        record.userId,
        record.entityType,
        record.recordId,
        JSON.stringify(record.payload ?? {}),
        record.createdAt,
        record.updatedAt,
        record.deletedAt ?? null,
        record.version ?? 1,
        record.lastModifiedByDeviceId ?? null
        , record.revision ?? 0
      )
    })
    injectFailure('legacy-imported')
    injectFailure('before-version')
    sqlite.pragma('user_version = 2')
  } catch (error) {
    throw error
  }
}

function runMigrations(db, options = {}) {
  const sqlite = db.sqlite
  const schemaVersion = sqlite.pragma('user_version', { simple: true })
  if (schemaVersion >= 2) {
    sqlite.exec(`
      UPDATE users SET status = 'recovery-required', updated_at = datetime('now') WHERE password_hash IS NULL AND status != 'recovery-required';
      UPDATE sessions SET revoked_at = COALESCE(revoked_at, datetime('now'))
      WHERE auth_mode != 'password' OR user_id IN (SELECT id FROM users WHERE password_hash IS NULL OR status != 'active');
    `)
    recordSchemaMigration(sqlite, options.now)
    return { fromVersion: schemaVersion, toVersion: schemaVersion, backupPath: null }
  }
  const hasExistingSchema = sqlite.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get().count > 0
  let backupPath = null
  if (hasExistingSchema) {
    const parsed = path.parse(db.databasePath)
    const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, '-')
    backupPath = path.join(parsed.dir, `${parsed.name}.pre-v2-${stamp}-${randomUUID()}${parsed.ext || '.sqlite'}`)
    sqlite.prepare('VACUUM INTO ?').run(backupPath)
    if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size === 0) throw new Error('Pre-migration backup verification failed.')
    const backup = new BetterSqlite3(backupPath, { readonly: true, fileMustExist: true })
    try { if (backup.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Pre-migration backup verification failed.') } finally { backup.close() }
  }
  sqlite.exec('BEGIN IMMEDIATE')
  try {
    options.injectFailure?.('transaction-started')
    applyMigrationV2(db, options.injectFailure)
    sqlite.exec('COMMIT')
    recordSchemaMigration(sqlite, options.now)
    return { fromVersion: schemaVersion, toVersion: 2, backupPath }
  } catch (error) {
    sqlite.exec('ROLLBACK')
    throw error
  }
}

module.exports = {
  runMigrations
}
