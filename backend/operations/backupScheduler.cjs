const { applyRetention, createBackup, findLatestBackup, getBackupStatus, verifyBackup } = require('./backups.cjs')

function startBackupScheduler({ databasePath, backupDirectory, intervalHours, minimumFreeBytes = 0, retentionPolicy = { hourlyHours: 24, dailyDays: 30, weeklyWeeks: 12 }, logger }) {
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
          const retention = applyRetention(backupDirectory, retentionPolicy)
          logger.info('backup_status', { ...getBackupStatus(backupDirectory), deleted: retention.deleted })
          return
        } catch {
          // A stale or invalid latest backup is replaced; the invalid file is retained for incident analysis.
        }
      }
      const preflightRetention = applyRetention(backupDirectory, retentionPolicy)
      if (preflightRetention.deleted.length > 0) logger.info('backup_retention_applied', { deleted: preflightRetention.deleted })
      const result = await createBackup(databasePath, backupDirectory, new Date(), { minimumFreeBytes })
      logger.info('backup_created', { backup: result.manifest.backup, bytes: result.manifest.bytes })
      const retention = applyRetention(backupDirectory, retentionPolicy)
      logger.info('backup_status', { ...getBackupStatus(backupDirectory), deleted: retention.deleted })
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
