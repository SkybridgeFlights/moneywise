export const MAX_MONEY_MINOR_UNITS = 99_999_999_999

export type MoneyMinorUnits = number

export function assertMoneyMinorUnits(value: unknown, options: { allowNegative?: boolean } = {}): MoneyMinorUnits {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('Money must be an integer number of minor units.')
  const minimum = options.allowNegative ? -MAX_MONEY_MINOR_UNITS : 0
  if (value < minimum || value > MAX_MONEY_MINOR_UNITS) throw new Error('Money is outside the supported range.')
  return value
}

export function parseMoneyDecimal(value: string, options: { allowNegative?: boolean } = {}): MoneyMinorUnits {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) return 0
  const match = /^(-?)(\d+)(?:\.(\d{0,2}))?$/.exec(normalized)
  if (!match) throw new Error('Enter a monetary value with no more than two decimal places.')
  if (match[1] && !options.allowNegative) throw new Error('Money cannot be negative.')
  const whole = BigInt(match[2])
  const fraction = BigInt((match[3] ?? '').padEnd(2, '0'))
  const signed = (whole * 100n + fraction) * (match[1] ? -1n : 1n)
  const maximum = BigInt(MAX_MONEY_MINOR_UNITS)
  if (signed > maximum || signed < (options.allowNegative ? -maximum : 0n)) throw new Error('Money is outside the supported range.')
  return Number(signed)
}

export function formatMoneyDecimal(value: MoneyMinorUnits): string {
  const minor = assertMoneyMinorUnits(value, { allowNegative: true })
  const absolute = Math.abs(minor)
  const sign = minor < 0 ? '-' : ''
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}

export function moneyDisplayNumber(value: MoneyMinorUnits): number {
  return assertMoneyMinorUnits(value, { allowNegative: true }) / 100
}

export function sumMoney(values: Iterable<MoneyMinorUnits>, options: { allowNegative?: boolean } = { allowNegative: true }): MoneyMinorUnits {
  let total = 0n
  for (const value of values) total += BigInt(assertMoneyMinorUnits(value, { allowNegative: options.allowNegative ?? true }))
  const maximum = BigInt(MAX_MONEY_MINOR_UNITS)
  if (total > maximum || total < -maximum) throw new Error('Money total exceeds the supported range.')
  return Number(total)
}

export function divideMoney(value: MoneyMinorUnits, divisor: number): MoneyMinorUnits {
  assertMoneyMinorUnits(value, { allowNegative: true })
  if (!Number.isSafeInteger(divisor) || divisor <= 0) throw new Error('Money divisor must be a positive integer.')
  const amount = BigInt(value)
  const denominator = BigInt(divisor)
  const absolute = amount < 0n ? -amount : amount
  const rounded = (absolute + denominator / 2n) / denominator
  return assertMoneyMinorUnits(Number(amount < 0n ? -rounded : rounded), { allowNegative: true })
}

export function allocateMoney(value: MoneyMinorUnits, numerator: number, denominator: number): MoneyMinorUnits {
  assertMoneyMinorUnits(value, { allowNegative: true })
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new Error('Money allocation requires safe integer terms and a positive denominator.')
  }
  const product = BigInt(value) * BigInt(numerator)
  const divisor = BigInt(denominator)
  const absolute = product < 0n ? -product : product
  const rounded = (absolute + divisor / 2n) / divisor
  return assertMoneyMinorUnits(Number(product < 0n ? -rounded : rounded), { allowNegative: true })
}

export function multiplyMoneyByBasisPoints(value: MoneyMinorUnits, basisPoints: number): MoneyMinorUnits {
  assertMoneyMinorUnits(value, { allowNegative: true })
  if (!Number.isSafeInteger(basisPoints)) throw new Error('Rate must be integer basis points.')
  const product = BigInt(value) * BigInt(basisPoints)
  const absolute = product < 0n ? -product : product
  const rounded = (absolute + 5_000n) / 10_000n
  return assertMoneyMinorUnits(Number(product < 0n ? -rounded : rounded), { allowNegative: true })
}

export function percentageToBasisPoints(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error('Percentage is outside the supported range.')
  const text = String(value)
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text)
  if (!match) throw new Error('Percentage supports at most two decimal places.')
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
}

export function decimalToHundredths(value: number, maximum: number): number {
  if (!Number.isFinite(value) || value < 0 || value > maximum) throw new Error('Decimal metric is outside the supported range.')
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value))
  if (!match) throw new Error('Decimal metric supports at most two decimal places.')
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
}
