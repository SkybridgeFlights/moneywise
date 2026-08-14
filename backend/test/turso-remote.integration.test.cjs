const assert = require('node:assert/strict')
const { after, before, test } = require('node:test')
const { randomUUID } = require('node:crypto')
const { createTursoDatabase } = require('../data/turso.cjs')
const { migrateRemoteDatabase, SCHEMA_CHECKSUM, SCHEMA_VERSION } = require('../data/schema.cjs')
const { createUserRepository } = require('../data/userRepository.cjs')
const { createSessionRepository } = require('../data/sessionRepository.cjs')
const { createRecordRepository } = require('../data/recordRepository.cjs')
const { createAuthService } = require('../services/authService.cjs')
const { createSyncService } = require('../services/syncService.cjs')

if (process.env.RUN_REMOTE_TURSO !== '1') {
  test('real Turso integration is explicitly gated', { skip: true }, () => {})
  return
}

assert.ok(process.env.TURSO_DATABASE_URL, 'TURSO_DATABASE_URL is required')
assert.ok(process.env.TURSO_AUTH_TOKEN, 'TURSO_AUTH_TOKEN is required')
assert.match(process.env.TURSO_DATABASE_URL, /^libsql:\/\//, 'Remote validation requires secure libsql:// transport')

const runId = randomUUID()
const prefix = `mw-remote-${runId}`
const config = {
  tursoDatabaseUrl: process.env.TURSO_DATABASE_URL,
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN
}
const authConfig = {
  nodeEnv: 'test', authMode: 'password-only', authSecret: `remote-contract-${randomUUID()}-${randomUUID()}`,
  sessionTtlDays: 30, accessTokenTtlMinutes: 15
}
let database
let users
let sessions
let records
let sync
let auth
const timings = {}

function expense(recordId, baseVersion, title = recordId) {
  return { entityType: 'expense', recordId, payload: { id: recordId, title, amount: 10, date: '2026-08-14', categoryId: 'misc', paymentMethod: 'card', type: 'variable', recurring: false, notes: '', tags: [], goalId: null, debtId: null, allocationKind: 'spend' }, ...(baseVersion === undefined ? {} : { baseVersion }) }
}

async function timed(name, callback) {
  const started = performance.now()
  const result = await callback()
  timings[name] = Math.round(performance.now() - started)
  return result
}

before(async () => {
  database = createTursoDatabase(config)
  assert.equal(database.provider, 'turso')
  await timed('connect_and_migrate_ms', () => migrateRemoteDatabase(database))
  await migrateRemoteDatabase(database)
  users = createUserRepository(database)
  sessions = createSessionRepository(database)
  records = createRecordRepository(database)
  sync = createSyncService({ recordRepository: records })
  auth = createAuthService({ config: authConfig, userRepository: users, sessionRepository: sessions })
})

after(async () => {
  if (database) await database.close()
  process.stdout.write(`REMOTE_TURSO_TIMINGS=${JSON.stringify(timings)}\n`)
})

test('remote schema, migration checksum, indexes, foreign keys, and unique constraints', async () => {
  const migration = await database.get('SELECT version, applied_at, checksum FROM schema_migrations WHERE version = ?', [SCHEMA_VERSION])
  assert.equal(Number(migration.version), SCHEMA_VERSION)
  assert.equal(migration.checksum, SCHEMA_CHECKSUM)
  assert.ok(Date.parse(migration.applied_at))
  const expectedTables = ['finance_records', 'schema_migrations', 'sessions', 'sync_requests', 'sync_revisions', 'users']
  const tables = (await database.all("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).map((row) => row.name)
  assert.deepEqual(tables, expectedTables)
  const expectedIndexes = ['idx_finance_records_user_entity_record', 'idx_finance_records_user_revision', 'idx_finance_records_user_updated', 'idx_sessions_refresh_token_hash', 'idx_sessions_token_hash', 'idx_sessions_user_id', 'idx_users_email']
  const indexes = (await database.all("SELECT name FROM sqlite_schema WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name")).map((row) => row.name)
  for (const name of expectedIndexes) assert.ok(indexes.includes(name), `missing index ${name}`)
  const financeFks = await database.all("PRAGMA foreign_key_list('finance_records')")
  const sessionFks = await database.all("PRAGMA foreign_key_list('sessions')")
  const requestFks = await database.all("PRAGMA foreign_key_list('sync_requests')")
  for (const rows of [financeFks, sessionFks, requestFks]) assert.ok(rows.some((row) => row.table === 'users' && row.on_delete === 'CASCADE'))
})

test('real remote auth, sessions, rotation, revocation, duplicate accounts, and account isolation', async () => {
  const emailA = `${prefix}-a@example.invalid`
  const emailB = `${prefix}-b@example.invalid`
  const registeredA = await timed('registration_ms', () => auth.registerWithPassword({ email: emailA, password: 'correct-horse-battery-a', deviceId: 'a' }))
  const registeredB = await auth.registerWithPassword({ email: emailB, password: 'correct-horse-battery-b', deviceId: 'b' })
  const storedA = await users.findByEmail(emailA)
  const storedB = await users.findByEmail(emailB)
  assert.match(storedA.passwordHash, /^scrypt:/)
  assert.notEqual(storedA.passwordHash, 'correct-horse-battery-a')
  await assert.rejects(() => auth.registerWithPassword({ email: emailA, password: 'another-correct-password', deviceId: 'duplicate' }), /exists/i)
  const loggedIn = await timed('password_login_ms', () => auth.loginWithPassword({ email: emailA, password: 'correct-horse-battery-a', deviceId: 'login-a' }))
  assert.equal(loggedIn.user.id, storedA.id)
  await assert.rejects(() => auth.loginWithPassword({ email: emailA, password: 'incorrect-password', deviceId: 'login-a' }), /Invalid/i)
  assert.equal((await auth.authenticateFromHeader(`Bearer ${registeredA.accessToken}`)).user.id, storedA.id)
  const rotated = await timed('refresh_rotation_ms', () => auth.refreshSession({ refreshToken: registeredA.refreshToken, deviceId: 'a' }))
  await assert.rejects(() => auth.refreshSession({ refreshToken: registeredA.refreshToken, deviceId: 'a' }), /Invalid/)
  const principal = await auth.authenticateFromHeader(`Bearer ${rotated.accessToken}`)
  await auth.logout(principal.session.id)
  assert.equal(await auth.authenticateFromHeader(`Bearer ${rotated.accessToken}`), null)
  await assert.rejects(() => sessions.create({ id: `${prefix}-orphan`, userId: `${prefix}-missing`, tokenHash: `${prefix}-orphan-token`, label: 'orphan', authMode: 'password', createdAt: new Date().toISOString(), expiresAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() }))
  const legacyEmail = `${prefix}-legacy@example.invalid`
  const now = new Date().toISOString()
  await users.create({ id: `${prefix}-legacy`, email: legacyEmail, passwordHash: null, status: 'recovery-required', createdAt: now, updatedAt: now })
  await assert.rejects(() => auth.registerWithPassword({ email: legacyEmail, password: 'correct-horse-battery-legacy', deviceId: 'legacy' }), /exists/i)
  assert.equal((await users.findByEmail(legacyEmail)).passwordHash, null)

  await sync.pushBatch(storedA.id, { deviceId: 'a', requestId: `${prefix}-a-1`, changes: [expense(`${prefix}-shared`, undefined, 'A-owned')] })
  await sync.pushBatch(storedA.id, { deviceId: 'a', requestId: `${prefix}-a-private-request`, changes: [expense(`${prefix}-a-private`, undefined, 'A-private')] })
  assert.equal((await timed('bootstrap_ms', () => sync.bootstrap(storedB.id))).records.expense, undefined)
  await sync.pushBatch(storedB.id, { deviceId: 'b', requestId: `${prefix}-b-1`, changes: [expense(`${prefix}-shared`, undefined, 'B-owned')] })
  assert.equal((await sync.bootstrap(storedA.id)).records.expense.find((item) => item.id === `${prefix}-shared`).payload.title, 'A-owned')
  assert.equal((await sync.bootstrap(storedB.id)).records.expense.find((item) => item.id === `${prefix}-shared`).payload.title, 'B-owned')
  assert.equal(await records.findByUserAndRecord(storedB.id, 'expense', `${prefix}-a-private`), null)
})

test('remote atomic sync, rollback injection, tombstones, versions, cursor, and idempotent retry', async () => {
  const now = new Date().toISOString()
  const userId = `${prefix}-atomic-user`
  await users.create({ id: userId, email: `${prefix}-atomic@example.invalid`, passwordHash: 'scrypt:test:test', status: 'active', createdAt: now, updatedAt: now })
  const payload = { deviceId: 'atomic', requestId: `${prefix}-idempotent`, changes: [expense(`${prefix}-one`), expense(`${prefix}-two`)] }
  const first = await timed('small_sync_ms', () => sync.pushBatch(userId, payload))
  const replay = await sync.pushBatch(userId, payload)
  assert.deepEqual(replay, first)
  assert.equal((await records.listChangesSince(userId, 0, 20)).length, 2)
  const deleted = await sync.softDeleteRecord(userId, 'expense', `${prefix}-one`, { baseVersion: 1, deletedAt: '2026-08-14T12:00:00.000Z' })
  assert.equal(deleted.record.version, 2)
  assert.ok(deleted.record.revision > 0)
  assert.equal((await sync.getChanges(userId, 0, 20)).changes.length, 2)
  for (const point of ['after-idempotency-lookup', 'after-conflict-validation', 'after-record-write', 'after-idempotency-save']) {
    const requestId = `${prefix}-rollback-${point}`
    const recordId = `${prefix}-rollback-record-${point}`
    await assert.rejects(() => sync.pushBatch(userId, { deviceId: 'atomic', requestId, changes: [expense(recordId)] }, { injectFailure(current) { if (current === point) throw new Error(`injected:${point}`) } }), new RegExp(`injected:${point}`))
    assert.equal(await records.findByUserAndRecord(userId, 'expense', recordId), null)
    assert.equal(await records.findRequest(userId, requestId), null)
  }
  const conflict = await sync.pushBatch(userId, { deviceId: 'atomic', requestId: `${prefix}-conflict`, changes: [expense(`${prefix}-new-in-conflict`), expense(`${prefix}-two`, 999)] })
  assert.equal(conflict.applied.length, 0)
  assert.equal(await records.findByUserAndRecord(userId, 'expense', `${prefix}-new-in-conflict`), null)
})

test('independent real remote writers preserve revision and conflict semantics', async () => {
  const secondDatabase = createTursoDatabase(config)
  try {
    const secondRecords = createRecordRepository(secondDatabase)
    const secondSync = createSyncService({ recordRepository: secondRecords })
    const now = new Date().toISOString()
    const userId = `${prefix}-concurrent-user`
    await users.create({ id: userId, email: `${prefix}-concurrent@example.invalid`, passwordHash: 'scrypt:test:test', status: 'active', createdAt: now, updatedAt: now })
    await timed('multi_record_concurrent_ms', () => Promise.all(Array.from({ length: 8 }, (_, index) => {
      const service = index % 2 ? sync : secondSync
      return service.pushBatch(userId, { deviceId: `writer-${index % 2}`, requestId: `${prefix}-concurrent-${index}`, changes: [expense(`${prefix}-record-${index}`)] })
    })))
    const revisions = (await records.listChangesSince(userId, 0, 20)).map((record) => record.revision)
    assert.equal(revisions.length, 8)
    assert.equal(new Set(revisions).size, 8)
    assert.deepEqual(revisions, [...revisions].sort((a, b) => a - b))
    await sync.upsertRecord(userId, expense(`${prefix}-cas`))
    const competing = await Promise.all([
      sync.upsertRecord(userId, expense(`${prefix}-cas`, 1, 'writer-one')),
      secondSync.upsertRecord(userId, expense(`${prefix}-cas`, 1, 'writer-two'))
    ])
    assert.equal(competing.filter((result) => result.ok).length, 1)
    assert.equal(competing.filter((result) => !result.ok).length, 1)

    const sameRequest = { deviceId: 'replay', requestId: `${prefix}-same-request`, changes: [expense(`${prefix}-exactly-once`)] }
    const attempts = await Promise.allSettled([sync.pushBatch(userId, sameRequest), secondSync.pushBatch(userId, sameRequest)])
    assert.ok(attempts.some((attempt) => attempt.status === 'fulfilled'))
    const resolved = await sync.pushBatch(userId, sameRequest)
    assert.equal(resolved.applied.length, 1)
    assert.equal((await records.listChangesSince(userId, 0, 50)).filter((record) => record.recordId === `${prefix}-exactly-once`).length, 1)
    assert.equal(Number((await database.get('SELECT COUNT(*) AS count FROM sync_requests WHERE user_id = ? AND request_id = ?', [userId, sameRequest.requestId])).count), 1)

    const batch = Array.from({ length: 20 }, (_, index) => expense(`${prefix}-batch-${index}`))
    await timed('twenty_record_sync_ms', () => sync.pushBatch(userId, { deviceId: 'batch', requestId: `${prefix}-batch-request`, changes: batch }))
    assert.equal((await records.listChangesSince(userId, 0, 100)).filter((record) => record.recordId.startsWith(`${prefix}-batch-`)).length, 20)
  } finally {
    await secondDatabase.close()
  }
})

test('remote post-test integrity invariants', async () => {
  const foreignKeys = await database.all('PRAGMA foreign_key_check')
  assert.deepEqual(foreignKeys, [])
  const duplicateEmails = await database.all('SELECT email, COUNT(*) AS count FROM users GROUP BY email HAVING COUNT(*) > 1')
  const duplicateRefresh = await database.all('SELECT refresh_token_hash, COUNT(*) AS count FROM sessions WHERE refresh_token_hash IS NOT NULL GROUP BY refresh_token_hash HAVING COUNT(*) > 1')
  const duplicateRevisions = await database.all('SELECT revision, COUNT(*) AS count FROM finance_records GROUP BY revision HAVING COUNT(*) > 1')
  const orphanSessions = await database.all('SELECT s.id FROM sessions s LEFT JOIN users u ON u.id = s.user_id WHERE u.id IS NULL')
  const orphanRecords = await database.all('SELECT f.sync_id FROM finance_records f LEFT JOIN users u ON u.id = f.user_id WHERE u.id IS NULL')
  assert.deepEqual(duplicateEmails, [])
  assert.deepEqual(duplicateRefresh, [])
  assert.deepEqual(duplicateRevisions, [])
  assert.deepEqual(orphanSessions, [])
  assert.deepEqual(orphanRecords, [])
  const highWater = await database.get('SELECT MAX(revision) AS max_revision FROM sync_revisions')
  const recordHighWater = await database.get('SELECT MAX(revision) AS max_revision FROM finance_records')
  assert.ok(Number(highWater.max_revision) >= Number(recordHighWater.max_revision))
  const badRequests = await database.all('SELECT r.request_id FROM sync_requests r LEFT JOIN users u ON u.id = r.user_id WHERE u.id IS NULL OR json_valid(r.response_json) = 0')
  assert.deepEqual(badRequests, [])
})
