class HttpError extends Error {
  constructor(statusCode, message, code) {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

function readJsonBody(request, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const contentLength = Number(request.headers['content-length'] ?? 0)
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      reject(new HttpError(413, 'Request body is too large.', 'body_too_large'))
      return
    }
    let raw = ''
    let bytes = 0
    let settled = false
    request.on('data', (chunk) => {
      if (settled) return
      bytes += chunk.length
      if (bytes > maxBytes) {
        settled = true
        reject(new HttpError(413, 'Request body is too large.', 'body_too_large'))
        return
      }
      raw += chunk.toString('utf8')
    })
    request.on('end', () => {
      if (settled) return
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(new HttpError(400, 'Invalid JSON body.', 'invalid_json'))
      }
    })
    request.on('error', reject)
  })
}

module.exports = {
  readJsonBody,
  HttpError
}
