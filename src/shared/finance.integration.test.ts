import { describe, expect, it } from 'vitest'
import { defaultCategories, defaultSettings, demoBudgetPlan, demoDebts, demoExpenses, demoGoals, demoIncomes } from './defaults'
import { calculateFinanceSnapshot } from './finance'

describe('finance integration flow', () => {
  it('produces coherent analytics, summaries, and goal insights from a full snapshot', () => {
    const result = calculateFinanceSnapshot({
      incomes: demoIncomes,
      expenses: demoExpenses,
      categories: defaultCategories,
      goals: demoGoals,
      goalContributions: [],
      debts: demoDebts,
      budgetPlans: [demoBudgetPlan],
      settings: { ...defaultSettings, language: 'en', locale: 'en-US', rtl: false }
    })

    expect(result.monthlySummaries.length).toBeGreaterThan(0)
    expect(result.analytics.goalInsights.length).toBe(demoGoals.length)
    expect(result.analytics.forecast.projectedMonthEndSpend).toBeGreaterThan(0)
    expect(result.analytics.highestSpendingCategories.length).toBeGreaterThan(0)
    expect(result.analytics.dashboard.safeDailySpending).toBeGreaterThanOrEqual(0)
    expect(result.analytics.dashboard.remainingWeeklySpending).toBeGreaterThanOrEqual(0)
  })
})
