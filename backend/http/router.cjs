const { ZodError } = require('zod')
const { sendJson } = require('./sendJson.cjs')
const { readJsonBody } = require('./requestBody.cjs')

function matchRecordRoute(pathname) {
  const match = pathname.match(/^\/api\/sync\/records\/([^/]+)\/([^/]+)$/)
  if (!match) {
    return null
  }
  return {
    entityType: decodeURIComponent(match[1]),
    recordId: decodeURIComponent(match[2])
  }
}

function createRouter({ authHandlers, syncHandlers, backendInfo }) {
  return async function route(request, response) {
    const url = new URL(request.url, 'http://localhost')

    if (request.method === 'OPTIONS') {
      sendJson(response, 204, {})
      return
    }

    try {
      if (url.pathname === '/health' && request.method === 'GET') {
        sendJson(response, 200, {
          ok: true,
          service: 'moneywise-sync-backend',
          authMode: backendInfo?.authMode ?? 'unknown',
          database: backendInfo?.database ?? 'unknown'
        })
        return
      }

      if (url.pathname === '/api/auth/dev-session' && request.method === 'POST') {
        const body = await readJsonBody(request)
        await authHandlers.createDevSession(request, response, body)
        return
      }

      if (url.pathname === '/api/auth/register' && request.method === 'POST') {
        const body = await readJsonBody(request)
        await authHandlers.register(request, response, body)
        return
      }

      if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        const body = await readJsonBody(request)
        await authHandlers.login(request, response, body)
        return
      }

      if (url.pathname === '/api/auth/refresh' && request.method === 'POST') {
        const body = await readJsonBody(request)
        await authHandlers.refresh(request, response, body)
        return
      }

      if (url.pathname === '/api/auth/session' && request.method === 'GET') {
        await authHandlers.session(request, response)
        return
      }

      if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        await authHandlers.logout(request, response)
        return
      }

      if (url.pathname === '/api/sync/bootstrap' && request.method === 'GET') {
        await syncHandlers.bootstrap(request, response)
        return
      }

      if (url.pathname === '/api/sync/changes' && request.method === 'GET') {
        await syncHandlers.changes(request, response, url)
        return
      }

      if (url.pathname === '/api/sync/push' && request.method === 'POST') {
        const body = await readJsonBody(request)
        await syncHandlers.push(request, response, body)
        return
      }

      const recordRoute = matchRecordRoute(url.pathname)
      if (recordRoute && request.method === 'PUT') {
        const body = await readJsonBody(request)
        await syncHandlers.putRecord(request, response, body, recordRoute)
        return
      }
      if (recordRoute && request.method === 'DELETE') {
        await syncHandlers.deleteRecord(request, response, recordRoute, url)
        return
      }

      sendJson(response, 404, { error: 'Route not found.' })
    } catch (error) {
      if (error instanceof ZodError) {
        sendJson(response, 400, {
          error: 'Validation failed.',
          issues: error.issues
        })
        return
      }
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : 'Unexpected backend error.'
      })
    }
  }
}

module.exports = {
  createRouter
}
