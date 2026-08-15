const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { createClient } = require('@libsql/client')
const { tursoAdapter } = require('../data/databaseAdapter.cjs')
const { createUserRepository } = require('../data/userRepository.cjs')
const { createSessionRepository } = require('../data/sessionRepository.cjs')
const { createRecordRepository } = require('../data/recordRepository.cjs')
const { createAuthService } = require('../services/authService.cjs')
const { createSyncService } = require('../services/syncService.cjs')
const { createR2Store, readJson } = require('../backup/r2.cjs')
const { decodeEncryptionKey, verifyAndDecrypt } = require('../backup/core.cjs')
const { EXPECTED_TABLES, inspectDump } = require('../backup/metadata.cjs')

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}
function requiredEnvironment(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required.`)
  return value
}
function runTurso(args, token) {
  const environment = Object.fromEntries(['PATH', 'HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'SystemRoot', 'PATHEXT'].filter((name) => process.env[name]).map((name) => [name, process.env[name]]))
  environment.TURSO_API_TOKEN = token
  const result = spawnSync('turso', args, { encoding: 'utf8', env: environment, shell: false })
  if (result.status !== 0) throw new Error(`Turso CLI command failed (${args.slice(0, 3).join(' ')}).`)
  return result.stdout.trim()
}
function rows(result) { return Array.from(result.rows, (row) => ({ ...row })) }
async function scalar(client, sql, args = []) { return Number(rows(await client.execute({ sql, args }))[0].value) }

async function verifyRestoredStructure(client, expected) {
  const tables = rows(await client.execute("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).map((row) => row.name)
  for (const table of EXPECTED_TABLES) assert.ok(tables.includes(table), `Missing restored table ${table}.`)
  const migrations = rows(await client.execute('SELECT version, applied_at, checksum FROM schema_migrations ORDER BY version')).map((row) => ({ version: Number(row.version), appliedAt: row.applied_at, checksum: row.checksum }))
  assert.deepEqual(migrations, expected.migrations)
  for (const [table, count] of Object.entries(expected.tableCounts)) assert.equal(await scalar(client, `SELECT COUNT(*) AS value FROM "${table.replaceAll('"', '""')}"`), count, `Restored table count mismatch for ${table}.`)
  assert.deepEqual(rows(await client.execute('PRAGMA foreign_key_check')), [])
  assert.equal(await scalar(client, 'SELECT COALESCE(MAX(revision), 0) AS value FROM sync_revisions'), expected.maximumRevision)
  assert.equal(await scalar(client, 'SELECT COUNT(*) AS value FROM finance_records WHERE deleted_at IS NOT NULL'), expected.tombstoneCount)
  assert.equal(await scalar(client, 'SELECT COUNT(*) AS value FROM (SELECT revision FROM finance_records GROUP BY revision HAVING COUNT(*) > 1)'), 0)
  assert.equal(await scalar(client, 'SELECT COUNT(*) AS value FROM sessions s LEFT JOIN users u ON u.id=s.user_id WHERE u.id IS NULL'), 0)
  assert.equal(await scalar(client, 'SELECT COUNT(*) AS value FROM finance_records f LEFT JOIN users u ON u.id=f.user_id WHERE u.id IS NULL'), 0)
  assert.equal(await scalar(client, 'SELECT COUNT(*) AS value FROM sync_requests r LEFT JOIN users u ON u.id=r.user_id WHERE u.id IS NULL'), 0)
  assert.equal(await scalar(client, 'SELECT COUNT(*) AS value FROM sync_requests WHERE json_valid(response_json)=0'), 0)
  assert.equal(await scalar(client, 'SELECT COUNT(*) AS value FROM finance_records WHERE json_valid(payload_json)=0'), 0)
  const requiredIndexes = ['idx_sessions_refresh_token_hash', 'idx_sessions_token_hash', 'idx_users_email', 'idx_finance_records_user_revision']
  const indexes = rows(await client.execute("SELECT name FROM sqlite_schema WHERE type='index'")).map((row) => row.name)
  for (const index of requiredIndexes) assert.ok(indexes.includes(index), `Missing restored index ${index}.`)
  if (expected.representative.financeRecords) {
    const restored = rows(await client.execute({ sql: 'SELECT sync_id, user_id, entity_type, record_id, payload_json, deleted_at, version, revision FROM finance_records WHERE sync_id=?', args: [expected.representative.financeRecords.sync_id] }))[0]
    assert.deepEqual(restored, expected.representative.financeRecords)
  }
  if (expected.representative.syncRequests) {
    const restored = rows(await client.execute({ sql: 'SELECT user_id, request_id, response_json FROM sync_requests WHERE user_id=? AND request_id=?', args: [expected.representative.syncRequests.user_id, expected.representative.syncRequests.request_id] }))[0]
    assert.deepEqual(restored, expected.representative.syncRequests)
  }
}

