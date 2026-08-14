function mapSession(row) {
  if (!row) return null
  return { id: row.id, userId: row.user_id, tokenHash: row.token_hash, label: row.label, authMode: row.auth_mode, createdAt: row.created_at, expiresAt: row.expires_at, refreshTokenHash: row.refresh_token_hash, refreshExpiresAt: row.refresh_expires_at, lastSeenAt: row.last_seen_at, revokedAt: row.revoked_at }
}

function createSessionRepository(database) {
  return {
    async create(session) {
      await database.run('INSERT INTO sessions (id, user_id, token_hash, label, auth_mode, created_at, expires_at, refresh_token_hash, refresh_expires_at, last_seen_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [session.id, session.userId, session.tokenHash, session.label, session.authMode, session.createdAt, session.expiresAt, session.refreshTokenHash ?? null, session.refreshExpiresAt ?? null, session.lastSeenAt, session.revokedAt ?? null])
      return this.findByTokenHash(session.tokenHash)
    },
    async findByTokenHash(tokenHash) { return mapSession(await database.get('SELECT * FROM sessions WHERE token_hash = ? LIMIT 1', [tokenHash])) },
    async findByRefreshTokenHash(tokenHash) { return mapSession(await database.get('SELECT * FROM sessions WHERE refresh_token_hash = ? LIMIT 1', [tokenHash])) },
    async touch(id, timestamp) { await database.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [timestamp, id]) },
    async revoke(id, revokedAt) { await database.run('UPDATE sessions SET revoked_at = ? WHERE id = ?', [revokedAt, id]) },
    async transaction(callback) { return database.transaction((transactionDatabase) => callback(createSessionRepository(transactionDatabase))) }
  }
}

module.exports = { createSessionRepository }
