const { z } = require('zod')
const { FINANCE_ENTITY_TYPES } = require('../config/constants.cjs')

const entityTypeSchema = z.enum(FINANCE_ENTITY_TYPES)

const sessionBaseSchema = z.object({
  email: z.string().email(),
  deviceId: z.string().min(1).max(120),
  label: z.string().min(1).max(120).optional()
})

const userSessionSchema = sessionBaseSchema

const passwordAuthSchema = sessionBaseSchema.extend({
  password: z.string().min(8).max(200)
})

const syncRecordSchema = z.object({
  entityType: entityTypeSchema,
  recordId: z.string().min(1).max(120),
  payload: z.record(z.any()).default({}),
  updatedAt: z.string().datetime().optional(),
  deletedAt: z.string().datetime().nullable().optional(),
  lastModifiedByDeviceId: z.string().min(1).max(120).optional(),
  baseVersion: z.number().int().min(0).optional()
})

const syncPushSchema = z.object({
  deviceId: z.string().min(1).max(120),
  changes: z.array(syncRecordSchema).max(500)
})

module.exports = {
  userSessionSchema,
  passwordAuthSchema,
  syncRecordSchema,
  syncPushSchema,
  entityTypeSchema
}
