import { describe, expect, it } from 'vitest'
import { buildBudgetPlanner } from './budgetPlanner'
import { createDefaultFinanceState } from './defaults'
import type { FinanceState, IncomeRecord } from './types'

// buildBudgetPlanner divided by a fractional remaining-week count, the same
// defect that crashed computeDashboardAnalytics on the signed APK. It is reached
// as soon as the Budget tab renders rather than at startup.
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

function state(): FinanceState {
  return { ...createDefaultFinanceState(), incomes: [income(2_000_00, '2026-08-01')] }
}

describe('budget planner weekly arithmetic', () => {
  it('does not throw on any day of a 31-day month', () => {
    const failures: Array<{ day: number; message: string }> = []
    for (let day = 1; day <= 31; day += 1) {
      try {
        buildBudgetPlanner(state(), 'month', new Date(2026, 7, day, 10, 0, 0))
      } catch (error) {
        failures.push({ day, message: error instanceof Error ? error.message : String(error) })
      }
    }
    expect(failures).toEqual([])
  })

  it('keeps the weekly allowance an exact integer number of cents', () => {
    const snapshot = buildBudgetPlanner(state(), 'month', new Date(2026, 7, 16, 10, 0, 0))
    expect(Number.isSafeInteger(snapshot.allowedWeeklySpending)).toBe(true)
    expect(Number.isSafeInteger(snapshot.allowedDailySpending)).toBe(true)
  })

  it('reports a zeroed allowance for a fully elapsed period', () => {
    const snapshot = buildBudgetPlanner(state(), 'previousMonth', new Date(2026, 7, 16, 10, 0, 0))
    expect(snapshot.remainingDaysInPeriod).toBe(0)
    expect(snapshot.allowedWeeklySpending).toBe(0)
    expect(snapshot.allowedDailySpending).toBe(0)
  })
})
