export const MAX_MONEY_MINOR_UNITS = 99_999_999_999

export function parseMoneyDecimal(value: string, fallback = 0): number {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) return fallback
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(normalized)
  if (!match) return Number.NaN
  const minor = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'))
  return minor <= BigInt(MAX_MONEY_MINOR_UNITS) ? Number(minor) : Number.NaN
}

export function moneyDisplayNumber(value: number): number {
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_MONEY_MINOR_UNITS) throw new Error('Invalid money minor-unit value.')
  return value / 100
}

export function formatMoneyDecimal(value: number): string {
  if (!Number.isSafeInteger(value)) return ''
  const absolute = Math.abs(value)
  return `${value < 0 ? '-' : ''}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}

export function divideMoney(value: number, divisor: number): number {
  if (!Number.isSafeInteger(value) || !Number.isSafeInteger(divisor) || divisor <= 0) throw new Error('Invalid money division.')
  const amount = BigInt(value)
  const denominator = BigInt(divisor)
  const absolute = amount < 0n ? -amount : amount
  const rounded = (absolute + denominator / 2n) / denominator
  return Number(amount < 0n ? -rounded : rounded)
}

export function multiplyMoneyByBasisPoints(value: number, basisPoints: number): number {
  if (!Number.isSafeInteger(value) || !Number.isSafeInteger(basisPoints)) throw new Error('Invalid money rate.')
  const product = BigInt(value) * BigInt(basisPoints)
  const absolute = product < 0n ? -product : product
  const rounded = (absolute + 5_000n) / 10_000n
  return Number(product < 0n ? -rounded : rounded)
}
