const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createDatabase } = require('../data/sqlite.cjs')
const { runMigrations } = require('../data/migrations.cjs')
const { createBackup, findLatestBackup, verifyBackup } = require('../operations/backups.cjs')
const { startBackupScheduler } = require('../operations/backupScheduler.cjs')

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
  assert.deepEqual(events, ['backup_created'])
  verifyBackup(findLatestBackup(backupDirectory), 24)
  fs.rmSync(directory, { recursive: true, force: true })
})
