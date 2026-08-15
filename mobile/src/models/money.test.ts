import { describe, expect, it } from 'vitest'
import { divideMoney, formatMoneyDecimal, MAX_MONEY_MINOR_UNITS, multiplyMoneyByBasisPoints, parseMoneyDecimal } from './money'

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
})
