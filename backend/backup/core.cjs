const crypto = require('node:crypto')

const ENVELOPE_MAGIC = Buffer.from('MWBKP001')
const ENVELOPE_VERSION = 1
const FORMAT_VERSION = 1
const NONCE_BYTES = 12
const TAG_BYTES = 16
const HEADER_BYTES = ENVELOPE_MAGIC.length + 4 + NONCE_BYTES + TAG_BYTES

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function decodeEncryptionKey(encoded) {
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('BACKUP_ENCRYPTION_KEY must be base64 encoded.')
  const key = Buffer.from(encoded, 'base64')
  if (key.length !== 32 || key.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) throw new Error('BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes.')
  return key
}

function createManifestCore(input) {
  return {
    formatVersion: FORMAT_VERSION,
    timestamp: input.timestamp,
    generationId: input.generationId,
    databaseIdentifier: input.databaseIdentifier,
    exportType: 'turso-logical-sql-dump',
    schemaVersion: input.schemaVersion,
    migrations: input.migrations,
    tableCounts: input.tableCounts,
    maximumRevision: input.maximumRevision,
    plaintextBytes: input.plaintextBytes,
    plaintextSha256: input.plaintextSha256,
    encryption: { algorithm: 'AES-256-GCM', envelopeVersion: ENVELOPE_VERSION, keyId: input.keyId },
    objects: { artifact: input.artifactKey, manifest: input.manifestKey }
  }
}

function encryptDump(plaintext, key, manifestCore, nonce = crypto.randomBytes(NONCE_BYTES)) {
  if (!Buffer.isBuffer(plaintext) || plaintext.length === 0) throw new Error('Turso dump must be non-empty.')
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('AES-256-GCM requires a 32-byte key.')
  if (!Buffer.isBuffer(nonce) || nonce.length !== NONCE_BYTES) throw new Error('AES-256-GCM requires a 12-byte nonce.')
  const aad = Buffer.from(canonicalJson(manifestCore), 'utf8')
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES })
  cipher.setAAD(aad)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  const header = Buffer.concat([ENVELOPE_MAGIC, Buffer.from([ENVELOPE_VERSION, NONCE_BYTES, TAG_BYTES, 0]), nonce, tag])
  return Buffer.concat([header, ciphertext])
}

function decryptDump(envelope, key, manifestCore) {
  if (!Buffer.isBuffer(envelope) || envelope.length <= HEADER_BYTES) throw new Error('Malformed encrypted backup envelope.')
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('AES-256-GCM requires a 32-byte key.')
  if (!envelope.subarray(0, ENVELOPE_MAGIC.length).equals(ENVELOPE_MAGIC)) throw new Error('Malformed encrypted backup envelope.')
  const version = envelope[8]
  const nonceLength = envelope[9]
  const tagLength = envelope[10]
  if (version !== ENVELOPE_VERSION || nonceLength !== NONCE_BYTES || tagLength !== TAG_BYTES || envelope[11] !== 0) throw new Error('Unsupported or malformed encrypted backup envelope.')
  const nonce = envelope.subarray(12, 12 + NONCE_BYTES)
  const tag = envelope.subarray(12 + NONCE_BYTES, HEADER_BYTES)
  const ciphertext = envelope.subarray(HEADER_BYTES)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES })
  decipher.setAAD(Buffer.from(canonicalJson(manifestCore), 'utf8'))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

function buildManifest(core, envelope, status = 'verifying', verifiedAt = null) {
  return {
    ...core,
    ciphertextBytes: envelope.length,
    ciphertextSha256: sha256(envelope),
    verification: { status, verifiedAt }
  }
}

function verifyAndDecrypt(envelope, manifest, key) {
  if (!manifest || manifest.formatVersion !== FORMAT_VERSION) throw new Error('Unsupported backup manifest format.')
  if (manifest.ciphertextBytes !== envelope.length) throw new Error('Ciphertext byte-size mismatch.')
  if (manifest.ciphertextSha256 !== sha256(envelope)) throw new Error('Ciphertext SHA-256 mismatch.')
  const { ciphertextBytes: _bytes, ciphertextSha256: _hash, verification: _verification, ...core } = manifest
  const plaintext = decryptDump(envelope, key, core)
  if (core.plaintextBytes !== plaintext.length) throw new Error('Plaintext byte-size mismatch.')
  if (core.plaintextSha256 !== sha256(plaintext)) throw new Error('Plaintext SHA-256 mismatch.')
  return plaintext
}

module.exports = { FORMAT_VERSION, HEADER_BYTES, canonicalJson, sha256, decodeEncryptionKey, createManifestCore, encryptDump, decryptDump, buildManifest, verifyAndDecrypt }
