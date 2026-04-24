const crypto = require('node:crypto')

function createId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
}

function sha256(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex')
}

function addDays(days) {
  const next = new Date()
  next.setDate(next.getDate() + days)
  return next.toISOString()
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex')
  return `scrypt:${salt}:${derivedKey}`
}

function verifyPassword(password, passwordHash) {
  if (!passwordHash) {
    return false
  }
  const [algorithm, salt, expected] = String(passwordHash).split(':')
  if (algorithm !== 'scrypt' || !salt || !expected) {
    return false
  }
  const actual = crypto.scryptSync(password, salt, 64).toString('hex')
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))
}

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  }
}

function createAuthService({ config, userRepository, sessionRepository }) {
  function ensureDevSessionsAllowed() {
    if (config.authMode === 'password-only') {
      throw new Error('Dev sessions are disabled for this backend.')
    }
  }

  function issueSession(user, input, authMode) {
    const now = new Date().toISOString()
      const token = crypto.randomBytes(24).toString('hex')
      const session = sessionRepository.create({
        id: createId('session'),
        userId: user.id,
        tokenHash: sha256(token, config.authSecret),
      label: input.label ?? `${input.deviceId} ${authMode} session`,
      authMode,
      createdAt: now,
      expiresAt: addDays(config.sessionTtlDays),
      lastSeenAt: now,
      revokedAt: null
    })

    return {
      authMode,
      token,
      user: sanitizeUser(user),
      session: {
        id: session.id,
        expiresAt: session.expiresAt,
        label: session.label,
        authMode: session.authMode
      }
    }
  }

  function createPasswordSession(user, input) {
    return issueSession(user, input, 'password')
  }

  return {
    createDevSession(input) {
      ensureDevSessionsAllowed()
      const now = new Date().toISOString()
      const email = input.email.toLowerCase()
      let user = userRepository.findByEmail(email)
      if (!user) {
        user = userRepository.create({
          id: createId('user'),
          email,
          passwordHash: null,
          status: 'active',
          createdAt: now,
          updatedAt: now
        })
      }
      return issueSession(user, input, 'dev-session')
    },
    registerWithPassword(input) {
      const now = new Date().toISOString()
      const email = input.email.toLowerCase()
      const existing = userRepository.findByEmail(email)
      if (existing?.passwordHash) {
        const error = new Error('An account with this email already exists.')
        error.code = 'account_exists'
        throw error
      }

      const passwordHash = hashPassword(input.password)
      const user = existing
        ? userRepository.updatePassword(existing.id, passwordHash, now)
        : userRepository.create({
            id: createId('user'),
            email,
            passwordHash,
            status: 'active',
            createdAt: now,
            updatedAt: now
          })

      return createPasswordSession(user, input)
    },
    loginWithPassword(input) {
      const email = input.email.toLowerCase()
      const user = userRepository.findByEmail(email)
      if (!user || !user.passwordHash || !verifyPassword(input.password, user.passwordHash)) {
        const error = new Error('Invalid email or password.')
        error.code = 'invalid_credentials'
        throw error
      }
      return createPasswordSession(user, input)
    },
    authenticateFromHeader(authorizationHeader) {
      if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
        return null
      }
      const token = authorizationHeader.slice('Bearer '.length)
      const tokenHash = sha256(token, config.authSecret)
      const session = sessionRepository.findByTokenHash(tokenHash)
      if (!session || session.revokedAt) {
        return null
      }
      if (new Date(session.expiresAt).getTime() <= Date.now()) {
        return null
      }
      sessionRepository.touch(session.id, new Date().toISOString())
      const user = userRepository.findById(session.userId)
      if (!user) {
        return null
      }
      return { user: sanitizeUser(user), session }
    },
    logout(sessionId) {
      sessionRepository.revoke(sessionId, new Date().toISOString())
    }
  }
}

module.exports = {
  createAuthService
}
