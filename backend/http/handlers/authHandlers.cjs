const { passwordAuthSchema, userSessionSchema } = require('../../domain/schemas.cjs')

function createAuthHandlers({ authService, sendJson }) {
  function mapAuthError(error, response) {
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'account_exists') {
        sendJson(response, 409, { error: error.message })
        return true
      }
      if (error.code === 'invalid_credentials') {
        sendJson(response, 401, { error: error.message })
        return true
      }
    }
    return false
  }

  return {
    async createDevSession(request, response, body) {
      try {
        const parsed = userSessionSchema.parse(body)
        const session = authService.createDevSession(parsed)
        sendJson(response, 201, session)
      } catch (error) {
        if (mapAuthError(error, response)) {
          return
        }
        throw error
      }
    },
    async register(request, response, body) {
      try {
        const parsed = passwordAuthSchema.parse(body)
        const session = authService.registerWithPassword(parsed)
        sendJson(response, 201, session)
      } catch (error) {
        if (mapAuthError(error, response)) {
          return
        }
        throw error
      }
    },
    async login(request, response, body) {
      try {
        const parsed = passwordAuthSchema.parse(body)
        const session = authService.loginWithPassword(parsed)
        sendJson(response, 200, session)
      } catch (error) {
        if (mapAuthError(error, response)) {
          return
        }
        throw error
      }
    },
    async session(request, response) {
      const principal = authService.authenticateFromHeader(request.headers.authorization)
      if (!principal) {
        sendJson(response, 401, { error: 'Authentication is required.' })
        return
      }
      sendJson(response, 200, {
        authMode: principal.session.authMode,
        user: principal.user,
        session: {
          id: principal.session.id,
          expiresAt: principal.session.expiresAt,
          label: principal.session.label,
          authMode: principal.session.authMode
        }
      })
    },
    async logout(request, response) {
      const principal = authService.authenticateFromHeader(request.headers.authorization)
      if (!principal) {
        sendJson(response, 401, { error: 'Authentication is required.' })
        return
      }
      authService.logout(principal.session.id)
      sendJson(response, 200, { ok: true })
    }
  }
}

module.exports = {
  createAuthHandlers
}
