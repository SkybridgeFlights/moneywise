function mapSession(row) {
  if (!row) {
    return null
  }
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    label: row.label,
    authMode: row.auth_mode,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    refreshTokenHash: row.refresh_token_hash,
    refreshExpiresAt: row.refresh_expires_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at
  }
}

function createSessionRepository(db) {
  const sqlite = db.sqlite
  const createStatement = sqlite.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, label, auth_mode, created_at, expires_at, refresh_token_hash, refresh_expires_at, last_seen_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const findByTokenHashStatement = sqlite.prepare('SELECT * FROM sessions WHERE token_hash = ? LIMIT 1')
  const findByRefreshTokenHashStatement = sqlite.prepare('SELECT * FROM sessions WHERE refresh_token_hash = ? LIMIT 1')
  const touchStatement = sqlite.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?')
  const revokeStatement = sqlite.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?')

  return {
    create(session) {
      createStatement.run(
        session.id,
        session.userId,
        session.tokenHash,
        session.label,
        session.authMode,
        session.createdAt,
        session.expiresAt,
        session.refreshTokenHash ?? null,
        session.refreshExpiresAt ?? null,
        session.lastSeenAt,
        session.revokedAt ?? null
      )
      return mapSession(findByTokenHashStatement.get(session.tokenHash))
    },
    findByTokenHash(tokenHash) {
      return mapSession(findByTokenHashStatement.get(tokenHash))
    },
    findByRefreshTokenHash(tokenHash) {
      return mapSession(findByRefreshTokenHashStatement.get(tokenHash))
    },
    touch(id, timestamp) {
      touchStatement.run(timestamp, id)
    },
    revoke(id, revokedAt) {
      revokeStatement.run(revokedAt, id)
    }
  }
}

module.exports = {
  createSessionRepository
}
