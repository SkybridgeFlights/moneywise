function createPasswordWorkQueue(maxConcurrent = 4, maxQueued = 32) {
  let active = 0
  const waiting = []
  async function run(work, signal) {
    if (active >= maxConcurrent) {
      if (waiting.length >= maxQueued) {
        const error = new Error('Password service is temporarily overloaded.')
        error.code = 'password_queue_overloaded'
        error.statusCode = 503
        throw error
      }
      await new Promise((resolve, reject) => {
        const entry = { resolve, reject }
        const abort = () => {
          const index = waiting.indexOf(entry)
          if (index >= 0) waiting.splice(index, 1)
          const error = new Error('Password request was aborted while waiting for capacity.')
          error.statusCode = 503
          reject(error)
        }
        if (signal?.aborted) return abort()
        entry.resolve = () => { signal?.removeEventListener('abort', abort); resolve() }
        waiting.push(entry)
        signal?.addEventListener('abort', abort, { once: true })
      })
    }
    active += 1
    try { return await work() } finally {
      active -= 1
      waiting.shift()?.resolve()
    }
  }
  return { run, stats: () => ({ active, queued: waiting.length, maxConcurrent, maxQueued }) }
}

module.exports = { createPasswordWorkQueue }
