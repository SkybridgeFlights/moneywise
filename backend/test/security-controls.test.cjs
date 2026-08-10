const test = require('node:test')
const assert = require('node:assert/strict')
const { createPasswordWorkQueue } = require('../services/passwordWorkQueue.cjs')
const { createRateLimiter } = require('../http/rateLimiter.cjs')
const { resolveRequestContext } = require('../http/proxy.cjs')

test('password hashing queue enforces concurrency and queue depth bounds', async () => {
  const queue = createPasswordWorkQueue(2, 2)
  const releases = []
  const work = () => new Promise((resolve) => releases.push(resolve))
  const running = [queue.run(work), queue.run(work), queue.run(work), queue.run(work)]
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(queue.stats(), { active: 2, queued: 2, maxConcurrent: 2, maxQueued: 2 })
  await assert.rejects(() => queue.run(work), (error) => error.code === 'password_queue_overloaded' && error.statusCode === 503)
  releases.splice(0).forEach((release) => release())
  await new Promise((resolve) => setImmediate(resolve))
  releases.splice(0).forEach((release) => release())
  await Promise.all(running)
  assert.deepEqual(queue.stats(), { active: 0, queued: 0, maxConcurrent: 2, maxQueued: 2 })
})

test('rate limiter expires keys and refuses unbounded unique-key growth', () => {
  let timestamp = 0
  const limiter = createRateLimiter({ limit: 2, windowMs: 100, maxKeys: 3, now: () => timestamp })
  for (const key of ['a', 'b', 'c']) assert.equal(limiter.consume(key).allowed, true)
  assert.equal(limiter.consume('d').allowed, false)
  assert.equal(limiter.size(), 3)
  timestamp = 101
  assert.equal(limiter.consume('d').allowed, true)
  assert.equal(limiter.size(), 1)
})

test('forwarded headers are honored only for an explicitly trusted peer', () => {
  const forged = resolveRequestContext({ socket: { remoteAddress: '203.0.113.8' }, headers: { 'x-forwarded-for': '198.51.100.4', 'x-forwarded-proto': 'https' } }, ['10.0.0.1'])
  assert.equal(forged.clientIp, '203.0.113.8')
  assert.equal(forged.secure, false)
  const trustedA = resolveRequestContext({ socket: { remoteAddress: '10.0.0.1' }, headers: { 'x-forwarded-for': '198.51.100.4', 'x-forwarded-proto': 'https' } }, ['10.0.0.1'])
  const trustedB = resolveRequestContext({ socket: { remoteAddress: '10.0.0.1' }, headers: { 'x-forwarded-for': '198.51.100.5', 'x-forwarded-proto': 'https' } }, ['10.0.0.1'])
  assert.equal(trustedA.clientIp, '198.51.100.4'); assert.equal(trustedB.clientIp, '198.51.100.5'); assert.equal(trustedA.secure, true)
})
