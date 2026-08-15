function parseGeneration(candidate) {
  if (!candidate || typeof candidate.generationId !== 'string' || typeof candidate.timestamp !== 'string') return null
  const timestamp = new Date(candidate.timestamp)
  if (Number.isNaN(timestamp.getTime()) || candidate.verification?.status !== 'valid') return null
  return { ...candidate, parsedTimestamp: timestamp }
}

function isoWeekKey(date) {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = value.getUTCDay() || 7
  value.setUTCDate(value.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((value - yearStart) / 86400000) + 1) / 7)
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function newestPerBucket(generations, key, limit) {
  const selected = new Set()
  const buckets = new Set()
  for (const generation of generations) {
    const bucket = key(generation.parsedTimestamp)
    if (!buckets.has(bucket) && buckets.size < limit) { buckets.add(bucket); selected.add(generation.generationId) }
  }
  return selected
}

function selectRetention(candidates, protections = {}) {
  const malformed = []
  const valid = []
  for (const candidate of candidates) {
    const parsed = parseGeneration(candidate)
    if (parsed) valid.push(parsed)
    else malformed.push(candidate)
  }
  valid.sort((a, b) => b.parsedTimestamp - a.parsedTimestamp)
  const keep = new Set([protections.currentGenerationId, protections.lastKnownGoodGenerationId, valid[0]?.generationId].filter(Boolean))
  for (const id of newestPerBucket(valid, (date) => date.toISOString().slice(0, 10), 7)) keep.add(id)
  for (const id of newestPerBucket(valid, isoWeekKey, 4)) keep.add(id)
  for (const id of newestPerBucket(valid, (date) => date.toISOString().slice(0, 7), 3)) keep.add(id)
  return { keep, delete: valid.filter((item) => !keep.has(item.generationId)), malformed }
}

module.exports = { parseGeneration, isoWeekKey, selectRetention }
