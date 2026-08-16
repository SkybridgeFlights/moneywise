import { describe, expect, it } from 'vitest'
import { createMoneyFormatter, formatDayCount, formatRelativeTime } from './format'
import { MAX_MONEY_MINOR_UNITS } from '../models/money'

describe('money formatting', () => {
  it('renders integer minor units without float drift', () => {
    const format = createMoneyFormatter('USD', 'en-US')
    expect(format(0)).toBe('$0.00')
    expect(format(1)).toBe('$0.01')
    expect(format(99)).toBe('$0.99')
    expect(format(100_00)).toBe('$100.00')
    expect(format(-42_75)).toBe('-$42.75')
  })

  it('keeps the exact cent at the top of the supported range', () => {
    const format = createMoneyFormatter('USD', 'en-US')
    expect(format(MAX_MONEY_MINOR_UNITS)).toBe('$999,999,999.99')
  })

  it('reuses one formatter per locale and currency pair', () => {
    const first = createMoneyFormatter('EUR', 'en-US')
    const second = createMoneyFormatter('EUR', 'en-US')
    // Same underlying Intl instance, so repeated renders do not rebuild it.
    expect(first(1_00)).toBe(second(1_00))
  })

  it('falls back instead of throwing on an unsupported locale', () => {
    const format = createMoneyFormatter('USD', 'not-a-locale')
    expect(typeof format(1_00)).toBe('string')
    expect(format(1_00).length).toBeGreaterThan(0)
  })

  it('renders a placeholder rather than throwing on an out-of-range value', () => {
    const format = createMoneyFormatter('USD', 'en-US')
    expect(format(MAX_MONEY_MINOR_UNITS + 1)).toBe('—')
    expect(format(1.5)).toBe('—')
  })
})

describe('supporting copy', () => {
  it('pluralises the day count', () => {
    expect(formatDayCount(1)).toBe('1 day left')
    expect(formatDayCount(16)).toBe('16 days left')
  })

  it('describes sync recency without exposing timestamps', () => {
    const now = new Date('2026-08-16T12:00:00Z').getTime()
    expect(formatRelativeTime(null, now)).toBe('Never')
    expect(formatRelativeTime('2026-08-16T11:59:40Z', now)).toBe('Just now')
    expect(formatRelativeTime('2026-08-16T11:30:00Z', now)).toBe('30m ago')
    expect(formatRelativeTime('2026-08-16T06:00:00Z', now)).toBe('6h ago')
    expect(formatRelativeTime('2026-08-14T12:00:00Z', now)).toBe('2d ago')
  })

  it('ignores a malformed timestamp', () => {
    expect(formatRelativeTime('not-a-date')).toBe('Never')
  })
})
