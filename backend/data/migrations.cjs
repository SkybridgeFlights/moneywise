function runMigrations(db) {
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
  sqlite.exec(`
    UPDATE finance_records SET revision = rowid WHERE revision = 0;
    INSERT OR IGNORE INTO sync_revisions(revision) SELECT MAX(revision) FROM finance_records HAVING MAX(revision) > 0;
    CREATE INDEX IF NOT EXISTS idx_finance_records_user_revision ON finance_records(user_id, revision);
  `)

  const hasUsers = sqlite.prepare('SELECT COUNT(*) AS count FROM users').get().count > 0
  const hasSessions = sqlite.prepare('SELECT COUNT(*) AS count FROM sessions').get().count > 0
  const hasRecords = sqlite.prepare('SELECT COUNT(*) AS count FROM finance_records').get().count > 0
  if (hasUsers || hasSessions || hasRecords) {
    return
  }

  const legacy = db.findLegacyJsonState()
  if (!legacy) {
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

  sqlite.exec('BEGIN')
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
    sqlite.exec('COMMIT')
  } catch (error) {
    sqlite.exec('ROLLBACK')
    throw error
  }
}

module.exports = {
  runMigrations
}
