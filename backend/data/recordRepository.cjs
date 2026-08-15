function parsePayload(payloadJson) {
  try { return payloadJson ? JSON.parse(payloadJson) : {} } catch { return {} }
}

function mapRecord(row) {
  if (!row) return null
  return { syncId: row.sync_id, userId: row.user_id, entityType: row.entity_type, recordId: row.record_id, payload: row.deleted_at ? {} : normalizeStoredMoneyPayload(row.entity_type, parsePayload(row.payload_json)), createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at, version: Number(row.version), revision: Number(row.revision), lastModifiedByDeviceId: row.last_modified_by_device_id }
}

function groupBootstrap(records) {
  return records.reduce((accumulator, record) => {
    accumulator[record.entityType] ??= []
    accumulator[record.entityType].push({ id: record.recordId, payload: record.payload, createdAt: record.createdAt, updatedAt: record.updatedAt, deletedAt: record.deletedAt, version: record.version, lastModifiedByDeviceId: record.lastModifiedByDeviceId })
    return accumulator
  }, {})
}

function createRecordRepository(database) {
  const repository = {
    async findByUserAndRecord(userId, entityType, recordId) {
      return mapRecord(await database.get('SELECT * FROM finance_records WHERE user_id = ? AND entity_type = ? AND record_id = ? LIMIT 1', [userId, entityType, recordId]))
    },
    async upsert(record) {
      await database.run(`INSERT INTO finance_records (sync_id, user_id, entity_type, record_id, payload_json, created_at, updated_at, deleted_at, version, last_modified_by_device_id, revision)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(sync_id) DO UPDATE SET payload_json = excluded.payload_json, created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, version = excluded.version, last_modified_by_device_id = excluded.last_modified_by_device_id, revision = excluded.revision`,
      [record.syncId, record.userId, record.entityType, record.recordId, JSON.stringify(record.payload ?? {}), record.createdAt, record.updatedAt, record.deletedAt ?? null, record.version, record.lastModifiedByDeviceId ?? null, record.revision])
      return this.findByUserAndRecord(record.userId, record.entityType, record.recordId)
    },
    async listByUser(userId) {
      return (await database.all('SELECT * FROM finance_records WHERE user_id = ? ORDER BY updated_at DESC, entity_type ASC, record_id ASC', [userId])).map(mapRecord)
    },
    async listChangesSince(userId, since, limit = 200) {
      return (await database.all('SELECT * FROM finance_records WHERE user_id = ? AND revision > ? ORDER BY revision ASC LIMIT ?', [userId, since, limit])).map(mapRecord)
    },
    async bootstrap(userId) { return groupBootstrap(await this.listByUser(userId)) },
    async bootstrapSnapshot(userId) {
      const records = await this.listByUser(userId)
      return { records: groupBootstrap(records), cursor: records.reduce((latest, record) => Math.max(latest, record.revision), 0) }
    },
    async nextRevision() {
      const result = await database.run('INSERT INTO sync_revisions DEFAULT VALUES')
      return Number(result.lastInsertRowid)
    },
    async transaction(callback) {
      return database.transaction((transactionDatabase) => callback(createRecordRepository(transactionDatabase)))
    },
    async findRequest(userId, requestId) {
      const row = await database.get('SELECT response_json FROM sync_requests WHERE user_id = ? AND request_id = ?', [userId, requestId])
      return row ? JSON.parse(row.response_json) : null
    },
    async saveRequest(userId, requestId, response) {
      await database.run('INSERT INTO sync_requests (user_id, request_id, response_json, created_at) VALUES (?, ?, ?, ?)', [userId, requestId, JSON.stringify(response), new Date().toISOString()])
    }
  }
  return repository
}

module.exports = { createRecordRepository }
const { normalizeStoredMoneyPayload } = require('../domain/moneyPayload.cjs')
