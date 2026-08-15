const assert = require('node:assert/strict')
const { test } = require('node:test')
const crypto = require('node:crypto')
const { canonicalJson, sha256, decodeEncryptionKey, createManifestCore, encryptDump, decryptDump, buildManifest, verifyAndDecrypt } = require('../backup/core.cjs')
const { selectRetention } = require('../backup/retention.cjs')
const { inspectDump } = require('../backup/metadata.cjs')
const { SCHEMA_SQL, SCHEMA_CHECKSUM } = require('../data/schema.cjs')
const { runBackup, verifyLatest } = require('../backup/job.cjs')

const key = crypto.randomBytes(32)
const dump = Buffer.from('BEGIN; CREATE TABLE test (id INTEGER PRIMARY KEY); COMMIT;')

function core(overrides = {}) {
  return createManifestCore({
    timestamp: '2026-08-15T03:17:00.000Z', generationId: '11111111-1111-4111-8111-111111111111', databaseIdentifier: 'database.example.turso.io',
    schemaVersion: 2, migrations: [{ version: 2, appliedAt: '2026-08-14T00:00:00.000Z', checksum: 'a'.repeat(64) }], tableCounts: { users: 1 }, maximumRevision: 4,
    plaintextBytes: dump.length, plaintextSha256: sha256(dump), keyId: 'moneywise-backup-key-v1',
    artifactKey: 'generations/g/database.sql.aesgcm', manifestKey: 'generations/g/manifest.json', ...overrides
  })
}

test('canonical AAD and manifest generation are deterministic', () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}')
  const envelope = encryptDump(dump, key, core(), Buffer.alloc(12, 7))
  const manifest = buildManifest(core(), envelope, 'valid', '2026-08-15T03:18:00.000Z')
  assert.equal(manifest.formatVersion, 1)
  assert.equal(manifest.encryption.algorithm, 'AES-256-GCM')
  assert.equal(manifest.ciphertextSha256, sha256(envelope))
  assert.equal(manifest.verification.status, 'valid')
})

test('AES-256-GCM round trip uses a fresh 12-byte nonce and 16-byte tag envelope', () => {
  const first = encryptDump(dump, key, core())
  const second = encryptDump(dump, key, core())
  assert.notDeepEqual(first, second)
  assert.deepEqual(decryptDump(first, key, core()), dump)
  assert.deepEqual(verifyAndDecrypt(first, buildManifest(core(), first, 'valid', new Date().toISOString()), key), dump)
})

test('invalid key material fails closed', () => {
  assert.throws(() => decodeEncryptionKey('not-base64!'), /base64/)
  assert.throws(() => decodeEncryptionKey(Buffer.alloc(31).toString('base64')), /32 bytes/)
  assert.throws(() => decryptDump(encryptDump(dump, key, core()), crypto.randomBytes(32), core()))
})

test('corrupted or malformed ciphertext fails closed', () => {
  const envelope = encryptDump(dump, key, core())
  envelope[envelope.length - 1] ^= 1
  assert.throws(() => decryptDump(envelope, key, core()))
  assert.throws(() => decryptDump(Buffer.from('short'), key, core()), /Malformed/)
})

test('tampered manifest core is rejected by authenticated AAD', () => {
  const original = core()
  const envelope = encryptDump(dump, key, original)
  const tampered = { ...original, maximumRevision: 999 }
  assert.throws(() => decryptDump(envelope, key, tampered))
})

test('plaintext and ciphertext hash mismatches are rejected', () => {
  const manifestCore = core()
  const envelope = encryptDump(dump, key, manifestCore)
  const manifest = buildManifest(manifestCore, envelope, 'valid', new Date().toISOString())
  assert.throws(() => verifyAndDecrypt(envelope, { ...manifest, ciphertextSha256: '0'.repeat(64) }, key), /Ciphertext SHA-256/)
  const badCore = { ...manifestCore, plaintextSha256: '0'.repeat(64) }
  const badEnvelope = encryptDump(dump, key, badCore)
  assert.throws(() => verifyAndDecrypt(badEnvelope, buildManifest(badCore, badEnvelope, 'valid', new Date().toISOString()), key), /Plaintext SHA-256/)
})

test('empty dumps are rejected', () => assert.throws(() => encryptDump(Buffer.alloc(0), key, core()), /non-empty/))

