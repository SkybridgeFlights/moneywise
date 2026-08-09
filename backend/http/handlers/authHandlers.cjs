const { passwordAuthSchema, userSessionSchema, refreshSessionSchema } = require('../../domain/schemas.cjs')

function createAuthHandlers({ authService, sendJson, loginLimiter }) {
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
      if (error.code === 'dev_sessions_disabled') {
        sendJson(response, 403, { error: error.message })
        return true
      }
    }
    return false
  }

  return {
    async createDevSession(request, response, body) {
      try {
        if (!authService.isDevSessionEnabled()) {
          sendJson(response, 403, { error: 'Development sessions are disabled.' })
          return
        }
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
        const session = await authService.registerWithPassword(parsed)
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
        const key = `${request.socket.remoteAddress ?? 'unknown'}:${parsed.email.toLowerCase()}`
        const attempt = loginLimiter.consume(key)
        if (!attempt.allowed) {
          sendJson(response, 429, { error: 'Too many authentication attempts. Try again later.' })
          return
        }
        const session = await authService.loginWithPassword(parsed)
        loginLimiter.clear(key)
        sendJson(response, 200, session)
      } catch (error) {
        if (mapAuthError(error, response)) {
          return
        }
        throw error
      }
    },
    async refresh(request, response, body) {
      try {
        const parsed = refreshSessionSchema.parse(body)
        sendJson(response, 200, authService.refreshSession(parsed))
      } catch (error) {
        if (mapAuthError(error, response)) return
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
