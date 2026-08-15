const assert = require('node:assert/strict')
const { afterEach, describe, test } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createClient } = require('@libsql/client')
const { createDatabase } = require('../data/sqlite.cjs')
const { sqliteAdapter, tursoAdapter } = require('../data/databaseAdapter.cjs')
const { runMigrations } = require('../data/migrations.cjs')
const { migrateRemoteDatabase, SCHEMA_CHECKSUM } = require('../data/schema.cjs')
const { createUserRepository } = require('../data/userRepository.cjs')
const { createSessionRepository } = require('../data/sessionRepository.cjs')
const { createRecordRepository } = require('../data/recordRepository.cjs')
const { createAuthService } = require('../services/authService.cjs')
const { createSyncService } = require('../services/syncService.cjs')

const cleanup = []
afterEach(async () => { while (cleanup.length) await cleanup.pop()() })

async function sqliteFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moneywise-adapter-'))
  const raw = createDatabase(path.join(directory, 'contract.sqlite'))
  runMigrations(raw)
  const database = sqliteAdapter(raw)
  cleanup.push(async () => { await database.close(); fs.rmSync(directory, { recursive: true, force: true }) })
  return database
}

async function libsqlFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moneywise-libsql-adapter-'))
  const client = createClient({ url: `file:${path.join(directory, 'contract.db')}` })
  const database = tursoAdapter(client)
  await migrateRemoteDatabase(database)
  // The libsql native test client retains its Windows file handle until process exit.
  cleanup.push(() => database.close())
  return database
}

const providers = [['sqlite', sqliteFixture], ['libsql-local', libsqlFixture]]
const authConfig = { nodeEnv: 'test', authMode: 'password-only', authSecret: 'contract-test-secret-longer-than-32-characters', sessionTtlDays: 30, accessTokenTtlMinutes: 15 }

function expense(recordId, baseVersion) {
  return { entityType: 'expense', recordId, payload: { moneyVersion: 2, id: recordId, title: recordId, amount: 1000, date: '2026-08-14', categoryId: 'misc', paymentMethod: 'card', type: 'variable', recurring: false, notes: '', tags: [], goalId: null, debtId: null, allocationKind: 'spend' }, ...(baseVersion === undefined ? {} : { baseVersion }) }
}

