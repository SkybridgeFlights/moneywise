import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeDashboardAnalytics } from './analytics'
import { createDefaultFinanceState, defaultSettings } from './defaults'
import { MAX_MONEY_MINOR_UNITS } from './money'
import type { ExpenseRecord, FinanceState, IncomeRecord } from './types'

// The App renders <DashboardScreen> from computeDashboardAnalytics inside a
// useMemo on first paint, so anything this throws is a startup crash on a real
// device. Signed production APK 25b6498d crashed here on an Android emulator
// with "Invalid money division." — reproduced below before the fix.
const CRASH_DATE = new Date(2026, 7, 16, 10, 0, 0) // 2026-08-16, 16 days left in August

afterEach(() => {
  vi.useRealTimers()
})

function at(date: Date): void {
  vi.useFakeTimers()
  vi.setSystemTime(date)
}

// The exact state App.tsx holds on a clean install: createDefaultFinanceState()
// passed through ensureSeedState(), which only backfills categories/settings.
function cleanInstallState(): FinanceState {
  return createDefaultFinanceState()
}

function income(amount: number, date: string): IncomeRecord {
  return {
    id: `income-${date}-${amount}`,
    name: 'Salary',
    groupName: 'Employment',
    amount,
    date,
    type: 'fixed',
    recurring: false,
    notes: ''
  }
}

function expense(amount: number, date: string, type: ExpenseRecord['type'] = 'variable'): ExpenseRecord {
  return {
    id: `expense-${date}-${amount}`,
    title: 'Expense',
    amount,
    date,
    categoryId: 'food',
    paymentMethod: 'card',
    type,
    recurring: false,
    notes: '',
    tags: [],
    goalId: null,
    debtId: null,
    allocationKind: 'spend'
  }
}

describe('dashboard analytics startup safety', () => {
  it('does not crash on a clean-install profile on the date the signed APK crashed', () => {
    at(CRASH_DATE)
    expect(() => computeDashboardAnalytics(cleanInstallState())).not.toThrow()
  })

  it('does not crash on any day of a 31-day month', () => {
    const failures: Array<{ day: number; message: string }> = []
    for (let day = 1; day <= 31; day += 1) {
      at(new Date(2026, 7, day, 10, 0, 0))
      try {
        computeDashboardAnalytics(cleanInstallState())
      } catch (error) {
        failures.push({ day, message: error instanceof Error ? error.message : String(error) })
      }
      vi.useRealTimers()
    }
    expect(failures).toEqual([])
  })

  it('does not crash on any day of a 28-day, 29-day or 30-day month', () => {
    const failures: Array<{ label: string; message: string }> = []
    const months: Array<[string, number, number, number]> = [
      ['2026-02 (28d)', 2026, 1, 28],
      ['2028-02 (29d)', 2028, 1, 29],
      ['2026-09 (30d)', 2026, 8, 30]
    ]
    for (const [label, year, monthIndex, length] of months) {
      for (let day = 1; day <= length; day += 1) {
        at(new Date(year, monthIndex, day, 10, 0, 0))
        try {
          computeDashboardAnalytics(cleanInstallState())
        } catch (error) {
          failures.push({ label: `${label} day ${day}`, message: error instanceof Error ? error.message : String(error) })
        }
        vi.useRealTimers()
      }
    }
    expect(failures).toEqual([])
  })
})

describe('dashboard analytics empty and zero states', () => {
  it('reports an entirely empty profile as zeroed rather than throwing', () => {
    at(CRASH_DATE)
    const analytics = computeDashboardAnalytics({
      incomes: [],
      expenses: [],
      categories: [],
      goals: [],
      debts: [],
      budgetPlans: [],
      monthlySummaries: [],
      settings: defaultSettings
    })
    expect(analytics.totalIncome).toBe(0)
    expect(analytics.totalExpenses).toBe(0)
    expect(analytics.remainingBalance).toBe(0)
    expect(analytics.safeDailySpending).toBe(0)
    expect(analytics.safeWeeklySpending).toBe(0)
    expect(analytics.smartPlanner.safeWeeklySpending).toBe(0)
  })

  it('handles zero income with recorded expenses', () => {
    at(CRASH_DATE)
    const state = { ...cleanInstallState(), expenses: [expense(25_00, '2026-08-05')] }
    const analytics = computeDashboardAnalytics(state)
    expect(analytics.totalIncome).toBe(0)
    expect(analytics.totalExpenses).toBe(25_00)
    expect(analytics.remainingBalance).toBe(-25_00)
    expect(Number.isSafeInteger(analytics.safeWeeklySpending)).toBe(true)
  })

  it('handles zero expenses with recorded income', () => {
    at(CRASH_DATE)
    const state = { ...cleanInstallState(), incomes: [income(1_000_00, '2026-08-01')] }
    const analytics = computeDashboardAnalytics(state)
    expect(analytics.totalExpenses).toBe(0)
    expect(analytics.remainingBalance).toBe(1_000_00)
    expect(Number.isSafeInteger(analytics.safeWeeklySpending)).toBe(true)
  })

  it('handles a zero-budget profile with no categories or plans', () => {
    at(CRASH_DATE)
    const state = { ...cleanInstallState(), categories: [], budgetPlans: [] }
    expect(() => computeDashboardAnalytics(state)).not.toThrow()
  })
})

