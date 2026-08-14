const assert = require('node:assert/strict')
const { afterEach, test } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createBackend } = require('../index.cjs')
const { createAuthHandlers } = require('../http/handlers/authHandlers.cjs')
const { createRateLimiter } = require('../http/rateLimiter.cjs')
const { spawnSync } = require('node:child_process')

const cleanup = []

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()()
})

async function start(authMode = 'password-only', nodeEnv = 'production', overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moneywise-auth-test-'))
  const backend = await createBackend({
    nodeEnv,
    databaseProvider: 'sqlite',
    ...(nodeEnv === 'production' ? { _testOnlyAllowProductionSqlite: true } : {}),
    host: '127.0.0.1',
    port: 0,
    databasePath: path.join(directory, 'test.sqlite'),
    sessionTtlDays: 30,
    accessTokenTtlMinutes: 15,
    authMode,
    logLevel: 'silent',
    authSecret: 'integration-test-secret-that-is-not-production',
    ...overrides
  })
  await new Promise((resolve) => backend.server.listen(0, '127.0.0.1', resolve))
  const address = backend.server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  cleanup.push(async () => {
    await new Promise((resolve) => backend.server.close(resolve))
    await backend.database.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return baseUrl
}

async function startWithHttpsEnforcement() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moneywise-https-test-'))
  const backend = await createBackend({ nodeEnv: 'production', databaseProvider: 'sqlite', _testOnlyAllowProductionSqlite: true, host: '127.0.0.1', port: 0, databasePath: path.join(directory, 'test.sqlite'), sessionTtlDays: 30, accessTokenTtlMinutes: 15, authMode: 'password-only', logLevel: 'silent', authSecret: 'integration-test-secret-that-is-not-production', tlsTerminated: true, trustedProxies: ['loopback'] })
  await new Promise((resolve) => backend.server.listen(0, '127.0.0.1', resolve))
  cleanup.push(async () => { await new Promise((resolve) => backend.server.close(resolve)); await backend.database.close(); fs.rmSync(directory, { recursive: true, force: true }) })
  return `http://127.0.0.1:${backend.server.address().port}`
}

async function json(url, init) {
  const response = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
  return { response, body: await response.json() }
}

test('production refuses to start with hybrid authentication', async () => {
  await assert.rejects(
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
      AUTH_SECRET: 'a-production-test-secret-longer-than-32-bytes',
      DATABASE_PROVIDER: 'turso', TURSO_DATABASE_URL: 'libsql://test.example', TURSO_AUTH_TOKEN: 'test-token'
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
    AUTH_SECRET: 'a-production-test-secret-longer-than-32-bytes',
    DATABASE_PROVIDER: 'turso', TURSO_DATABASE_URL: 'libsql://test.example', TURSO_AUTH_TOKEN: 'test-token'
  }
  const missingTls = spawnSync(process.execPath, ['-e', "require('./config/env.cjs')"], {
    cwd: path.resolve(__dirname, '..'), env: baseEnvironment, encoding: 'utf8'
  })
  assert.notEqual(missingTls.status, 0)
  assert.match(missingTls.stderr, /PUBLIC_BASE_URL/)

  const valid = spawnSync(process.execPath, ['-e', "require('./config/env.cjs')"], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...baseEnvironment, PUBLIC_BASE_URL: 'https://sync.example.test', MONEYWISE_TLS_TERMINATED: 'true', MONEYWISE_TRUSTED_PROXIES: 'loopback' },
    encoding: 'utf8'
  })
  assert.equal(valid.status, 0, valid.stderr)
})

test('environment loader selects Render proxy mode only for a Render Web Service', () => {
  const script = "console.log(JSON.stringify(require('./config/env.cjs').config.trustedProxies))"
  const common = { ...process.env, NODE_ENV: 'development', MONEYWISE_TRUSTED_PROXIES: 'loopback' }
  const renderWeb = spawnSync(process.execPath, ['-e', script], { cwd: path.resolve(__dirname, '..'), env: { ...common, RENDER: 'true', RENDER_SERVICE_TYPE: 'web' }, encoding: 'utf8' })
  assert.equal(renderWeb.status, 0, renderWeb.stderr)
  assert.equal(renderWeb.stdout.trim(), '["render"]')

  const otherPlatform = spawnSync(process.execPath, ['-e', script], { cwd: path.resolve(__dirname, '..'), env: { ...common, RENDER: '', RENDER_SERVICE_TYPE: '' }, encoding: 'utf8' })
  assert.equal(otherPlatform.status, 0, otherPlatform.stderr)
  assert.equal(otherPlatform.stdout.trim(), '["loopback"]')
})