for (const [name, fixture] of providers) {
  describe(`${name} database adapter contract`, () => {
    test('users, password hashes, sessions, refresh rotation, revocation, uniqueness, and foreign keys', async () => {
      const database = await fixture()
      const users = createUserRepository(database)
      const sessions = createSessionRepository(database)
      const auth = createAuthService({ config: authConfig, userRepository: users, sessionRepository: sessions })
      const registered = await auth.registerWithPassword({ email: 'owner@example.com', password: 'correct-horse-battery', deviceId: 'desktop' })
      const storedUser = await users.findByEmail('owner@example.com')
      assert.match(storedUser.passwordHash, /^scrypt:/)
      assert.notEqual(storedUser.passwordHash, 'correct-horse-battery')
      assert.equal((await auth.authenticateFromHeader(`Bearer ${registered.accessToken}`)).user.id, storedUser.id)
      const rotated = await auth.refreshSession({ refreshToken: registered.refreshToken, deviceId: 'desktop' })
      await assert.rejects(() => auth.refreshSession({ refreshToken: registered.refreshToken, deviceId: 'desktop' }), /Invalid/)
      const principal = await auth.authenticateFromHeader(`Bearer ${rotated.accessToken}`)
      await auth.logout(principal.session.id)
      assert.equal(await auth.authenticateFromHeader(`Bearer ${rotated.accessToken}`), null)
      await assert.rejects(() => users.create({ ...storedUser, id: 'duplicate-user' }))
      await assert.rejects(() => sessions.create({ id: 'orphan', userId: 'missing', tokenHash: 'orphan-token', label: 'x', authMode: 'password', createdAt: new Date().toISOString(), expiresAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() }))
      assert.equal((await database.get('SELECT checksum FROM schema_migrations WHERE version = 2')).checksum, SCHEMA_CHECKSUM)
    })

    test('records preserve ownership, tombstones, versions, revisions, cursors, conflicts, and idempotency', async () => {
      const database = await fixture()
      const users = createUserRepository(database)
      const records = createRecordRepository(database)
      const sync = createSyncService({ recordRepository: records })
      const now = new Date().toISOString()
      await users.create({ id: 'a', email: 'a@example.com', passwordHash: 'hash-a', status: 'active', createdAt: now, updatedAt: now })
      await users.create({ id: 'b', email: 'b@example.com', passwordHash: 'hash-b', status: 'active', createdAt: now, updatedAt: now })
      const first = await sync.pushBatch('a', { deviceId: 'a', requestId: 'request-a-0001', changes: [expense('shared')] })
      const replay = await sync.pushBatch('a', { deviceId: 'a', requestId: 'request-a-0001', changes: [expense('shared')] })
      assert.deepEqual(replay, first)
      await sync.pushBatch('b', { deviceId: 'b', requestId: 'request-b-0001', changes: [expense('shared')] })
      const deleted = await sync.softDeleteRecord('a', 'expense', 'shared', { baseVersion: 1, deletedAt: '2026-08-14T12:00:00.000Z' })
      assert.equal(deleted.record.version, 2)
      assert.equal(deleted.record.deletedAt, '2026-08-14T12:00:00.000Z')
      const conflict = await sync.upsertRecord('a', expense('shared', 1))
      assert.equal(conflict.ok, false)
      assert.equal((await sync.bootstrap('a')).records.expense[0].deletedAt, '2026-08-14T12:00:00.000Z')
      assert.equal((await sync.bootstrap('b')).records.expense[0].deletedAt, null)
      const changes = await sync.getChanges('a', '0', 10)
      assert.equal(changes.changes.length, 1)
      assert.equal(changes.cursor, String(deleted.record.revision))
      assert.ok(deleted.record.revision > 0)
    })

    test('sync batches roll back at every critical point', async () => {
      const database = await fixture()
      const users = createUserRepository(database)
      const records = createRecordRepository(database)
      const sync = createSyncService({ recordRepository: records })
      const now = new Date().toISOString()
      await users.create({ id: 'a', email: 'a@example.com', passwordHash: 'hash', status: 'active', createdAt: now, updatedAt: now })
      for (const point of ['after-idempotency-lookup', 'after-conflict-validation', 'after-record-write', 'after-idempotency-save']) {
        await assert.rejects(() => sync.pushBatch('a', { deviceId: 'a', requestId: `request-${point}`, changes: [expense(point)] }, { injectFailure(current) { if (current === point) throw new Error(`injected:${point}`) } }), new RegExp(`injected:${point}`))
        assert.equal(await records.findByUserAndRecord('a', 'expense', point), null)
        assert.equal(await records.findRequest('a', `request-${point}`), null)
      }
    })

    test('concurrent batches allocate distinct monotonic revisions', async () => {
      const database = await fixture()
      const users = createUserRepository(database)
      const records = createRecordRepository(database)
      const sync = createSyncService({ recordRepository: records })
      const now = new Date().toISOString()
      await users.create({ id: 'a', email: 'a@example.com', passwordHash: 'hash', status: 'active', createdAt: now, updatedAt: now })
      await Promise.all(Array.from({ length: 8 }, (_, index) => sync.pushBatch('a', { deviceId: 'a', requestId: `concurrent-${index}`, changes: [expense(`record-${index}`)] })))
      const revisions = (await records.listChangesSince('a', 0, 20)).map((record) => record.revision)
      assert.equal(new Set(revisions).size, 8)
      assert.deepEqual(revisions, [...revisions].sort((a, b) => a - b))

      await sync.upsertRecord('a', expense('compare-and-swap'))
      const competing = await Promise.all([
        sync.upsertRecord('a', expense('compare-and-swap', 1)),
        sync.upsertRecord('a', expense('compare-and-swap', 1))
      ])
      assert.equal(competing.filter((result) => result.ok).length, 1)
      assert.equal(competing.filter((result) => !result.ok).length, 1)
      assert.equal((await records.findByUserAndRecord('a', 'expense', 'compare-and-swap')).version, 2)
    })
  })
}

test('retry after an ambiguous commit resolves through the persisted request ID without duplicate mutation', async () => {
  const database = await sqliteFixture()
  const users = createUserRepository(database)
  const baseRecords = createRecordRepository(database)
  const now = new Date().toISOString()
  await users.create({ id: 'a', email: 'a@example.com', passwordHash: 'hash', status: 'active', createdAt: now, updatedAt: now })
  const ambiguousRecords = {
    ...baseRecords,
    async transaction(callback) {
      await baseRecords.transaction(callback)
      const error = new Error('lost commit response')
      error.code = 'ambiguous_commit'
      throw error
    }
  }
  const payload = { deviceId: 'a', requestId: 'ambiguous-request-001', changes: [expense('once')] }
  await assert.rejects(() => createSyncService({ recordRepository: ambiguousRecords }).pushBatch('a', payload), (error) => error.code === 'ambiguous_commit')
  const resolved = await createSyncService({ recordRepository: baseRecords }).pushBatch('a', payload)
  assert.equal(resolved.applied.length, 1)
  const stored = await baseRecords.listChangesSince('a', 0, 10)
  assert.equal(stored.length, 1)
  assert.equal(stored[0].version, 1)
  assert.equal(stored[0].revision, 1)
})

test('Turso adapter distinguishes pre-commit connection failure from ambiguous commit failure', async () => {
  const beforeCommit = tursoAdapter({
    async transaction() { const error = new Error('connection lost'); error.code = 'CONNECTION_CLOSED'; throw error },
    close() {}
  })
  await assert.rejects(() => beforeCommit.transaction(async () => {}), (error) => error.code === 'transaction_aborted' && error.retryable === true && error.statusCode === 503)

  let rolledBack = false
  const duringCommit = tursoAdapter({
    async transaction() {
      return {
        async execute() { return { rows: [], rowsAffected: 0 } },
        async executeMultiple() {},
        async commit() { throw new Error('commit response timed out') },
        async rollback() { rolledBack = true }
      }
    },
    close() {}
  })
  await assert.rejects(() => duringCommit.transaction(async () => 'written'), (error) => error.code === 'ambiguous_commit' && error.retryable === true && error.statusCode === 503)
  assert.equal(rolledBack, false)
})
