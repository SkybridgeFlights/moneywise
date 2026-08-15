const { createR2Store } = require('../backup/r2.cjs')
const { verifyLatest } = require('../backup/job.cjs')

const encryptionKeyEncoded = process.env.BACKUP_ENCRYPTION_KEY
if (!encryptionKeyEncoded) throw new Error('BACKUP_ENCRYPTION_KEY is required.')

verifyLatest({ store: createR2Store(), encryptionKeyEncoded }).then((result) => {
  process.stdout.write(`Backup generation ${result.generationId} downloaded, decrypted, and verified at schema ${result.schemaVersion}.\n`)
}).catch((error) => {
  process.stderr.write(`Backup verification failed: ${error.message}\n`)
  process.exitCode = 1
})
