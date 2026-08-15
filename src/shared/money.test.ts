import { describe, expect, it } from 'vitest'
import { divideMoney, formatMoneyDecimal, MAX_MONEY_MINOR_UNITS, multiplyMoneyByBasisPoints, parseMoneyDecimal, sumMoney } from './money'

describe('exact minor-unit money', () => {
  it.each([
    ['0.1', 10], ['0.10', 10], ['0.01', 1], ['2.675', null], ['1.005', null], ['0.005', null], ['999999999.99', MAX_MONEY_MINOR_UNITS]
  ])('parses %s deterministically', (text, expected) => {
    if (expected === null) expect(() => parseMoneyDecimal(text)).toThrow()
    else expect(parseMoneyDecimal(text)).toBe(expected)
  })

  it('sums decimal examples and ten thousand cents exactly', () => {
    expect(sumMoney([parseMoneyDecimal('0.1'), parseMoneyDecimal('0.2')])).toBe(30)
    expect(sumMoney(Array.from({ length: 10_000 }, () => parseMoneyDecimal('0.01')))).toBe(10_000)
  })

  it('formats exact boundary values', () => {
    expect(formatMoneyDecimal(0)).toBe('0.00')
    expect(formatMoneyDecimal(1)).toBe('0.01')
    expect(formatMoneyDecimal(110)).toBe('1.10')
    expect(formatMoneyDecimal(MAX_MONEY_MINOR_UNITS)).toBe('999999999.99')
  })

  it('uses deterministic half-away-from-zero integer allocation', () => {
    expect(divideMoney(1, 2)).toBe(1)
    expect(divideMoney(-1, 2)).toBe(-1)
    expect(multiplyMoneyByBasisPoints(101, 5_000)).toBe(51)
  })

  it('preserves totals under deterministic shuffles, edits, deletes, and serialization', () => {
    const values = Array.from({ length: 1_000 }, (_, index) => (index % 2 ? index : -index))
    const shuffled = [...values].sort((left, right) => ((left * 31) % 97) - ((right * 31) % 97))
    expect(sumMoney(values)).toBe(sumMoney(shuffled))
    const original = sumMoney(values)
    expect(sumMoney([...values, 12_345, -12_345])).toBe(original)
    expect(JSON.parse(JSON.stringify({ amount: MAX_MONEY_MINOR_UNITS })).amount).toBe(MAX_MONEY_MINOR_UNITS)
  })

  it.each([100, 1_000, 10_000])('sums %i records exactly within a practical budget', (count) => {
    const started = performance.now()
    expect(sumMoney(Array.from({ length: count }, () => 1))).toBe(count)
    expect(performance.now() - started).toBeLessThan(250)
  })
})
