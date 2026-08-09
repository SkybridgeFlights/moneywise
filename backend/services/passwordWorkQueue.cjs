function createPasswordWorkQueue(maxConcurrent = 4) {
  let active = 0
  const waiting = []
  async function run(work) {
    if (active >= maxConcurrent) await new Promise((resolve) => waiting.push(resolve))
    active += 1
    try { return await work() } finally {
      active -= 1
      waiting.shift()?.()
    }
  }
  return { run }
}

module.exports = { createPasswordWorkQueue }
