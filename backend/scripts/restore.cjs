const fs = require('node:fs')
const path = require('node:path')
const { config } = require('../config/env.cjs')
const { assertHealthyDatabase, verifyBackup } = require('../operations/backups.cjs')

const sourceArgument = process.argv.find((argument) => argument.startsWith('--from='))
if (!sourceArgument || process.env.MONEYWISE_CONFIRM_RESTORE !== 'YES') {
  console.error('Restore requires --from=<backup.sqlite> and MONEYWISE_CONFIRM_RESTORE=YES. Stop the backend before restoring.')
  process.exit(1)
}

const source = path.resolve(sourceArgument.slice('--from='.length))
verifyBackup(source, Number.MAX_SAFE_INTEGER)
const target = config.databasePath
const temporary = `${target}.restore-tmp`
const rollback = `${target}.pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`
fs.mkdirSync(path.dirname(target), { recursive: true })
fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL)
assertHealthyDatabase(temporary)
if (fs.existsSync(target)) fs.renameSync(target, rollback)
try {
  fs.renameSync(temporary, target)
  assertHealthyDatabase(target)
  console.log(JSON.stringify({ event: 'restore_completed', target, rollback: fs.existsSync(rollback) ? rollback : null }))
} catch (error) {
  if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  if (!fs.existsSync(target) && fs.existsSync(rollback)) fs.renameSync(rollback, target)
  throw error
}