function expense(recordId, baseVersion, title = recordId) {
  return { entityType: 'expense', recordId, payload: { id: recordId, title, amount: 12.34, date: '2026-08-15', categoryId: 'restore-drill', paymentMethod: 'card', type: 'variable', recurring: false, notes: 'Disposable restore drill', tags: [], goalId: null, debtId: null, allocationKind: 'spend' }, ...(baseVersion === undefined ? {} : { baseVersion }) }
}

async function verifyBackendBehavior(database) {
  const id = randomUUID()
  const users = createUserRepository(database)
  const sessions = createSessionRepository(database)
  const records = createRecordRepository(database)
  const auth = createAuthService({ config: { nodeEnv: 'test', authMode: 'password-only', authSecret: `restore-${randomUUID()}-${randomUUID()}`, sessionTtlDays: 1, accessTokenTtlMinutes: 15 }, userRepository: users, sessionRepository: sessions })
  const sync = createSyncService({ recordRepository: records })
  const passwordA = `Restore-A-${randomUUID()}!`
  const passwordB = `Restore-B-${randomUUID()}!`
  const registeredA = await auth.registerWithPassword({ email: `restore-${id}-a@example.invalid`, password: passwordA, deviceId: 'restore-a' })
  const registeredB = await auth.registerWithPassword({ email: `restore-${id}-b@example.invalid`, password: passwordB, deviceId: 'restore-b' })
  const loginA = await auth.loginWithPassword({ email: registeredA.user.email, password: passwordA, deviceId: 'restore-login' })
  assert.equal((await auth.authenticateFromHeader(`Bearer ${loginA.accessToken}`)).user.id, registeredA.user.id)
  const rotated = await auth.refreshSession({ refreshToken: loginA.refreshToken, deviceId: 'restore-refresh' })
  await assert.rejects(() => auth.refreshSession({ refreshToken: loginA.refreshToken, deviceId: 'restore-old' }), /Invalid/)
  const payload = { deviceId: 'restore-a', requestId: `restore-request-${id}`, changes: [expense(`restore-${id}-one`), expense(`restore-${id}-two`)] }
  const first = await sync.pushBatch(registeredA.user.id, payload)
  assert.deepEqual(await sync.pushBatch(registeredA.user.id, payload), first)
  assert.equal((await sync.bootstrap(registeredA.user.id)).records.expense.filter((item) => item.id.startsWith(`restore-${id}`)).length, 2)
  assert.equal((await sync.bootstrap(registeredB.user.id)).records.expense?.some((item) => item.id.startsWith(`restore-${id}`)) ?? false, false)
  await sync.pushBatch(registeredB.user.id, { deviceId: 'restore-b', requestId: `restore-b-request-${id}`, changes: [expense(`restore-${id}-b`, undefined, 'B-only')] })
  assert.equal((await sync.bootstrap(registeredA.user.id)).records.expense.some((item) => item.id === `restore-${id}-b`), false)
  const changes = await sync.getChanges(registeredA.user.id, 0, 1)
  assert.equal(changes.changes.length, 1)
  assert.equal(changes.hasMore, true)
  const next = await sync.getChanges(registeredA.user.id, changes.cursor, 10)
  assert.equal(next.changes.length, 1)
  assert.ok(Number(next.cursor) > Number(changes.cursor))
  const conflict = await sync.pushBatch(registeredA.user.id, { deviceId: 'restore-a', requestId: `restore-conflict-${id}`, changes: [expense(`restore-${id}-must-not-exist`), expense(`restore-${id}-one`, 999)] })
  assert.equal(conflict.applied.length, 0)
  assert.equal(await records.findByUserAndRecord(registeredA.user.id, 'expense', `restore-${id}-must-not-exist`), null)
  await assert.rejects(() => sync.pushBatch(registeredA.user.id, { deviceId: 'restore-a', requestId: `restore-rollback-${id}`, changes: [expense(`restore-${id}-rollback`)] }, { injectFailure(point) { if (point === 'after-record-write') throw new Error('restore-drill-rollback') } }), /restore-drill-rollback/)
  assert.equal(await records.findByUserAndRecord(registeredA.user.id, 'expense', `restore-${id}-rollback`), null)
  assert.equal(await records.findRequest(registeredA.user.id, `restore-rollback-${id}`), null)
  await auth.logout((await auth.authenticateFromHeader(`Bearer ${rotated.accessToken}`)).session.id)
}

