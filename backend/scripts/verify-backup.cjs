const { config } = require('../config/env.cjs')
const { findLatestBackup, verifyBackup } = require('../operations/backups.cjs')

try {
  const latest = findLatestBackup(config.backupDirectory)
  if (!latest) throw new Error(`No backup is available in ${config.backupDirectory}.`)
  const result = verifyBackup(latest, config.backupMaxAgeHours)
  console.log(JSON.stringify({ event: 'backup_verified', backupPath: result.backupPath, ageHours: result.ageHours }))
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
