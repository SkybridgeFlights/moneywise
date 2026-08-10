const fs = require('node:fs')
const path = require('node:path')
const BetterSqlite3 = require('better-sqlite3')
const { assertHealthyDatabase, verifyBackup } = require('./backups.cjs')

function validateRestoredDatabase(filePath, expectedSchemaVersion) {
  assertHealthyDatabase(filePath)
  const database = new BetterSqlite3(filePath, { readonly: true, fileMustExist: true })
  try {
    const schemaVersion = database.pragma('user_version', { simple: true })
    if (schemaVersion !== expectedSchemaVersion) throw new Error(`Restored schema version ${schemaVersion} does not match expected ${expectedSchemaVersion}.`)
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','finance_records','sessions')").all()
    if (expectedSchemaVersion >= 2 && tables.length !== 3) throw new Error('Restored database is missing expected application tables.')
    database.prepare('SELECT COUNT(*) AS count FROM users').get()
    database.prepare('SELECT COUNT(*) AS count FROM finance_records').get()
    return { schemaVersion }
  } finally { database.close() }
}

function quarantineSidecars(target, directory, label) {
  fs.mkdirSync(directory, { recursive: true })
  const moved = []
  for (const suffix of ['-wal', '-shm']) {
    const source = `${target}${suffix}`
    if (!fs.existsSync(source)) continue
    const destination = path.join(directory, `${path.basename(target)}.${label}${suffix}`)
    if (fs.existsSync(destination)) fs.unlinkSync(source)
    else fs.renameSync(source, destination)
    moved.push(destination)
  }
  return moved
}

function safeRestore({ source, target, expectedSchemaVersion = 2, injectFailure }) {
  if (fs.existsSync(`${target}.backend.lock`)) throw new Error('Restore refused while backend activity lock exists. Stop the backend first.')
  const lockPath = `${source}.lock`
  fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const temporary = `${target}.restore-tmp-${stamp}`
  const rollback = `${target}.pre-restore-${stamp}`
  const replaced = `${target}.replaced-${stamp}`
  const sidecarDirectory = `${target}.restore-sidecars-${stamp}`
  let activated = false
  let replacementStarted = false
  try {
    verifyBackup(source, Number.MAX_SAFE_INTEGER)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL)
    validateRestoredDatabase(temporary, expectedSchemaVersion)
    injectFailure?.('temporary-verified')
    if (!fs.existsSync(target)) throw new Error('Restore target is missing; refusing to initialize an empty database implicitly.')

    // Preserve sidecars before SQLite inspects them. Invalid/stale sidecars may
    // be discarded by SQLite, while a valid WAL remains attached for snapshot.
    fs.mkdirSync(sidecarDirectory, { recursive: true })
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${target}${suffix}`
      if (fs.existsSync(sidecar)) fs.copyFileSync(sidecar, path.join(sidecarDirectory, `${path.basename(target)}.old${suffix}`), fs.constants.COPYFILE_EXCL)
    }

    // Open the live generation while its WAL is still attached. VACUUM INTO reads
    // one consistent SQLite snapshot, including committed pages currently in WAL.
    const current = new BetterSqlite3(target, { fileMustExist: true })
    try {
      current.prepare('VACUUM INTO ?').run(rollback)
    } finally { current.close() }
    validateRestoredDatabase(rollback, expectedSchemaVersion)
    injectFailure?.('rollback-verified')
    quarantineSidecars(target, sidecarDirectory, 'old')
    fs.renameSync(target, replaced)
    replacementStarted = true
    injectFailure?.('target-replaced')
    fs.renameSync(temporary, target)
    activated = true
    injectFailure?.('activated')
    validateRestoredDatabase(target, expectedSchemaVersion)
    if (fs.existsSync(replaced)) fs.unlinkSync(replaced)
    return { target, rollback, sidecarDirectory }
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    if (activated || replacementStarted) {
      for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(`${target}${suffix}`)) fs.unlinkSync(`${target}${suffix}`)
      if (fs.existsSync(rollback)) {
        const recovery = `${target}.rollback-recovery-${stamp}`
        fs.copyFileSync(rollback, recovery, fs.constants.COPYFILE_EXCL)
        validateRestoredDatabase(recovery, expectedSchemaVersion)
        fs.renameSync(recovery, target)
        validateRestoredDatabase(target, expectedSchemaVersion)
      }
    }
    throw error
  } finally {
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath)
  }
}

module.exports = { quarantineSidecars, safeRestore, validateRestoredDatabase }
