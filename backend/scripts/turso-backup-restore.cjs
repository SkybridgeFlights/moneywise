const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createClient } = require('@libsql/client')
const { createR2Store, readJson } = require('../backup/r2.cjs')
const { decodeEncryptionKey, verifyAndDecrypt } = require('../backup/core.cjs')
const { inspectDump } = require('../backup/metadata.cjs')

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
  const result = spawnSync('turso', args, { encoding: 'utf8', env: { ...process.env, TURSO_API_TOKEN: token }, shell: false })
  if (result.status !== 0) throw new Error(`Turso CLI command failed (${args.slice(0, 3).join(' ')}).`)
  return result.stdout.trim()
}

async function main() {
  const generationId = argument('--generation')
  const newDatabaseName = argument('--database-name')
  if (!generationId || !newDatabaseName || !/^mw-restore-[a-z0-9-]+$/.test(newDatabaseName)) throw new Error('Provide --generation and a disposable --database-name beginning with mw-restore-.')
  if (process.argv.includes('--cutover')) throw new Error('This tool never performs production cutover.')
  const platformToken = requiredEnvironment('TURSO_API_TOKEN')
  const organization = requiredEnvironment('TURSO_ORG')
  const store = createR2Store()
  const objects = await store.list('generations/')
  const manifestObject = objects.find((item) => item.Key?.includes(generationId) && item.Key.endsWith('/manifest.json'))
  if (!manifestObject) throw new Error('Requested generation was not found.')
  const manifest = await readJson(store, manifestObject.Key)
  if (manifest.verification?.status !== 'valid' || manifest.generationId !== generationId) throw new Error('Requested generation is not valid.')
  const artifact = await store.get(manifest.objects.artifact)
  const dump = verifyAndDecrypt(artifact.body, manifest, decodeEncryptionKey(requiredEnvironment('BACKUP_ENCRYPTION_KEY')))
  const expected = inspectDump(dump)
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moneywise-turso-restore-'))
  const dumpPath = path.join(directory, 'database.sql')
  try {
    fs.writeFileSync(dumpPath, dump, { flag: 'wx', mode: 0o600 })
    runTurso(['db', 'create', newDatabaseName, '--org', organization, '--from-dump', dumpPath, '--wait'], platformToken)
    const databaseUrl = runTurso(['db', 'show', newDatabaseName, '--org', organization, '--url'], platformToken)
    const databaseToken = runTurso(['db', 'tokens', 'create', newDatabaseName, '--org', organization, '--expiration', '1h'], platformToken)
    const client = createClient({ url: databaseUrl, authToken: databaseToken })
    try {
      const migrations = Array.from((await client.execute('SELECT version, applied_at, checksum FROM schema_migrations ORDER BY version')).rows, (row) => ({ version: Number(row.version), appliedAt: row.applied_at, checksum: row.checksum }))
      const maximumRevision = Number(Array.from((await client.execute('SELECT COALESCE(MAX(revision), 0) AS revision FROM sync_revisions')).rows)[0].revision)
      const foreignKeys = Array.from((await client.execute('PRAGMA foreign_key_check')).rows)
      if (JSON.stringify(migrations) !== JSON.stringify(expected.migrations) || maximumRevision !== expected.maximumRevision || foreignKeys.length !== 0) throw new Error('Disposable Turso restore verification failed.')
      for (const [table, count] of Object.entries(expected.tableCounts)) {
        const restored = Number(Array.from((await client.execute(`SELECT COUNT(*) AS count FROM "${table.replaceAll('"', '""')}"`)).rows)[0].count)
        if (restored !== count) throw new Error(`Restored table count mismatch for ${table}.`)
      }
    } finally { client.close() }
    process.stdout.write(`Disposable Turso database ${organization}/${newDatabaseName} restored and verified. Production was not changed.\n`)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`Restore drill failed: ${error.message}\n`)
  process.exitCode = 1
})
