function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const buckets = new Map()
  return {
    consume(key) {
      const timestamp = now()
      const current = buckets.get(key)
      if (!current || current.resetAt <= timestamp) {
        buckets.set(key, { count: 1, resetAt: timestamp + windowMs })
        return { allowed: true, retryAfterSeconds: 0 }
      }
      current.count += 1
      if (current.count > limit) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - timestamp) / 1000)) }
      }
      return { allowed: true, retryAfterSeconds: 0 }
    },
    clear(key) { buckets.delete(key) }
  }
}

module.exports = { createRateLimiter }
