const assert = require('node:assert/strict')
const { afterEach, test } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createBackend } = require('../index.cjs')
const { spawnSync } = require('node:child_process')

const cleanup = []

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()()
})

async function start(authMode = 'password-only', nodeEnv = 'production') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moneywise-auth-test-'))
  const backend = createBackend({
    nodeEnv,
    host: '127.0.0.1',
    port: 0,
    databasePath: path.join(directory, 'test.sqlite'),
    sessionTtlDays: 30,
    accessTokenTtlMinutes: 15,
    authMode,
    logLevel: 'silent',
    authSecret: 'integration-test-secret-that-is-not-production'
  })
  await new Promise((resolve) => backend.server.listen(0, '127.0.0.1', resolve))
  const address = backend.server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  cleanup.push(async () => {
    await new Promise((resolve) => backend.server.close(resolve))
    backend.db.sqlite.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return baseUrl
}

async function json(url, init) {
  const response = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
  return { response, body: await response.json() }
}

test('production refuses to start with hybrid authentication', () => {
  assert.throws(
    () => createBackend({ nodeEnv: 'production', authMode: 'hybrid', databasePath: ':memory:' }),
    /production requires password-only/
  )
})

test('environment loader fails closed for explicit unsafe production auth', () => {
  const result = spawnSync(process.execPath, ['-e', "require('./config/env.cjs')"], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      MONEYWISE_BACKEND_AUTH_MODE: 'hybrid',
      AUTH_SECRET: 'a-production-test-secret-longer-than-32-bytes'
    },
    encoding: 'utf8'
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /production requires MONEYWISE_BACKEND_AUTH_MODE=password-only/)
})

test('production dev-session endpoint returns 403', async () => {
  const baseUrl = await start()
  const result = await json(`${baseUrl}/api/auth/dev-session`, {
    method: 'POST',
    body: JSON.stringify({ email: 'victim@example.com', deviceId: 'attacker' })
  })
  assert.equal(result.response.status, 403)
  assert.match(result.body.error, /disabled/i)
})

test('interactive login issues short-lived access and rotating refresh tokens', async () => {
  const baseUrl = await start()
  const registration = await json(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    body: JSON.stringify({ email: 'owner@example.com', password: 'correct-horse-battery', deviceId: 'desktop' })
  })
  assert.equal(registration.response.status, 201)
  assert.equal(typeof registration.body.accessToken, 'string')
  assert.equal(typeof registration.body.refreshToken, 'string')
  assert.equal('password' in registration.body, false)

  const refresh = await json(`${baseUrl}/api/auth/refresh`, {
    method: 'POST',
    body: JSON.stringify({ refreshToken: registration.body.refreshToken, deviceId: 'desktop' })
  })
  assert.equal(refresh.response.status, 200)
  assert.notEqual(refresh.body.accessToken, registration.body.accessToken)
  assert.notEqual(refresh.body.refreshToken, registration.body.refreshToken)

  const replay = await json(`${baseUrl}/api/auth/refresh`, {
    method: 'POST',
    body: JSON.stringify({ refreshToken: registration.body.refreshToken, deviceId: 'desktop' })
  })
  assert.equal(replay.response.status, 401)
})
