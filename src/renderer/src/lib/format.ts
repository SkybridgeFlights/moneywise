import { formatMoneyDecimal, moneyDisplayNumber, parseMoneyDecimal } from '@shared/money'

export const currencyFormatter = (value: number, currency: string, locale: string): string => {
  const displayValue = moneyDisplayNumber(value)
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: value % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    }).format(displayValue)
  } catch {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: value % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    }).format(displayValue)
  }
}

export const percentFormatter = (value: number): string => `${value.toFixed(1)}%`

export const parseDecimalInput = (value: string): number => {
  try {
    return parseMoneyDecimal(value)
  } catch {
    return Number.NaN
  }
}

export const moneyInputValue = (value: number): string => Number.isSafeInteger(value) ? formatMoneyDecimal(value) : ''

export const todayString = (): string => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
