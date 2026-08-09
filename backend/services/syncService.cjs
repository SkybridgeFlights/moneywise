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
        .reduce((latest, record) => Math.max(latest, record.revision), 0)
      return {
        cursor: String(latestCursor),
        records: recordsByEntity
      }
    },
    bootstrapOrder: BOOTSTRAP_ORDER,
    getChanges(userId, since, limit = 200) {
      const parsedSince = /^\d+$/.test(String(since)) ? Number(since) : 0
      const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 500))
      const records = recordRepository.listChangesSince(userId, parsedSince, safeLimit + 1)
      const hasMore = records.length > safeLimit
      const changes = hasMore ? records.slice(0, safeLimit) : records
      const latestCursor = changes.reduce((latest, record) => Math.max(latest, record.revision), parsedSince)
      return {
        cursor: String(latestCursor),
        hasMore,
        changes: changes.map((record) => ({
          entityType: record.entityType,
          recordId: record.recordId,
          payload: record.payload,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          deletedAt: record.deletedAt,
          version: record.version,
          revision: record.revision,
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

      const updatedAt = new Date().toISOString()
      const createdAt = current?.createdAt ?? updatedAt
      const revision = recordRepository.nextRevision()
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
        revision,
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
      const replay = recordRepository.findRequest(userId, payload.requestId)
      if (replay) return replay
      return recordRepository.transaction(() => {
        const conflicts = payload.changes.flatMap((change) => {
          const current = recordRepository.findByUserAndRecord(userId, change.entityType, change.recordId)
          return typeof change.baseVersion === 'number' && current && current.version !== change.baseVersion
            ? [{ entityType: change.entityType, recordId: change.recordId, conflict: createConflict(current) }]
            : []
        })
        if (conflicts.length > 0) {
          const response = { applied: [], conflicts, atomic: true, replayed: false }
          recordRepository.saveRequest(userId, payload.requestId, response)
          return response
        }
        const applied = payload.changes.map((change) => {
          const result = this.upsertRecord(userId, change, { deviceId: payload.deviceId })
          return {
            entityType: result.record.entityType,
            recordId: result.record.recordId,
            version: result.record.version,
            updatedAt: result.record.updatedAt,
            deletedAt: result.record.deletedAt
          }
        })
        const response = { applied, conflicts: [], atomic: true, replayed: false }
        recordRepository.saveRequest(userId, payload.requestId, response)
        return response
      })
    }
  }
}

module.exports = {
  createSyncService
}
