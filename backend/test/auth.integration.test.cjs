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

async function startWithHttpsEnforcement() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moneywise-https-test-'))
  const backend = createBackend({ nodeEnv: 'production', host: '127.0.0.1', port: 0, databasePath: path.join(directory, 'test.sqlite'), sessionTtlDays: 30, accessTokenTtlMinutes: 15, authMode: 'password-only', logLevel: 'silent', authSecret: 'integration-test-secret-that-is-not-production', tlsTerminated: true })
  await new Promise((resolve) => backend.server.listen(0, '127.0.0.1', resolve))
  cleanup.push(async () => { await new Promise((resolve) => backend.server.close(resolve)); backend.db.sqlite.close(); fs.rmSync(directory, { recursive: true, force: true }) })
  return `http://127.0.0.1:${backend.server.address().port}`
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

test('environment loader requires HTTPS termination and a canonical production URL', () => {
  const baseEnvironment = {
    ...process.env,
    NODE_ENV: 'production',
    MONEYWISE_BACKEND_AUTH_MODE: 'password-only',
    AUTH_SECRET: 'a-production-test-secret-longer-than-32-bytes'
  }
  const missingTls = spawnSync(process.execPath, ['-e', "require('./config/env.cjs')"], {
    cwd: path.resolve(__dirname, '..'), env: baseEnvironment, encoding: 'utf8'
  })
  assert.notEqual(missingTls.status, 0)
  assert.match(missingTls.stderr, /PUBLIC_BASE_URL/)

  const valid = spawnSync(process.execPath, ['-e', "require('./config/env.cjs')"], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...baseEnvironment, PUBLIC_BASE_URL: 'https://sync.example.test', MONEYWISE_TLS_TERMINATED: 'true' },
    encoding: 'utf8'
  })
  assert.equal(valid.status, 0, valid.stderr)
})

test('production dev-session endpoint returns 403', async () => {
  const baseUrl = await start()
  const result = await json(`${baseUrl}/api/auth/dev-session`, {
    method: 'POST',
    body: JSON.stringify({ email: 'victim@example.com', deviceId: 'attacker' })
  })
  assert.equal(result.response.status, 403)
  assert.match(result.body.error, /disabled/i)
  const malformed = await json(`${baseUrl}/api/auth/dev-session`, { method: 'POST', body: '{}' })
  assert.equal(malformed.response.status, 403)
})

test('production TLS enforcement rejects API traffic without trusted proxy HTTPS metadata', async () => {
  const baseUrl = await startWithHttpsEnforcement()
  const rejected = await json(`${baseUrl}/api/auth/login`, { method: 'POST', body: '{}' })
  assert.equal(rejected.response.status, 426)
  assert.equal(rejected.response.headers.get('strict-transport-security'), 'max-age=31536000; includeSubDomains')
  const forwarded = await json(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'x-forwarded-proto': 'https' }, body: '{}' })
  assert.equal(forwarded.response.status, 400)
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

test('oversized request bodies are rejected before parsing', async () => {
  const baseUrl = await start()
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ padding: 'x'.repeat(300 * 1024) })
  })
  assert.equal(response.status, 413)
  assert.match((await response.json()).error, /too large/i)
})

test('repeated incorrect passwords are rate limited per account and address', async () => {
  const baseUrl = await start()
  await json(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    body: JSON.stringify({ email: 'limited@example.com', password: 'correct-horse-battery', deviceId: 'desktop' })
  })
  let last
  for (let attempt = 0; attempt < 9; attempt += 1) {
    last = await json(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email: 'limited@example.com', password: 'incorrect-password', deviceId: 'desktop' })
    })
  }
  assert.equal(last.response.status, 429)
})

test('production errors are sanitized and include a correlation ID', async () => {
  const baseUrl = await start()
  const response = await fetch(`${baseUrl}/api/sync/records/%/record`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  })
  const body = await response.json()
  assert.equal(response.status, 500)
  assert.equal(body.error, 'Unexpected backend error.')
  assert.equal(typeof body.requestId, 'string')
  assert.equal(JSON.stringify(body).includes('URI malformed'), false)
})
