function mapUser(row) {
  if (!row) return null
  return { id: row.id, email: row.email, passwordHash: row.password_hash, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }
}

function createUserRepository(database) {
  return {
    async findByEmail(email) { return mapUser(await database.get('SELECT * FROM users WHERE email = ? LIMIT 1', [email])) },
    async findById(id) { return mapUser(await database.get('SELECT * FROM users WHERE id = ? LIMIT 1', [id])) },
    async create(user) {
      await database.run('INSERT INTO users (id, email, password_hash, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [user.id, user.email, user.passwordHash ?? null, user.status, user.createdAt, user.updatedAt])
      return this.findById(user.id)
    },
    async updatePassword(id, passwordHash, updatedAt) {
      await database.run("UPDATE users SET password_hash = ?, updated_at = ?, status = 'active' WHERE id = ?", [passwordHash, updatedAt, id])
      return this.findById(id)
    }
  }
}

module.exports = { createUserRepository }
