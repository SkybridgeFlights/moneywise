const { createClient } = require('@libsql/client')
const { tursoAdapter } = require('./databaseAdapter.cjs')

function createTursoDatabase(config) {
  if (!config.tursoDatabaseUrl || !config.tursoAuthToken) {
    throw new Error('Turso requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.')
  }
  if (!/^libsql:\/\/|^https:\/\//.test(config.tursoDatabaseUrl)) {
    throw new Error('TURSO_DATABASE_URL must use libsql:// or https://.')
  }
  const client = createClient({ url: config.tursoDatabaseUrl, authToken: config.tursoAuthToken })
  return tursoAdapter(client)
}

module.exports = { createTursoDatabase }
