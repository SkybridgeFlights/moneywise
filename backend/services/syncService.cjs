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
  async function applyUpsert(repository, userId, change, options = {}) {
    const current = await repository.findByUserAndRecord(userId, change.entityType, change.recordId)
    if (typeof change.baseVersion === 'number' && current && current.version !== change.baseVersion) return { ok: false, conflict: createConflict(current) }
    const updatedAt = new Date().toISOString()
    const revision = await repository.nextRevision()
    const nextRecord = await repository.upsert({
      syncId: createSyncId(userId, change.entityType, change.recordId), userId, entityType: change.entityType, recordId: change.recordId,
      payload: change.payload ?? {}, createdAt: current?.createdAt ?? updatedAt, updatedAt, deletedAt: change.deletedAt ?? null,
      version: (current?.version ?? 0) + 1, revision, lastModifiedByDeviceId: change.lastModifiedByDeviceId ?? options.deviceId ?? null
    })
    return { ok: true, record: nextRecord }
  }

  return {
    async bootstrap(userId) {
      const snapshot = await recordRepository.bootstrapSnapshot(userId)
      return { cursor: String(snapshot.cursor), records: snapshot.records }
    },
    bootstrapOrder: BOOTSTRAP_ORDER,
    async getChanges(userId, since, limit = 200) {
      const parsedSince = /^\d+$/.test(String(since)) ? Number(since) : 0
      const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 500))
      const records = await recordRepository.listChangesSince(userId, parsedSince, safeLimit + 1)
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
    async upsertRecord(userId, change, options = {}) {
      return recordRepository.transaction((transactionRepository) => applyUpsert(transactionRepository, userId, change, options))
    },
    async softDeleteRecord(userId, entityType, recordId, options = {}) {
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
    async pushBatch(userId, payload, options = {}) {
      const replay = await recordRepository.findRequest(userId, payload.requestId)
      if (replay) return replay
      return recordRepository.transaction(async (transactionRepository) => {
        const transactionReplay = await transactionRepository.findRequest(userId, payload.requestId)
        if (transactionReplay) return transactionReplay
        options.injectFailure?.('after-idempotency-lookup')
        const conflicts = []
        for (const change of payload.changes) {
          const current = await transactionRepository.findByUserAndRecord(userId, change.entityType, change.recordId)
          if (typeof change.baseVersion === 'number' && current && current.version !== change.baseVersion) conflicts.push({ entityType: change.entityType, recordId: change.recordId, conflict: createConflict(current) })
        }
        options.injectFailure?.('after-conflict-validation')
        if (conflicts.length > 0) {
          const response = { applied: [], conflicts, atomic: true, replayed: false }
          await transactionRepository.saveRequest(userId, payload.requestId, response)
          return response
        }
        const applied = []
        for (const change of payload.changes) {
          const result = await applyUpsert(transactionRepository, userId, change, { deviceId: payload.deviceId })
          applied.push({
            entityType: result.record.entityType,
            recordId: result.record.recordId,
            version: result.record.version,
            updatedAt: result.record.updatedAt,
            deletedAt: result.record.deletedAt
          })
          options.injectFailure?.('after-record-write', applied.length)
        }
        const response = { applied, conflicts: [], atomic: true, replayed: false }
        await transactionRepository.saveRequest(userId, payload.requestId, response)
        options.injectFailure?.('after-idempotency-save')
        return response
      })
    }
  }
}

module.exports = {
  createSyncService
}
