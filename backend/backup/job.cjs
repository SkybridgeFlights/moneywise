const { randomUUID } = require('node:crypto')
const { createManifestCore, decodeEncryptionKey, encryptDump, buildManifest, sha256, verifyAndDecrypt } = require('./core.cjs')
const { inspectDump } = require('./metadata.cjs')
const { selectRetention } = require('./retention.cjs')
const { readJson } = require('./r2.cjs')

function databaseIdentifier(urlString) {
  const url = new URL(urlString.replace(/^libsql:/, 'https:'))
  return url.hostname
}

function dumpUrl(urlString) {
  const url = new URL(urlString.replace(/^libsql:/, 'https:'))
  url.pathname = `${url.pathname.replace(/\/$/, '')}/dump`
  url.search = ''
  url.hash = ''
  return url.toString()
}

async function fetchTursoDump(urlString, token) {
  const response = await fetch(dumpUrl(urlString), { headers: { authorization: `Bearer ${token}` }, redirect: 'error' })
  if (!response.ok) throw new Error(`Turso export failed with HTTP ${response.status}.`)
  const dump = Buffer.from(await response.arrayBuffer())
  if (dump.length === 0) throw new Error('Turso export returned an empty dump.')
  return dump
}

function pointerFor(manifest) {
  return { formatVersion: 1, generationId: manifest.generationId, timestamp: manifest.timestamp, artifactKey: manifest.objects.artifact, manifestKey: manifest.objects.manifest, ciphertextSha256: manifest.ciphertextSha256 }
}

async function loadValidManifests(store) {
  const objects = await store.list('generations/')
  const manifests = []
  const malformed = []
  for (const object of objects.filter((item) => item.Key?.endsWith('/manifest.json'))) {
    try { manifests.push(await readJson(store, object.Key)) } catch { malformed.push({ objectKey: object.Key }) }
  }
  return { manifests, malformed }
}

async function applyRetention(store, currentGenerationId, lastKnownGoodGenerationId) {
  const loaded = await loadValidManifests(store)
  const selection = selectRetention(loaded.manifests, { currentGenerationId, lastKnownGoodGenerationId })
  const keys = selection.delete.flatMap((manifest) => [manifest.objects.artifact, manifest.objects.manifest])
  await store.delete(keys)
  return { deletedGenerations: selection.delete.length, retainedGenerations: selection.keep.size, malformedGenerations: selection.malformed.length + loaded.malformed.length }
}

async function runBackup({ store, databaseUrl, backupToken, encryptionKeyEncoded, now = new Date(), generationId = randomUUID() }) {
  const dump = await fetchTursoDump(databaseUrl, backupToken)
  const metadata = inspectDump(dump)
  const timestamp = now.toISOString()
  const safeTimestamp = timestamp.replaceAll(':', '-').replaceAll('.', '-')
  const prefix = `generations/${safeTimestamp}-${generationId}`
  const artifactKey = `${prefix}/database.sql.aesgcm`
  const manifestKey = `${prefix}/manifest.json`
  const key = decodeEncryptionKey(encryptionKeyEncoded)
  const core = createManifestCore({ timestamp, generationId, databaseIdentifier: databaseIdentifier(databaseUrl), ...metadata, plaintextBytes: dump.length, plaintextSha256: sha256(dump), keyId: 'moneywise-backup-key-v1', artifactKey, manifestKey })
  const envelope = encryptDump(dump, key, core)
  let manifest = buildManifest(core, envelope)
  await store.put(artifactKey, envelope, 'application/octet-stream', { sha256: manifest.ciphertextSha256, status: 'verifying' })
  await store.put(manifestKey, Buffer.from(JSON.stringify(manifest)), 'application/json', { status: 'verifying' })
  const artifactReadback = await store.get(artifactKey)
  const manifestReadback = JSON.parse((await store.get(manifestKey)).body.toString('utf8'))
  if (artifactReadback.contentLength !== envelope.length || artifactReadback.metadata.sha256 !== manifest.ciphertextSha256) throw new Error('R2 artifact metadata readback mismatch.')
  const plaintextReadback = verifyAndDecrypt(artifactReadback.body, manifestReadback, key)
  if (!plaintextReadback.equals(dump)) throw new Error('R2 artifact content readback mismatch.')
  manifest = buildManifest(core, envelope, 'valid', new Date().toISOString())
  await store.put(manifestKey, Buffer.from(JSON.stringify(manifest)), 'application/json', { status: 'valid', sha256: manifest.ciphertextSha256 })
  const latestPointer = pointerFor(manifest)
  const previousLastKnownGood = await readJson(store, 'state/last-known-good.json', true)
  await store.put('state/latest-valid.json', Buffer.from(JSON.stringify(latestPointer)), 'application/json', { status: 'valid' })
  await store.put('state/last-known-good.json', Buffer.from(JSON.stringify(latestPointer)), 'application/json', { status: 'valid' })
  const promotedManifest = await readJson(store, manifestKey)
  const latestReadback = await readJson(store, 'state/latest-valid.json')
  const knownGoodReadback = await readJson(store, 'state/last-known-good.json')
  if (promotedManifest.verification?.status !== 'valid' || latestReadback.generationId !== generationId || knownGoodReadback.generationId !== generationId) throw new Error('R2 valid-generation promotion readback failed.')
  const retention = await applyRetention(store, generationId, previousLastKnownGood?.generationId ?? generationId)
  return { generationId, timestamp, artifactKey, manifestKey, ...retention }
}

async function verifyLatest({ store, encryptionKeyEncoded }) {
  const pointer = await readJson(store, 'state/latest-valid.json')
  const manifest = await readJson(store, pointer.manifestKey)
  if (manifest.verification?.status !== 'valid' || manifest.generationId !== pointer.generationId) throw new Error('Latest-valid state does not reference a valid generation.')
  const artifact = await store.get(pointer.artifactKey)
  const plaintext = verifyAndDecrypt(artifact.body, manifest, decodeEncryptionKey(encryptionKeyEncoded))
  const metadata = inspectDump(plaintext)
  for (const field of ['schemaVersion', 'maximumRevision']) if (metadata[field] !== manifest[field]) throw new Error(`Restored ${field} does not match manifest.`)
  if (JSON.stringify(metadata.migrations) !== JSON.stringify(manifest.migrations)) throw new Error('Restored migration metadata does not match manifest.')
  if (JSON.stringify(metadata.tableCounts) !== JSON.stringify(manifest.tableCounts)) throw new Error('Restored table counts do not match manifest.')
  return { generationId: manifest.generationId, timestamp: manifest.timestamp, schemaVersion: metadata.schemaVersion, maximumRevision: metadata.maximumRevision }
}

module.exports = { databaseIdentifier, dumpUrl, fetchTursoDump, pointerFor, loadValidManifests, applyRetention, runBackup, verifyLatest }
