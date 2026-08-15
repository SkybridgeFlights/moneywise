const { createR2Store } = require('../backup/r2.cjs')
const { runBackup } = require('../backup/job.cjs')

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required.`)
  return value
}

runBackup({
  store: createR2Store(),
  databaseUrl: required('TURSO_DATABASE_URL'),
  backupToken: required('TURSO_BACKUP_TOKEN'),
  encryptionKeyEncoded: required('BACKUP_ENCRYPTION_KEY')
}).then((result) => {
  process.stdout.write(`Backup generation ${result.generationId} verified; retained=${result.retainedGenerations}; deleted=${result.deletedGenerations}; malformed-preserved=${result.malformedGenerations}.\n`)
}).catch((error) => {
  process.stderr.write(`Backup failed: ${error.message}\n`)
  process.exitCode = 1
})