test('production database provider selection fails closed', () => {
  const script = "require('./config/env.cjs')"
  const common = { ...process.env, NODE_ENV: 'production', MONEYWISE_BACKEND_AUTH_MODE: 'password-only', AUTH_SECRET: 'a-production-test-secret-longer-than-32-bytes', PUBLIC_BASE_URL: 'https://sync.example.test', MONEYWISE_TLS_TERMINATED: 'true', MONEYWISE_TRUSTED_PROXIES: 'loopback' }
  const missing = spawnSync(process.execPath, ['-e', script], { cwd: path.resolve(__dirname, '..'), env: { ...common, DATABASE_PROVIDER: '' }, encoding: 'utf8' })
  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /DATABASE_PROVIDER/)
  const sqlite = spawnSync(process.execPath, ['-e', script], { cwd: path.resolve(__dirname, '..'), env: { ...common, DATABASE_PROVIDER: 'sqlite' }, encoding: 'utf8' })
  assert.notEqual(sqlite.status, 0)
  assert.match(sqlite.stderr, /production requires DATABASE_PROVIDER=turso/)
  const missingSecrets = spawnSync(process.execPath, ['-e', script], { cwd: path.resolve(__dirname, '..'), env: { ...common, DATABASE_PROVIDER: 'turso', TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '' }, encoding: 'utf8' })
  assert.notEqual(missingSecrets.status, 0)
  assert.match(missingSecrets.stderr, /TURSO_DATABASE_URL/)
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

test('production registration cannot claim a passwordless legacy dev account or its financial records', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moneywise-legacy-claim-test-'))
  const databasePath = path.join(directory, 'test.sqlite')

  async function launch(authMode, nodeEnv) {
    const backend = await createBackend({
      nodeEnv,
      databaseProvider: 'sqlite',
      ...(nodeEnv === 'production' ? { _testOnlyAllowProductionSqlite: true } : {}),
      host: '127.0.0.1',
      port: 0,
      databasePath,
      sessionTtlDays: 30,
      accessTokenTtlMinutes: 15,
      authMode,
      logLevel: 'silent',
      authSecret: 'integration-test-secret-that-is-not-production'
    })
    await new Promise((resolve) => backend.server.listen(0, '127.0.0.1', resolve))
    return {
      backend,
      baseUrl: `http://127.0.0.1:${backend.server.address().port}`,
      async close() {
        await new Promise((resolve) => backend.server.close(resolve))
        await backend.database.close()
      }
    }
  }

  let development
  let production
  cleanup.push(async () => {
    if (production) await production.close()
    if (development) await development.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  development = await launch('hybrid', 'development')
  const devSession = await json(`${development.baseUrl}/api/auth/dev-session`, {
    method: 'POST',
    body: JSON.stringify({ email: 'legacy-victim@example.com', deviceId: 'legacy-device' })
  })
  assert.equal(devSession.response.status, 201)
  const seeded = await json(`${development.baseUrl}/api/sync/push`, {
    method: 'POST',
    headers: { authorization: `Bearer ${devSession.body.accessToken}` },
    body: JSON.stringify({
      deviceId: 'legacy-device',
      requestId: 'legacy-seed-request',
      changes: [{
        entityType: 'income',
        recordId: 'victim-private-income',
        payload: { id: 'victim-private-income', name: 'Private salary', groupName: 'Primary', amount: 5000, date: '2026-08-01', type: 'fixed', recurring: false, notes: '' }
      }]
    })
  })
  assert.equal(seeded.response.status, 200)
  development.backend.db.sqlite.prepare(`
    INSERT INTO users (id, email, password_hash, status, created_at, updated_at)
    VALUES (?, ?, NULL, 'inactive', ?, ?)
  `).run('inactive-legacy-user', 'inactive-legacy@example.com', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  await development.close()
  development = null

  production = await launch('password-only', 'production')
  const legacySessionReplay = await json(`${production.baseUrl}/api/sync/bootstrap`, {
    method: 'GET', headers: { authorization: `Bearer ${devSession.body.accessToken}` }
  })
  assert.equal(legacySessionReplay.response.status, 401)
  const claim = await json(`${production.baseUrl}/api/auth/register`, {
    method: 'POST',
    body: JSON.stringify({ email: 'legacy-victim@example.com', password: 'attacker-controlled-password', deviceId: 'attacker-device' })
  })

  assert.notEqual(claim.response.status, 201, 'public registration claimed a pre-existing passwordless account')
  assert.equal(claim.body.accessToken, undefined)

  const user = production.backend.db.sqlite.prepare('SELECT id, password_hash, status FROM users WHERE email = ?').get('legacy-victim@example.com')
  assert.equal(user.id, devSession.body.user.id)
  assert.equal(user.password_hash, null)
  assert.equal(user.status, 'recovery-required')
  const record = production.backend.db.sqlite.prepare('SELECT user_id, payload_json FROM finance_records WHERE record_id = ?').get('victim-private-income')
  assert.equal(record.user_id, user.id)
  assert.equal(JSON.parse(record.payload_json).name, 'Private salary')

  const unrelated = await json(`${production.baseUrl}/api/auth/register`, {
    method: 'POST',
    body: JSON.stringify({ email: 'new-owner@example.com', password: 'new-owner-secure-password', deviceId: 'new-owner-device' })
  })
  assert.equal(unrelated.response.status, 201)

  const inactiveClaim = await json(`${production.baseUrl}/api/auth/register`, {
    method: 'POST',
    body: JSON.stringify({ email: 'inactive-legacy@example.com', password: 'attacker-controlled-password', deviceId: 'attacker-device' })
  })
  assert.equal(inactiveClaim.response.status, 409)
  const inactive = production.backend.db.sqlite.prepare('SELECT password_hash, status FROM users WHERE id = ?').get('inactive-legacy-user')
  assert.equal(inactive.password_hash, null)
  assert.equal(inactive.status, 'recovery-required')
})

test('registration never takes ownership of an existing normal or inactive passwordless account', async () => {
  const baseUrl = await start()
  const normal = await json(`${baseUrl}/api/auth/register`, {
    method: 'POST', body: JSON.stringify({ email: 'normal@example.com', password: 'original-secure-password', deviceId: 'owner' })
  })
  assert.equal(normal.response.status, 201)
  const normalClaim = await json(`${baseUrl}/api/auth/register`, {
    method: 'POST', body: JSON.stringify({ email: 'normal@example.com', password: 'attacker-password', deviceId: 'attacker' })
  })
  assert.equal(normalClaim.response.status, 409)

})

test('public registration is rate limited independently of login', async () => {
  const baseUrl = await start()
  let result
  for (let index = 0; index < 6; index += 1) {
    result = await json(`${baseUrl}/api/auth/register`, {
      method: 'POST', body: JSON.stringify({ email: `registration-load-${index}@example.com`, password: 'legitimate-secure-password', deviceId: 'load-test' })
    })
  }
  assert.equal(result.response.status, 429)
  assert.match(result.body.error, /registration attempts/i)
})

test('per-client rejected registration attempts do not exhaust the global registration quota', async () => {
  const baseUrl = await start('password-only', 'production', { trustedProxies: ['loopback'] })
  const statuses = []
  for (let index = 0; index < 100; index += 1) {
    const result = await json(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.10' },
      body: JSON.stringify({ email: `abusive-${index}@example.com`, password: 'legitimate-secure-password', deviceId: 'abusive-client' })
    })
    statuses.push(result.response.status)
  }
  assert.equal(statuses.filter((status) => status === 201).length, 5)
  assert.equal(statuses.filter((status) => status === 429).length, 95)

  const unrelated = await json(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.20' },
    body: JSON.stringify({ email: 'unrelated-legitimate@example.com', password: 'legitimate-secure-password', deviceId: 'unrelated-client' })
  })
  assert.equal(unrelated.response.status, 201, 'per-client rejected requests consumed global registration capacity')
})

test('registration admission is concurrent-safe, bounded, and recovers after limiter expiry', async () => {
  let timestamp = 1_000
  let hashingAdmissions = 0
  const registrationLimiter = createRateLimiter({ limit: 2, windowMs: 100, maxKeys: 4, now: () => timestamp })
  const globalRegistrationLimiter = createRateLimiter({ limit: 3, windowMs: 100, maxKeys: 1, now: () => timestamp })
  const handlers = createAuthHandlers({
    authService: {
      async registerWithPassword(parsed) {
        hashingAdmissions += 1
        return { user: { email: parsed.email } }
      }
    },
    registrationLimiter,
    globalRegistrationLimiter,
    loginLimiter: createRateLimiter({ limit: 1, windowMs: 100, now: () => timestamp }),
    sendJson(response, status, body) { response.status = status; response.body = body }
  })
  async function attempt(clientIp, index) {
    const request = { clientIp, socket: {}, once() {} }
    const response = {}
    await handlers.register(request, response, { email: `user-${clientIp.replaceAll('.', '-')}-${index}@example.com`, password: 'legitimate-secure-password', deviceId: 'test' })
    return response.status
  }

  const abusive = await Promise.all(Array.from({ length: 20 }, (_, index) => attempt('198.51.100.1', index)))
  assert.equal(abusive.filter((status) => status === 201).length, 2)
  assert.equal(abusive.filter((status) => status === 429).length, 18)
  assert.equal(hashingAdmissions, 2, 'per-client rejected requests reached password hashing')
  assert.equal(await attempt('203.0.113.1', 1), 201)
  assert.equal(hashingAdmissions, 3)
  assert.equal(await attempt('203.0.113.2', 1), 429, 'admitted requests must enforce the true global quota')
  assert.equal(hashingAdmissions, 3)

  timestamp += 101
  assert.equal(await attempt('203.0.113.2', 2), 201)
  assert.equal(hashingAdmissions, 4, 'registration did not recover after limiter expiry')
  assert.ok(registrationLimiter.size() <= 4)
  assert.equal(globalRegistrationLimiter.size(), 1)
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
