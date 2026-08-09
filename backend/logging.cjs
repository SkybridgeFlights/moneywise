function createLogger(level = 'info') {
  const enabled = level !== 'silent'
  function write(severity, event, detail = {}) {
    if (!enabled) return
    const line = JSON.stringify({ timestamp: new Date().toISOString(), severity, event, ...detail })
    ;(severity === 'error' ? console.error : console.log)(line)
  }
  return {
    info: (event, detail) => write('info', event, detail),
    warn: (event, detail) => write('warn', event, detail),
    error: (event, detail) => write('error', event, detail)
  }
}

module.exports = { createLogger }
