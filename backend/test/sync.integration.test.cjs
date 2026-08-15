const assert = require('node:assert/strict')
const { afterEach, test } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createBackend } = require('../index.cjs')

const cleanup = []
afterEach(async () => { while (cleanup.length) await cleanup.pop()() })

async function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moneywise-sync-test-'))
  const backend = await createBackend({ nodeEnv: 'test', databaseProvider: 'sqlite', host: '127.0.0.1', port: 0, databasePath: path.join(directory, 'test.sqlite'), sessionTtlDays: 30, accessTokenTtlMinutes: 15, authMode: 'password-only', logLevel: 'silent', authSecret: 'sync-integration-test-secret-value' })
  await new Promise((resolve) => backend.server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${backend.server.address().port}`
  const registration = await request(baseUrl, '/api/auth/register', { method: 'POST', body: { email: 'sync@example.com', password: 'correct-horse-battery', deviceId: 'test' } })
  cleanup.push(async () => { await new Promise((resolve) => backend.server.close(resolve)); await backend.database.close(); fs.rmSync(directory, { recursive: true, force: true }) })
  return { baseUrl, token: registration.body.accessToken }
}

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: options.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  })
  return { status: response.status, body: await response.json() }
}

function change(recordId, baseVersion, updatedAt = '2099-01-01T00:00:00.000Z') {
  return { entityType: 'expense', recordId, payload: { moneyVersion: 2, id: recordId, title: recordId, amount: 1000, date: '2026-08-09', categoryId: 'misc', paymentMethod: 'card', type: 'variable', recurring: false, notes: '', tags: [], goalId: null, debtId: null, allocationKind: 'spend' }, updatedAt, ...(baseVersion === undefined ? {} : { baseVersion }) }
}

test('server revisions order identical and future client timestamps without skips across pagination', async () => {
  const { baseUrl, token } = await fixture()
  const push = await request(baseUrl, '/api/sync/push', { method: 'POST', token, body: { deviceId: 'test', requestId: 'request-identical-time', changes: [change('one'), change('two')] } })
  assert.equal(push.status, 200)
  const first = await request(baseUrl, '/api/sync/changes?since=0&limit=1', { token })
  assert.equal(first.body.changes.length, 1)
  assert.equal(first.body.hasMore, true)
  assert.match(first.body.cursor, /^\d+$/)
  const second = await request(baseUrl, `/api/sync/changes?since=${first.body.cursor}&limit=1`, { token })
  assert.equal(second.body.changes.length, 1)
  assert.notEqual(second.body.changes[0].recordId, first.body.changes[0].recordId)
  assert.equal(second.body.hasMore, false)
  assert.ok(Number(second.body.cursor) > Number(first.body.cursor))
  assert.ok(new Date(second.body.changes[0].updatedAt).getFullYear() < 2099)
})

test('replayed request IDs are idempotent', async () => {
  const { baseUrl, token } = await fixture()
  const payload = { deviceId: 'test', requestId: 'request-replay-001', changes: [change('replayed')] }
  const first = await request(baseUrl, '/api/sync/push', { method: 'POST', token, body: payload })
  const second = await request(baseUrl, '/api/sync/push', { method: 'POST', token, body: payload })
  assert.deepEqual(second.body, first.body)
  const bootstrap = await request(baseUrl, '/api/sync/bootstrap', { token })
  assert.equal(bootstrap.body.records.expense[0].version, 1)
})

test('conflicted batches are atomic and do not partially write', async () => {
  const { baseUrl, token } = await fixture()
  await request(baseUrl, '/api/sync/push', { method: 'POST', token, body: { deviceId: 'test', requestId: 'request-seed-conflict', changes: [change('existing')] } })
  const result = await request(baseUrl, '/api/sync/push', { method: 'POST', token, body: { deviceId: 'test', requestId: 'request-atomic-conflict', changes: [change('new-record'), change('existing', 999)] } })
  assert.equal(result.body.applied.length, 0)
  assert.equal(result.body.conflicts.length, 1)
  assert.equal(result.body.atomic, true)
  const bootstrap = await request(baseUrl, '/api/sync/bootstrap', { token })
  assert.deepEqual(bootstrap.body.records.expense.map((entry) => entry.id), ['existing'])
})

test('concurrent writes and reconnect from an old cursor retain every change', async () => {
  const { baseUrl, token } = await fixture()
  await Promise.all([
    request(baseUrl, '/api/sync/push', { method: 'POST', token, body: { deviceId: 'offline-a', requestId: 'request-concurrent-a', changes: [change('offline-a')] } }),
    request(baseUrl, '/api/sync/push', { method: 'POST', token, body: { deviceId: 'offline-b', requestId: 'request-concurrent-b', changes: [change('offline-b')] } })
  ])
  const reconnected = await request(baseUrl, '/api/sync/changes?since=0', { token })
  assert.deepEqual(reconnected.body.changes.map((entry) => entry.recordId).sort(), ['offline-a', 'offline-b'])
  assert.equal(new Set(reconnected.body.changes.map((entry) => entry.revision)).size, 2)
})

test('malformed financial payloads and impossible dates are rejected without writes', async () => {
  const { baseUrl, token } = await fixture()
  const result = await request(baseUrl, '/api/sync/push', {
    method: 'POST', token,
    body: {
      deviceId: 'test', requestId: 'request-invalid-domain',
      changes: [{ entityType: 'expense', recordId: 'bad', payload: { moneyVersion: 2, id: 'bad', title: 'Bad', amount: -1, date: '2026-99-99', categoryId: 'misc', paymentMethod: 'card', type: 'variable', recurring: false, notes: '', tags: [], goalId: null, debtId: null, allocationKind: 'spend' } }]
    }
  })
  assert.equal(result.status, 400)
  const bootstrap = await request(baseUrl, '/api/sync/bootstrap', { token })
  assert.equal(bootstrap.body.records.expense, undefined)
})

test('identical record IDs remain isolated between authenticated users', async () => {
  const { baseUrl, token: userAToken } = await fixture()
  const userB = await request(baseUrl, '/api/auth/register', {
    method: 'POST', body: { email: 'sync-b@example.com', password: 'correct-horse-battery-b', deviceId: 'test-b' }
  })
  assert.equal(userB.status, 201)
  await request(baseUrl, '/api/sync/push', {
    method: 'POST', token: userAToken,
    body: { deviceId: 'a', requestId: 'request-user-a-shared-id', changes: [change('shared-record-id')] }
  })
  await request(baseUrl, '/api/sync/push', {
    method: 'POST', token: userB.body.accessToken,
    body: { deviceId: 'b', requestId: 'request-user-b-shared-id', changes: [{ ...change('shared-record-id'), payload: { ...change('shared-record-id').payload, title: 'User B record' } }] }
  })

  const bootstrapA = await request(baseUrl, '/api/sync/bootstrap', { token: userAToken })
  const bootstrapB = await request(baseUrl, '/api/sync/bootstrap', { token: userB.body.accessToken })
  assert.equal(bootstrapA.body.records.expense.length, 1)
  assert.equal(bootstrapB.body.records.expense.length, 1)
  assert.equal(bootstrapA.body.records.expense[0].payload.title, 'shared-record-id')
  assert.equal(bootstrapB.body.records.expense[0].payload.title, 'User B record')
})
