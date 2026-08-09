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
    revision: row.revision,
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
      sync_id, user_id, entity_type, record_id, payload_json, created_at, updated_at, deleted_at, version, last_modified_by_device_id, revision
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(sync_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at,
      version = excluded.version,
      last_modified_by_device_id = excluded.last_modified_by_device_id
      ,revision = excluded.revision
  `)
  const listByUserStatement = sqlite.prepare(`
    SELECT * FROM finance_records
    WHERE user_id = ?
    ORDER BY updated_at DESC, entity_type ASC, record_id ASC
  `)
  const listChangesSinceStatement = sqlite.prepare(`
    SELECT * FROM finance_records
    WHERE user_id = ? AND revision > ?
    ORDER BY revision ASC
    LIMIT ?
  `)
  const nextRevisionStatement = sqlite.prepare('INSERT INTO sync_revisions DEFAULT VALUES')
  const findRequestStatement = sqlite.prepare('SELECT response_json FROM sync_requests WHERE user_id = ? AND request_id = ?')
  const saveRequestStatement = sqlite.prepare('INSERT INTO sync_requests (user_id, request_id, response_json, created_at) VALUES (?, ?, ?, ?)')

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
        , record.revision
      )
      return this.findByUserAndRecord(record.userId, record.entityType, record.recordId)
    },
    listByUser(userId) {
      return listByUserStatement.all(userId).map((row) => mapRecord(row))
    },
    listChangesSince(userId, since, limit = 200) {
      return listChangesSinceStatement.all(userId, since, limit).map((row) => mapRecord(row))
    },
    bootstrap(userId) {
      return groupBootstrap(this.listByUser(userId))
    },
    nextRevision() {
      return Number(nextRevisionStatement.run().lastInsertRowid)
    },
    transaction(callback) {
      sqlite.exec('BEGIN IMMEDIATE')
      try {
        const result = callback()
        sqlite.exec('COMMIT')
        return result
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
    findRequest(userId, requestId) {
      const row = findRequestStatement.get(userId, requestId)
      return row ? JSON.parse(row.response_json) : null
    },
    saveRequest(userId, requestId, response) {
      saveRequestStatement.run(userId, requestId, JSON.stringify(response), new Date().toISOString())
    }
  }
}

module.exports = {
  createRecordRepository
}