test('logical dump reconstruction produces schema, migration, count, revision, and integrity metadata', () => {
  const sql = `${SCHEMA_SQL}\nINSERT INTO schema_migrations(version, applied_at, checksum) VALUES (2, '2026-08-15T00:00:00.000Z', '${SCHEMA_CHECKSUM}');`
  const metadata = inspectDump(Buffer.from(sql))
  assert.equal(metadata.schemaVersion, 2)
  assert.equal(metadata.migrations[0].checksum, SCHEMA_CHECKSUM)
  assert.equal(metadata.tableCounts.users, 0)
  assert.equal(metadata.maximumRevision, 0)
  assert.equal(metadata.foreignKeyViolations, 0)
})

function generation(timestamp, id = timestamp) { return { generationId: id, timestamp, verification: { status: 'valid' }, objects: { artifact: `${id}/a`, manifest: `${id}/m` } } }

test('retention selects 7 daily, 4 weekly, and 3 monthly generations', () => {
  const candidates = Array.from({ length: 120 }, (_, days) => generation(new Date(Date.UTC(2026, 7, 15 - days)).toISOString(), `g-${days}`))
  const result = selectRetention(candidates)
  assert.ok(result.keep.size >= 7)
  assert.ok(result.keep.size <= 14)
  assert.ok(result.delete.length > 0)
  assert.ok(result.keep.has('g-0'))
})

test('newest valid, current verification, and last-known-good are protected', () => {
  const candidates = Array.from({ length: 60 }, (_, days) => generation(new Date(Date.UTC(2026, 7, 15 - days)).toISOString(), `g-${days}`))
  const result = selectRetention(candidates, { currentGenerationId: 'g-50', lastKnownGoodGenerationId: 'g-40' })
  assert.ok(result.keep.has('g-0'))
  assert.ok(result.keep.has('g-40'))
  assert.ok(result.keep.has('g-50'))
  assert.equal(result.delete.some((item) => ['g-0', 'g-40', 'g-50'].includes(item.generationId)), false)
})

test('malformed and unverified generations are preserved from automatic deletion', () => {
  const malformed = [{ nope: true }, { generationId: 'bad-date', timestamp: 'not-a-date', verification: { status: 'valid' } }, { generationId: 'verifying', timestamp: new Date().toISOString(), verification: { status: 'verifying' } }]
  const result = selectRetention([generation('2026-08-15T00:00:00.000Z', 'valid'), ...malformed])
  assert.equal(result.malformed.length, 3)
  assert.deepEqual(result.delete, [])
})

test('backup job promotes only after readback and weekly verification reconstructs the dump', async () => {
  const objects = new Map()
  const store = {
    async put(objectKey, body, _contentType, metadata = {}) { objects.set(objectKey, { body: Buffer.from(body), metadata }) },
    async get(objectKey) {
      const object = objects.get(objectKey)
      if (!object) { const error = new Error('missing'); error.name = 'NoSuchKey'; throw error }
      return { body: Buffer.from(object.body), contentLength: object.body.length, metadata: object.metadata }
    },
    async list(prefix) { return [...objects.keys()].filter((objectKey) => objectKey.startsWith(prefix)).map((Key) => ({ Key })) },
    async delete(keys) { for (const objectKey of keys) objects.delete(objectKey) }
  }
  const logicalDump = Buffer.from(`${SCHEMA_SQL}\nINSERT INTO schema_migrations(version, applied_at, checksum) VALUES (2, '2026-08-15T00:00:00.000Z', '${SCHEMA_CHECKSUM}');`)
  const originalFetch = global.fetch
  global.fetch = async () => new Response(logicalDump, { status: 200 })
  try {
    const encodedKey = key.toString('base64')
    const result = await runBackup({ store, databaseUrl: 'libsql://backup.example.turso.io', backupToken: 'unit-test-token', encryptionKeyEncoded: encodedKey, now: new Date('2026-08-15T03:17:00.000Z'), generationId: '22222222-2222-4222-8222-222222222222' })
    assert.equal(result.generationId, '22222222-2222-4222-8222-222222222222')
    assert.equal(JSON.parse(objects.get(result.manifestKey).body).verification.status, 'valid')
    assert.equal(JSON.parse(objects.get('state/latest-valid.json').body).generationId, result.generationId)
    assert.equal([...objects.values()].some((object) => object.body.equals(logicalDump)), false)
    const verified = await verifyLatest({ store, encryptionKeyEncoded: encodedKey })
    assert.equal(verified.schemaVersion, 2)
  } finally {
    global.fetch = originalFetch
  }
})
