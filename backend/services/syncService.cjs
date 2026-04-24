function createSyncId(userId, entityType, recordId) {
  return `${userId}:${entityType}:${recordId}`
}

const BOOTSTRAP_ORDER = ['settings', 'category', 'budget', 'goal', 'debt', 'income', 'expense', 'monthly-summary']

function createConflict(current) {
  return {
    code: 'version_conflict',
    message: 'The remote record changed since the client last read it.',
    current
  }
}

function createSyncService({ recordRepository }) {
  return {
    bootstrap(userId) {
      const recordsByEntity = recordRepository.bootstrap(userId)
      const latestCursor = recordRepository
        .listByUser(userId)
        .reduce((latest, record) => (record.updatedAt > latest ? record.updatedAt : latest), '1970-01-01T00:00:00.000Z')
      return {
        cursor: latestCursor,
        records: recordsByEntity
      }
    },
    bootstrapOrder: BOOTSTRAP_ORDER,
    getChanges(userId, since) {
      const changes = recordRepository.listChangesSince(userId, since)
      const latestCursor = changes.reduce((latest, record) => (record.updatedAt > latest ? record.updatedAt : latest), since)
      return {
        cursor: latestCursor,
        changes: changes.map((record) => ({
          entityType: record.entityType,
          recordId: record.recordId,
          payload: record.payload,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          deletedAt: record.deletedAt,
          version: record.version,
          lastModifiedByDeviceId: record.lastModifiedByDeviceId
        }))
      }
    },
    upsertRecord(userId, change, options = {}) {
      const current = recordRepository.findByUserAndRecord(userId, change.entityType, change.recordId)
      if (typeof change.baseVersion === 'number' && current && current.version !== change.baseVersion) {
        return {
          ok: false,
          conflict: createConflict(current)
        }
      }

      const createdAt = current?.createdAt ?? change.updatedAt ?? new Date().toISOString()
      const updatedAt = change.updatedAt ?? new Date().toISOString()
      const nextRecord = recordRepository.upsert({
        syncId: createSyncId(userId, change.entityType, change.recordId),
        userId,
        entityType: change.entityType,
        recordId: change.recordId,
        payload: change.payload ?? {},
        createdAt,
        updatedAt,
        deletedAt: change.deletedAt ?? null,
        version: (current?.version ?? 0) + 1,
        lastModifiedByDeviceId: change.lastModifiedByDeviceId ?? options.deviceId ?? null
      })

      return {
        ok: true,
        record: nextRecord
      }
    },
    softDeleteRecord(userId, entityType, recordId, options = {}) {
      return this.upsertRecord(
        userId,
        {
          entityType,
          recordId,
          payload: {},
          deletedAt: options.deletedAt ?? new Date().toISOString(),
          baseVersion: options.baseVersion
        },
        options
      )
    },
    pushBatch(userId, payload) {
      const applied = []
      const conflicts = []
      payload.changes.forEach((change) => {
        const result = this.upsertRecord(userId, change, { deviceId: payload.deviceId })
        if (result.ok) {
          applied.push({
            entityType: result.record.entityType,
            recordId: result.record.recordId,
            version: result.record.version,
            updatedAt: result.record.updatedAt,
            deletedAt: result.record.deletedAt
          })
        } else {
          conflicts.push({
            entityType: change.entityType,
            recordId: change.recordId,
            conflict: result.conflict
          })
        }
      })
      return { applied, conflicts }
    }
  }
}

module.exports = {
  createSyncService
}
