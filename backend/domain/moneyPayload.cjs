const MAX_MINOR_UNITS = 99_999_999_999

const FIELDS = {
  income: ['amount'], expense: ['amount'], category: ['monthlyLimit'],
  goal: ['targetAmount', 'currentAmount'], debt: ['totalAmount', 'installmentAmount'],
  budget: ['customSavingsTarget', 'customEmergencyTarget', 'debtAcceleration'],
  'monthly-summary': ['income', 'expenses', 'savings', 'debtPayments', 'closingBalance']
}

function parseLegacyMajor(value, nullable = false) {
  if (value == null && nullable) return null
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error('Legacy money value is not numeric.')
  const match = /^(-?)(\d+)(?:\.(\d{0,2}))?$/.exec(String(value))
  if (!match) throw new Error('Legacy money value is not cent-exact.')
  const minor = (BigInt(match[2]) * 100n + BigInt((match[3] || '').padEnd(2, '0'))) * (match[1] ? -1n : 1n)
  if (minor > BigInt(MAX_MINOR_UNITS) || minor < -BigInt(MAX_MINOR_UNITS)) throw new Error('Legacy money value is outside the supported range.')
  return Number(minor)
}

function assertMinor(value, nullable = false) {
  if (value == null && nullable) return null
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_MINOR_UNITS) throw new Error('Stored v2 money is not a safe integer minor-unit value.')
  return value
}

function normalizeStoredMoneyPayload(entityType, input) {
  const payload = input && typeof input === 'object' && !Array.isArray(input) ? structuredClone(input) : {}
  const v2 = payload.moneyVersion === 2
  for (const field of FIELDS[entityType] || []) {
    const nullable = entityType === 'category' && field === 'monthlyLimit'
    payload[field] = v2 ? assertMinor(payload[field], nullable) : parseLegacyMajor(payload[field], nullable)
  }
  if (entityType === 'budget' && Array.isArray(payload.rules)) {
    payload.rules = payload.rules.map((rule) => ({ ...rule, lockedAmount: v2 ? assertMinor(rule.lockedAmount, true) : parseLegacyMajor(rule.lockedAmount, true) }))
  }
  if (entityType === 'settings' && payload.balanceCorrection) {
    payload.balanceCorrection = Object.fromEntries(Object.entries(payload.balanceCorrection).map(([key, value]) =>
      ['calculatedBalanceBefore', 'correctedBalance', 'difference'].includes(key) ? [key, v2 ? assertMinor(value) : parseLegacyMajor(value)] : [key, value]))
  }
  payload.moneyVersion = 2
  return payload
}

module.exports = { MAX_MINOR_UNITS, normalizeStoredMoneyPayload, parseLegacyMajor }
