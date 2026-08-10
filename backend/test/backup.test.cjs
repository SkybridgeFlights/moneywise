const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const BetterSqlite3 = require('better-sqlite3')
const { createDatabase } = require('../data/sqlite.cjs')
const { runMigrations } = require('../data/migrations.cjs')
const { applyRetention, createBackup, findLatestBackup, getBackupStatus, verifyBackup } = require('../operations/backups.cjs')
const { startBackupScheduler } = require('../operations/backupScheduler.cjs')
const { safeRestore } = require('../operations/restore.cjs')

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Timed out waiting for scheduled backup.')
}

test('creates a consistent SQLite backup with a verified checksum manifest', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moneywise-backup-test-'))
  const databasePath = path.join(directory, 'sync.sqlite')
  const backupDirectory = path.join(directory, 'backups')
  const db = createDatabase(databasePath)
  runMigrations(db)
  db.sqlite.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)').run('u1', 'backup@example.test', null, 'active', '2026-08-10', '2026-08-10')
  db.sqlite.close()

  const created = await createBackup(databasePath, backupDirectory, new Date('2026-08-10T12:00:00.000Z'))
  assert.equal(findLatestBackup(backupDirectory), created.backupPath)
  const verified = verifyBackup(created.backupPath, 24, new Date('2026-08-10T13:00:00.000Z'))
  assert.equal(verified.manifest.sha256.length, 64)

  const restored = createDatabase(created.backupPath)
  assert.equal(restored.sqlite.prepare('SELECT email FROM users WHERE id = ?').get('u1').email, 'backup@example.test')
  restored.sqlite.close()
  fs.rmSync(directory, { recursive: true, force: true })
})

test('rejects stale and tampered backup manifests', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moneywise-backup-test-'))
  const databasePath = path.join(directory, 'sync.sqlite')
  const db = createDatabase(databasePath)
  runMigrations(db)
  db.sqlite.close()
  const created = await createBackup(databasePath, path.join(directory, 'backups'), new Date('2026-08-01T00:00:00.000Z'))
  assert.throws(() => verifyBackup(created.backupPath, 24, new Date('2026-08-10T00:00:00.000Z')), /maximum allowed age/)
  const manifestPath = `${created.backupPath}.json`
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  manifest.sha256 = '0'.repeat(64)
  fs.writeFileSync(manifestPath, JSON.stringify(manifest))
  assert.throws(() => verifyBackup(created.backupPath, Number.MAX_SAFE_INTEGER), /checksum/)
  fs.rmSync(directory, { recursive: true, force: true })
})

test('scheduler creates one fresh startup backup and can be stopped', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moneywise-backup-scheduler-'))
  const databasePath = path.join(directory, 'sync.sqlite')
  const backupDirectory = path.join(directory, 'backups')
  const db = createDatabase(databasePath)
  runMigrations(db)
  db.sqlite.close()
  const events = []
  const scheduler = startBackupScheduler({
    databasePath,
    backupDirectory,
    intervalHours: 24,
    logger: { info: (event) => events.push(event), error: (event) => events.push(event) }
  })
  await waitFor(() => Boolean(findLatestBackup(backupDirectory)))
  scheduler.stop()
  assert.deepEqual(events, ['backup_created', 'backup_status'])
  verifyBackup(findLatestBackup(backupDirectory), 24)
  fs.rmSync(directory, { recursive: true, force: true })
})

test('retention keeps the newest valid and locked backup while deleting manifest pairs safely', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moneywise-retention-test-'))
  const databasePath = path.join(directory, 'sync.sqlite')
  const backupDirectory = path.join(directory, 'backups')
  const db = createDatabase(databasePath); runMigrations(db); db.sqlite.close()
  const dates = ['2026-05-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', '2026-08-10T00:00:00.000Z']
  const created = []
  for (const date of dates) created.push(await createBackup(databasePath, backupDirectory, new Date(date)))
  fs.writeFileSync(`${created[1].backupPath}.lock`, 'restore-in-progress')
  const result = applyRetention(backupDirectory, { hourlyHours: 1, dailyDays: 1, weeklyWeeks: 1 }, new Date('2026-08-10T01:00:00.000Z'))
  assert.ok(fs.existsSync(created.at(-1).backupPath))
  assert.ok(fs.existsSync(created[1].backupPath))
  for (const name of result.deleted) {
    assert.equal(fs.existsSync(path.join(backupDirectory, name)), false)
    assert.equal(fs.existsSync(path.join(backupDirectory, `${name}.json`)), false)
  }
  const status = getBackupStatus(backupDirectory, new Date('2026-08-10T01:00:00.000Z'))
  assert.ok(status.backupCount >= 2); assert.ok(status.newestValidBackup); assert.ok(status.availableBytes > 0)
  await assert.rejects(() => createBackup(databasePath, backupDirectory, new Date(), { minimumFreeBytes: Number.MAX_SAFE_INTEGER }), /Backup aborted/)
  fs.rmSync(directory, { recursive: true, force: true })
})

test('restore quarantines stale WAL/SHM and rolls back after failed post-activation validation', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moneywise-restore-test-'))
  const target = path.join(directory, 'live.sqlite')
  const sourceDb = path.join(directory, 'source.sqlite')
  for (const [file, email] of [[target, 'old@example.test'], [sourceDb, 'new@example.test']]) {
    const db = createDatabase(file); runMigrations(db)
    db.sqlite.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)').run(email, email, 'hash', 'active', '2026-01-01', '2026-01-01')
    db.sqlite.close()
  }
  const backup = await createBackup(sourceDb, path.join(directory, 'backups'))
  const missingManifest = path.join(directory, 'backups', 'moneywise-missing-manifest.sqlite')
  fs.copyFileSync(backup.backupPath, missingManifest)
  assert.throws(() => safeRestore({ source: missingManifest, target }), /manifest is missing/)
  let opened = new BetterSqlite3(target, { readonly: true }); assert.equal(opened.prepare('SELECT email FROM users').get().email, 'old@example.test'); opened.close()
  fs.writeFileSync(`${target}-wal`, 'stale-wal'); fs.writeFileSync(`${target}-shm`, 'stale-shm')
  const restored = safeRestore({ source: backup.backupPath, target })
  assert.equal(fs.readFileSync(path.join(restored.sidecarDirectory, 'live.sqlite.old-wal'), 'utf8'), 'stale-wal')
  assert.equal(fs.readFileSync(path.join(restored.sidecarDirectory, 'live.sqlite.old-shm'), 'utf8'), 'stale-shm')
  opened = new BetterSqlite3(target, { readonly: true }); assert.equal(opened.prepare('SELECT email FROM users').get().email, 'new@example.test'); opened.close()

  await new Promise((resolve) => setTimeout(resolve, 2))
  const rollbackSource = await createBackup(sourceDb, path.join(directory, 'backups'), new Date())
  assert.throws(() => safeRestore({ source: rollbackSource.backupPath, target, injectFailure: (step) => { if (step === 'activated') throw new Error('injected reopen failure') } }), /injected reopen failure/)
  opened = new BetterSqlite3(target, { readonly: true }); assert.equal(opened.prepare('SELECT email FROM users').get().email, 'new@example.test'); opened.close()
  assert.ok(fs.existsSync(restored.rollback))
  fs.rmSync(directory, { recursive: true, force: true })
})
