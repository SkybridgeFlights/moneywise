function parsePayload(payloadJson) {
  try {
    return payloadJson ? JSON.parse(payloadJson) : {}
  } catch {
    return {}
  }
}

function mapRecord(row) {
  if (!row) {
    return null
  }
  return {
    syncId: row.sync_id,
    userId: row.user_id,
    entityType: row.entity_type,
    recordId: row.record_id,
    payload: parsePayload(row.payload_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    version: row.version,
    lastModifiedByDeviceId: row.last_modified_by_device_id
  }
}

function groupBootstrap(records) {
  return records.reduce((accumulator, record) => {
    accumulator[record.entityType] ??= []
    accumulator[record.entityType].push({
      id: record.recordId,
      payload: record.payload,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      deletedAt: record.deletedAt,
      version: record.version,
      lastModifiedByDeviceId: record.lastModifiedByDeviceId
    })
    return accumulator
  }, {})
}

function createRecordRepository(db) {
  const sqlite = db.sqlite
  const findStatement = sqlite.prepare(`
    SELECT * FROM finance_records
    WHERE user_id = ? AND entity_type = ? AND record_id = ?
    LIMIT 1
  `)
  const upsertStatement = sqlite.prepare(`
    INSERT INTO finance_records (
      sync_id, user_id, entity_type, record_id, payload_json, created_at, updated_at, deleted_at, version, last_modified_by_device_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(sync_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at,
      version = excluded.version,
      last_modified_by_device_id = excluded.last_modified_by_device_id
  `)
  const listByUserStatement = sqlite.prepare(`
    SELECT * FROM finance_records
    WHERE user_id = ?
    ORDER BY updated_at DESC, entity_type ASC, record_id ASC
  `)
  const listChangesSinceStatement = sqlite.prepare(`
    SELECT * FROM finance_records
    WHERE user_id = ? AND updated_at > ?
    ORDER BY updated_at ASC, entity_type ASC, record_id ASC
  `)

  return {
    findByUserAndRecord(userId, entityType, recordId) {
      return mapRecord(findStatement.get(userId, entityType, recordId))
    },
    upsert(record) {
      upsertStatement.run(
        record.syncId,
        record.userId,
        record.entityType,
        record.recordId,
        JSON.stringify(record.payload ?? {}),
        record.createdAt,
        record.updatedAt,
        record.deletedAt ?? null,
        record.version,
        record.lastModifiedByDeviceId ?? null
      )
      return this.findByUserAndRecord(record.userId, record.entityType, record.recordId)
    },
    listByUser(userId) {
      return listByUserStatement.all(userId).map((row) => mapRecord(row))
    },
    listChangesSince(userId, since) {
      return listChangesSinceStatement.all(userId, since).map((row) => mapRecord(row))
    },
    bootstrap(userId) {
      return groupBootstrap(this.listByUser(userId))
    }
  }
}

module.exports = {
  createRecordRepository
}
