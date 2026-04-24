function mapUser(row) {
  if (!row) {
    return null
  }
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function createUserRepository(db) {
  const sqlite = db.sqlite
  const findByEmailStatement = sqlite.prepare('SELECT * FROM users WHERE email = ? LIMIT 1')
  const findByIdStatement = sqlite.prepare('SELECT * FROM users WHERE id = ? LIMIT 1')
  const createStatement = sqlite.prepare(`
    INSERT INTO users (id, email, password_hash, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const updatePasswordStatement = sqlite.prepare(`
    UPDATE users
    SET password_hash = ?, updated_at = ?, status = ?
    WHERE id = ?
  `)

  return {
    findByEmail(email) {
      return mapUser(findByEmailStatement.get(email))
    },
    findById(id) {
      return mapUser(findByIdStatement.get(id))
    },
    create(user) {
      createStatement.run(user.id, user.email, user.passwordHash ?? null, user.status, user.createdAt, user.updatedAt)
      return this.findById(user.id)
    },
    updatePassword(id, passwordHash, updatedAt) {
      updatePasswordStatement.run(passwordHash, updatedAt, 'active', id)
      return this.findById(id)
    }
  }
}

module.exports = {
  createUserRepository
}