describe('dashboard analytics weekly arithmetic', () => {
  it('keeps every money figure an exact integer number of cents', () => {
    at(CRASH_DATE)
    const state = {
      ...cleanInstallState(),
      incomes: [income(3_333_33, '2026-08-01')],
      expenses: [expense(1_111_11, '2026-08-02'), expense(222_22, '2026-08-14', 'fixed')]
    }
    const analytics = computeDashboardAnalytics(state)
    const figures = [
      analytics.totalIncome,
      analytics.totalExpenses,
      analytics.remainingBalance,
      analytics.safeDailySpending,
      analytics.safeWeeklySpending,
      analytics.smartPlanner.safeDailySpending,
      analytics.smartPlanner.safeWeeklySpending,
      analytics.smartPlanner.remainingUsableBalance
    ]
    figures.forEach((figure) => expect(Number.isSafeInteger(figure)).toBe(true))
  })

  it('divides by the fractional remaining-week count as an exact ratio', () => {
    // 2026-08-16 leaves 16 days, i.e. 16/7 weeks. A 1,000.00 balance spread over
    // that span is 1000_00 * 7 / 16 = 437_50 exactly — never 1000_00 / 2.29.
    at(CRASH_DATE)
    const state = { ...cleanInstallState(), incomes: [income(1_000_00, '2026-08-01')] }
    const analytics = computeDashboardAnalytics(state)
    expect(analytics.remainingDaysInMonth).toBe(16)
    expect(analytics.remainingWeeksInMonth).toBeCloseTo(2.29, 2)
    expect(analytics.safeWeeklySpending).toBe(437_50)
  })

  it('treats a remainder shorter than a week as a single week', () => {
    at(new Date(2026, 7, 29, 10, 0, 0)) // 3 days left
    const state = { ...cleanInstallState(), incomes: [income(600_00, '2026-08-01')] }
    const analytics = computeDashboardAnalytics(state)
    expect(analytics.remainingDaysInMonth).toBe(3)
    expect(analytics.remainingWeeksInMonth).toBe(1)
    expect(analytics.safeWeeklySpending).toBe(600_00)
  })

  it('matches plain division when the remaining span is a whole number of weeks', () => {
    at(new Date(2026, 7, 18, 10, 0, 0)) // 14 days left => exactly 2 weeks
    const state = { ...cleanInstallState(), incomes: [income(700_00, '2026-08-01')] }
    const analytics = computeDashboardAnalytics(state)
    expect(analytics.remainingDaysInMonth).toBe(14)
    expect(analytics.remainingWeeksInMonth).toBe(2)
    expect(analytics.safeWeeklySpending).toBe(350_00)
  })

  it('stays exact at the top of the supported money range', () => {
    at(CRASH_DATE)
    const state = { ...cleanInstallState(), incomes: [income(MAX_MONEY_MINOR_UNITS, '2026-08-01')] }
    const analytics = computeDashboardAnalytics(state)
    expect(analytics.totalIncome).toBe(MAX_MONEY_MINOR_UNITS)
    expect(Number.isSafeInteger(analytics.safeWeeklySpending)).toBe(true)
    // (99_999_999_999 * 7 + 8) / 16, floored — half-up on the absolute value.
    expect(analytics.safeWeeklySpending).toBe(43_750_000_000)
  })

  it('keeps negative balances exact and signed', () => {
    at(CRASH_DATE)
    const state = { ...cleanInstallState(), expenses: [expense(1_000_00, '2026-08-02')] }
    const analytics = computeDashboardAnalytics(state)
    expect(analytics.remainingBalance).toBe(-1_000_00)
    expect(analytics.safeWeeklySpending).toBe(-437_50)
  })
})

describe('dashboard analytics populated profile', () => {
  it('computes a normal populated month without floating-point drift', () => {
    at(CRASH_DATE)
    const state: FinanceState = {
      ...cleanInstallState(),
      incomes: [income(4_500_00, '2026-08-01'), income(250_50, '2026-08-10')],
      expenses: [
        expense(1_200_00, '2026-08-01', 'fixed'),
        expense(89_99, '2026-08-03'),
        expense(45_01, '2026-08-12'),
        expense(300_00, '2026-08-25', 'fixed')
      ]
    }
    const analytics = computeDashboardAnalytics(state)
    expect(analytics.totalIncome).toBe(4_750_50)
    expect(analytics.totalExpenses).toBe(1_635_00)
    expect(analytics.remainingBalance).toBe(3_115_50)
    expect(analytics.fixedMonthlyExpenses).toBe(1_500_00)
    expect(analytics.variableExpensesThisMonth).toBe(135_00)
    expect(analytics.remainingAfterFixedExpenses).toBe(3_250_50)
    expect(analytics.safeWeeklySpending).toBe(1_363_03) // (3_115_50 * 7 + 8) / 16
  })
})
