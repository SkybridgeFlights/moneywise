const path = require('node:path')
const { config } = require('../config/env.cjs')
const { safeRestore } = require('../operations/restore.cjs')

const sourceArgument = process.argv.find((argument) => argument.startsWith('--from='))
if (!sourceArgument || process.env.MONEYWISE_CONFIRM_RESTORE !== 'YES') {
  console.error('Restore requires --from=<backup.sqlite> and MONEYWISE_CONFIRM_RESTORE=YES. Stop the backend before restoring.')
  process.exit(1)
}

const source = path.resolve(sourceArgument.slice('--from='.length))
const target = config.databasePath
const result = safeRestore({ source, target, expectedSchemaVersion: 2 })
console.log(JSON.stringify({ event: 'restore_completed', ...result }))
