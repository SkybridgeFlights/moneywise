const { createBackup, findLatestBackup, verifyBackup } = require('./backups.cjs')

function startBackupScheduler({ databasePath, backupDirectory, intervalHours, logger }) {
  if (!Number.isFinite(intervalHours) || intervalHours <= 0) return { stop() {} }
  let running = false
  let stopped = false
  const intervalMs = intervalHours * 3_600_000

  async function ensureFreshBackup() {
    if (running || stopped) return
    running = true
    try {
      const latest = findLatestBackup(backupDirectory)
      if (latest) {
        try {
          verifyBackup(latest, intervalHours)
          return
        } catch {
          // A stale or invalid latest backup is replaced; the invalid file is retained for incident analysis.
        }
      }
      const result = await createBackup(databasePath, backupDirectory)
      logger.info('backup_created', { backup: result.manifest.backup, bytes: result.manifest.bytes })
    } catch (error) {
      logger.error('backup_failed', { error: error instanceof Error ? error.message : String(error) })
    } finally {
      running = false
    }
  }

  const timer = setInterval(() => void ensureFreshBackup(), intervalMs)
  timer.unref()
  void ensureFreshBackup()
  return { stop() { stopped = true; clearInterval(timer) } }
}

module.exports = { startBackupScheduler }
