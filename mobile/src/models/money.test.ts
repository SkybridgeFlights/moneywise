import { describe, expect, it } from 'vitest'
import { allocateMoney, divideMoney, formatMoneyDecimal, MAX_MONEY_MINOR_UNITS, multiplyMoneyByBasisPoints, parseMoneyDecimal } from './money'

describe('mobile exact money boundary', () => {
  it('parses and formats integer cents without float multiplication', () => {
    expect(parseMoneyDecimal('0.10')).toBe(10)
    expect(parseMoneyDecimal('0.005')).toBeNaN()
    expect(parseMoneyDecimal('999999999.99')).toBe(MAX_MONEY_MINOR_UNITS)
    expect(formatMoneyDecimal(110)).toBe('1.10')
  })

  it('allocates and compares exact cents', () => {
    expect(divideMoney(10_000, 3)).toBe(3_333)
    expect(multiplyMoneyByBasisPoints(101, 5_000)).toBe(51)
  })

  it('rejects a non-integer divisor rather than approximating it', () => {
    expect(() => divideMoney(10_000, 2.29)).toThrow('Invalid money division.')
    expect(() => divideMoney(10_000, 0)).toThrow('Invalid money division.')
    expect(() => divideMoney(10_000, -1)).toThrow('Invalid money division.')
  })

  it('scales by an exact ratio for fractional periods', () => {
    // 100.00 spread over 16/7 weeks: (10_000 * 7 + 8) / 16 = 4_375.
    expect(allocateMoney(10_000, 7, 16)).toBe(4_375)
    expect(allocateMoney(-10_000, 7, 16)).toBe(-4_375)
    expect(allocateMoney(10_000, 7, 14)).toBe(divideMoney(10_000, 2))
    expect(allocateMoney(MAX_MONEY_MINOR_UNITS, 7, 16)).toBe(43_750_000_000)
  })

  it('rejects an invalid allocation denominator', () => {
    expect(() => allocateMoney(10_000, 7, 0)).toThrow('Invalid money allocation.')
    expect(() => allocateMoney(10_000, 7, 2.5)).toThrow('Invalid money allocation.')
    expect(() => allocateMoney(10_000, 1.5, 7)).toThrow('Invalid money allocation.')
  })
})
