const { entityTypeSchema, syncPushSchema, syncRecordSchema } = require('../../domain/schemas.cjs')

function createSyncHandlers({ authService, syncService, sendJson }) {
  async function requireAuth(request, response) {
    const principal = await authService.authenticateFromHeader(request.headers.authorization)
    if (!principal) {
      sendJson(response, 401, { error: 'Authentication is required.' })
      return null
    }
    return principal
  }

  return {
    async bootstrap(request, response) {
      const principal = await requireAuth(request, response)
      if (!principal) return
      sendJson(response, 200, {
        order: syncService.bootstrapOrder,
        ...await syncService.bootstrap(principal.user.id)
      })
    },
    async changes(request, response, url) {
      const principal = await requireAuth(request, response)
      if (!principal) return
      const since = url.searchParams.get('since') ?? '1970-01-01T00:00:00.000Z'
      const limit = url.searchParams.get('limit') ?? '200'
      sendJson(response, 200, await syncService.getChanges(principal.user.id, since, limit))
    },
    async push(request, response, body) {
      const principal = await requireAuth(request, response)
      if (!principal) return
      const parsed = syncPushSchema.parse(body)
      sendJson(response, 200, await syncService.pushBatch(principal.user.id, parsed))
    },
    async putRecord(request, response, body, params) {
      const principal = await requireAuth(request, response)
      if (!principal) return
      const parsed = syncRecordSchema.parse({
        ...body,
        entityType: params.entityType,
        recordId: params.recordId
      })
      const result = await syncService.upsertRecord(principal.user.id, parsed)
      if (!result.ok) {
        sendJson(response, 409, result.conflict)
        return
      }
      sendJson(response, 200, result.record)
    },
    async deleteRecord(request, response, params, url) {
      const principal = await requireAuth(request, response)
      if (!principal) return
      const entityType = entityTypeSchema.parse(params.entityType)
      const baseVersion = url.searchParams.get('baseVersion')
      const result = await syncService.softDeleteRecord(principal.user.id, entityType, params.recordId, {
        baseVersion: baseVersion ? Number(baseVersion) : undefined
      })
      if (!result.ok) {
        sendJson(response, 409, result.conflict)
        return
      }
      sendJson(response, 200, result.record)
    }
  }
}

module.exports = {
  createSyncHandlers
}