async function main() {
  let generationId = argument('--generation')
  const newDatabaseName = argument('--database-name')
  if (!generationId || !newDatabaseName || !/^mw-restore-[a-z0-9-]+$/.test(newDatabaseName)) throw new Error('Provide --generation and a disposable --database-name beginning with mw-restore-.')
  if (process.argv.includes('--cutover')) throw new Error('This tool never performs production cutover.')
  const platformToken = requiredEnvironment('TURSO_API_TOKEN')
  const organization = requiredEnvironment('TURSO_ORG')
  const store = createR2Store()
  const latest = await readJson(store, 'state/latest-valid.json')
  if (generationId === 'latest') generationId = latest.generationId
  assert.equal(latest.generationId, generationId, 'Requested generation is not latest-valid.')
  const manifest = await readJson(store, latest.manifestKey)
  assert.equal(manifest.verification?.status, 'valid')
  assert.equal(manifest.generationId, generationId)
  assert.equal(manifest.objects.artifact, latest.artifactKey)
  assert.equal(manifest.objects.manifest, latest.manifestKey)
  const artifact = await store.get(manifest.objects.artifact)
  const dump = verifyAndDecrypt(artifact.body, manifest, decodeEncryptionKey(requiredEnvironment('BACKUP_ENCRYPTION_KEY')))
  assert.ok(dump.length > 0)
  const expected = inspectDump(dump)
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moneywise-turso-restore-'))
  const dumpPath = path.join(directory, 'database.sql')
  let created = false
  try {
    fs.writeFileSync(dumpPath, dump, { flag: 'wx', mode: 0o600 })
    runTurso(['db', 'create', newDatabaseName, '--from-dump', dumpPath, '--wait'], platformToken)
    created = true
    const databaseUrl = runTurso(['db', 'show', newDatabaseName, '--url'], platformToken)
    const databaseToken = runTurso(['db', 'tokens', 'create', newDatabaseName, '--expiration', '1h'], platformToken)
    assert.match(databaseUrl, /^libsql:\/\//)
    assert.ok(databaseToken.length > 20)
    const client = createClient({ url: databaseUrl, authToken: databaseToken })
    const database = tursoAdapter(client)
    try {
      await verifyRestoredStructure(client, expected)
      await verifyBackendBehavior(database)
    } finally { await database.close() }
    runTurso(['db', 'destroy', newDatabaseName, '--yes'], platformToken)
    created = false
    process.stdout.write(`RESTORE_DRILL generation=${generationId} database=${newDatabaseName} download=pass decrypt=pass plaintext_hash=pass import=pass schema=pass counts=pass foreign_keys=pass revisions=pass ownership=pass representative_data=pass backend_behavior=pass cutover_simulation=pass cleanup=pass production_modified=no\n`)
  } catch (error) {
    if (created) process.stderr.write(`Restore drill failed; disposable database ${newDatabaseName} retained for diagnosis.\n`)
    throw error
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`Restore drill failed: ${error.message}\n`)
  process.exitCode = 1
})
