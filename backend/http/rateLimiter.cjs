function createRateLimiter({ limit, windowMs, now = Date.now, maxKeys = 10_000 }) {
  const buckets = new Map()
  function cleanup(timestamp) {
    for (const [key, bucket] of buckets) if (bucket.resetAt <= timestamp) buckets.delete(key)
  }
  return {
    consume(key) {
      const timestamp = now()
      if (buckets.size >= maxKeys) cleanup(timestamp)
      if (!buckets.has(key) && buckets.size >= maxKeys) return { allowed: false, retryAfterSeconds: 1, capacityExceeded: true }
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
    clear(key) { buckets.delete(key) },
    cleanup() { cleanup(now()) },
    size() { return buckets.size }
  }
}

module.exports = { createRateLimiter }
