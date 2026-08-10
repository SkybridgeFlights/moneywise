const net = require('node:net')

function normalizeAddress(value) {
  return String(value ?? '').replace(/^::ffff:/, '')
}

function matchesTrustedProxy(address, rules = []) {
  const normalized = normalizeAddress(address)
  return rules.some((rule) => {
    if (rule === normalized) return true
    if (rule === 'loopback') return normalized === '::1' || normalized.startsWith('127.')
    if (rule === 'linklocal') return normalized.startsWith('169.254.') || normalized.toLowerCase().startsWith('fe80:')
    if (rule === 'uniquelocal') return normalized.startsWith('10.') || normalized.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(normalized) || /^f[cd]/i.test(normalized)
    return false
  })
}

function resolveRequestContext(request, trustedProxyRules = []) {
  const peer = normalizeAddress(request.socket.remoteAddress ?? 'unknown')
  const trusted = matchesTrustedProxy(peer, trustedProxyRules)
  const forwardedFor = String(request.headers['x-forwarded-for'] ?? '').split(',')[0].trim()
  const clientIp = trusted && net.isIP(forwardedFor) ? normalizeAddress(forwardedFor) : peer
  const forwardedProtocol = String(request.headers['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase()
  return { peer, trustedProxy: trusted, clientIp, secure: trusted && forwardedProtocol === 'https' }
}

module.exports = { matchesTrustedProxy, resolveRequestContext }
