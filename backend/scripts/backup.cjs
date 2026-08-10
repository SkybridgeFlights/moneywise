const { config } = require('../config/env.cjs')
const { createBackup } = require('../operations/backups.cjs')

createBackup(config.databasePath, config.backupDirectory)
  .then(({ backupPath, manifest }) => console.log(JSON.stringify({ event: 'backup_created', backupPath, ...manifest })))
  .catch((error) => { console.error(error.message); process.exitCode = 1 })
