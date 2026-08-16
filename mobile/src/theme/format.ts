/**
 * Presentation-only money formatting.
 *
 * All arithmetic stays in the money helpers; this module only turns an already
 * computed integer-minor-unit value into display text. Intl.NumberFormat is
 * expensive to construct, and the screens format a dozen values per render, so
 * formatters are cached per locale + currency pair.
 */
import { moneyDisplayNumber } from '../models/money'

const formatters = new Map<string, Intl.NumberFormat>()

function currencyFormatter(locale: string, currency: string): Intl.NumberFormat {
  const key = `${locale}|${currency}`
  const cached = formatters.get(key)
  if (cached) return cached
  let formatter: Intl.NumberFormat
  try {
    formatter = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2, minimumFractionDigits: 2 })
  } catch {
    // An unsupported locale or currency code must never take down a screen.
    formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2, minimumFractionDigits: 2 })
  }
  formatters.set(key, formatter)
  return formatter
}

export interface MoneyFormatter {
  (value: number): string
}

/** Builds a formatter bound to one locale/currency, safe to hold in a useMemo. */
export function createMoneyFormatter(currency: string, locale = 'en-US'): MoneyFormatter {
  const formatter = currencyFormatter(locale, currency)
  return (value: number) => {
    try {
      return formatter.format(moneyDisplayNumber(value))
    } catch {
      // moneyDisplayNumber rejects values outside the supported range rather
      // than silently rendering something wrong.
      return '—'
    }
  }
}

/** Compact form for dense rows, e.g. 12.4K. Falls back to the full string. */
export function createCompactMoneyFormatter(currency: string, locale = 'en-US'): MoneyFormatter {
  let compact: Intl.NumberFormat
  try {
    compact = new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 })
  } catch {
    return createMoneyFormatter(currency, locale)
  }
  const full = createMoneyFormatter(currency, locale)
  return (value: number) => {
    try {
      return Math.abs(value) >= 1_000_00 ? compact.format(moneyDisplayNumber(value)) : full(value)
    } catch {
      return '—'
    }
  }
}

/** "16 days left" style copy, pluralised. */
export function formatDayCount(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'} left`
}

/** Renders an ISO timestamp as a short relative string for sync status. */
export function formatRelativeTime(value: string | null, now = Date.now()): string {
  if (!value) return 'Never'
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return 'Never'
  const seconds = Math.max(Math.round((now - timestamp) / 1000), 0)
  if (seconds < 45) return 'Just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days < 7 ? `${days}d ago` : new Date(value).toLocaleDateString()
}
