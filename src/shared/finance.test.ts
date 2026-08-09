import { describe, expect, it } from 'vitest'
import { defaultCategories, defaultSettings, demoBudgetPlan, demoDebts, demoExpenses, demoGoals, demoIncomes } from './defaults'
import { calculateFinanceSnapshot } from './finance'

describe('calculateFinanceSnapshot', () => {
  const englishSettings = { ...defaultSettings, language: 'en' as const, locale: 'en-US', rtl: false }

  it('computes dashboard metrics for normal data', () => {
    const result = calculateFinanceSnapshot({
      incomes: demoIncomes,
      expenses: demoExpenses,
      categories: defaultCategories,
      goals: demoGoals,
      goalContributions: [],
      debts: demoDebts,
      budgetPlans: [demoBudgetPlan],
      settings: englishSettings
    })

    expect(result.analytics.dashboard.totalIncome).toBeGreaterThan(0)
    expect(result.analytics.dashboard.totalExpenses).toBeGreaterThan(0)
    expect(result.analytics.categoryBudgets.length).toBe(defaultCategories.length)
    expect(result.analytics.dashboard.budgetHealthScore).toBeGreaterThanOrEqual(15)
  })

  it('handles zero-income edge cases safely', () => {
    const result = calculateFinanceSnapshot({
      incomes: [],
      expenses: demoExpenses.slice(0, 3),
      categories: defaultCategories,
      goals: [],
      goalContributions: [],
      debts: [],
      budgetPlans: [demoBudgetPlan],
      settings: englishSettings
    })

    expect(result.analytics.dashboard.totalIncome).toBe(0)
    expect(result.analytics.dashboard.remainingBalance).toBeLessThan(0)
    expect(result.analytics.recommendations.some((entry) => entry.includes('Income is zero'))).toBe(true)
  })

  it('raises alerts for overspending scenarios', () => {
    const stressedExpenses = demoExpenses.map((entry) =>
      entry.categoryId === 'shopping' || entry.categoryId === 'entertainment'
        ? { ...entry, amount: entry.amount * 5 }
        : entry
    )

    const result = calculateFinanceSnapshot({
      incomes: demoIncomes,
      expenses: stressedExpenses,
      categories: defaultCategories,
      goals: demoGoals,
      goalContributions: [],
      debts: demoDebts,
      budgetPlans: [demoBudgetPlan],
      settings: englishSettings
    })

    expect(result.alerts.some((entry) => entry.severity === 'warning' || entry.severity === 'critical')).toBe(true)
  })

  it('counts any goal-linked expense as a contribution without relying on a saving category', () => {
    const linkedExpense = {
      ...demoExpenses[1],
      id: 'expense-linked-food',
      categoryId: 'food',
      goalId: 'goal-1',
      debtId: null,
      allocationKind: 'goal-contribution' as const,
      amount: 200
    }

    const result = calculateFinanceSnapshot({
      incomes: demoIncomes,
      expenses: [...demoExpenses, linkedExpense],
      categories: defaultCategories,
      goals: demoGoals,
      goalContributions: [],
      debts: demoDebts,
      budgetPlans: [demoBudgetPlan],
      settings: englishSettings
    })

    const goalInsight = result.analytics.goalInsights.find((entry) => entry.goalId === 'goal-1')
    expect(goalInsight?.currentAmount).toBeGreaterThan(demoGoals[0].currentAmount)
    expect(result.analytics.dashboard.savingsRate).toBeGreaterThan(0)
  })

  it('produces daily and weekly budgets from income, obligations, goals, and plans', () => {
    const result = calculateFinanceSnapshot({
      incomes: demoIncomes,
      expenses: demoExpenses,
      categories: defaultCategories,
      goals: demoGoals,
      goalContributions: [],
      debts: demoDebts,
      budgetPlans: [demoBudgetPlan],
      settings: englishSettings
    })

    expect(result.analytics.dashboard.safeDailySpending).toBeGreaterThanOrEqual(0)
    expect(result.analytics.dashboard.safeWeeklySpending).toBeGreaterThanOrEqual(result.analytics.dashboard.safeDailySpending)
    expect(result.analytics.dashboard.remainingDailySpending).toBeGreaterThanOrEqual(0)
    expect(result.analytics.dashboard.remainingWeeklySpending).toBeGreaterThanOrEqual(0)
  })

  it('treats active debts as month commitments even before a payment expense exists', () => {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const currentMonthId = `${year}-${month}`
    const currentMonthDate = `${currentMonthId}-10`

    const result = calculateFinanceSnapshot({
      incomes: [
        {
          id: 'income-salary',
          name: 'Salary',
          groupName: 'Primary',
          amount: 5000,
          date: `${currentMonthId}-01`,
          type: 'fixed',
          recurring: true,
          notes: ''
        }
      ],
      expenses: [
        {
          id: 'expense-rent',
          title: 'Rent',
          amount: 1200,
          date: `${currentMonthId}-02`,
          categoryId: 'housing',
          paymentMethod: 'bank',
          type: 'fixed',
          recurring: true,
          notes: '',
          tags: [],
          goalId: null,
          debtId: null,
          allocationKind: 'spend'
        }
      ],
      categories: defaultCategories,
      goals: [],
      goalContributions: [],
      debts: [
        {
          id: 'debt-architecture-test',
          name: 'Car loan',
          totalAmount: 12000,
          installmentAmount: 1000,
          startDate: currentMonthDate,
          endDate: null,
          desiredPayoffDate: null,
          paymentFrequency: 'monthly',
          recurringAutomatically: true,
          categoryId: 'debt',
          notes: ''
        }
      ],
      budgetPlans: [{ ...demoBudgetPlan, month: currentMonthId }],
      settings: englishSettings
    })

    const debtBudget = result.analytics.categoryBudgets.find((entry) => entry.categoryId === 'debt')

    expect(result.analytics.dashboard.debtRatio).toBeGreaterThan(0)
    expect(result.analytics.forecast.installmentsDueThisMonth).toBe(1000)
    expect(result.analytics.dashboard.unpaidFixedCommitments).toBeGreaterThanOrEqual(1000)
    expect(debtBudget?.recommended).toBeGreaterThanOrEqual(1000)
  })

  it('keeps optional goal contributions out of the forecast unless explicitly enabled', () => {
    const disabledResult = calculateFinanceSnapshot({
      incomes: demoIncomes,
      expenses: demoExpenses,
      categories: defaultCategories,
      goals: demoGoals,
      goalContributions: [],
      debts: demoDebts,
      budgetPlans: [demoBudgetPlan],
      settings: { ...englishSettings, includeOptionalGoalsInForecast: false }
    })

    const enabledResult = calculateFinanceSnapshot({
      incomes: demoIncomes,
      expenses: demoExpenses,
      categories: defaultCategories,
      goals: demoGoals,
      goalContributions: [],
      debts: demoDebts,
      budgetPlans: [demoBudgetPlan],
      settings: { ...englishSettings, includeOptionalGoalsInForecast: true }
    })

    expect(disabledResult.analytics.forecast.goalsIncludedInForecast).toBe(false)
    expect(disabledResult.analytics.forecast.optionalGoalContributionsThisMonth).toBe(0)
    expect(enabledResult.analytics.forecast.optionalGoalContributionsThisMonth).toBeGreaterThan(0)
    expect(disabledResult.analytics.forecast.balanceAfterCommitments).toBeGreaterThan(enabledResult.analytics.forecast.balanceAfterCommitments)
  })

  it('marks the month as insufficient only when the projected month-end balance turns negative', () => {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const currentMonthId = `${year}-${month}`

    const result = calculateFinanceSnapshot({
      incomes: [
        {
          id: 'income-tight',
          name: 'Salary',
          groupName: 'Primary',
          amount: 900,
          date: `${currentMonthId}-01`,
          type: 'fixed',
          recurring: false,
          notes: ''
        }
      ],
      expenses: [
        {
          id: 'expense-rent-heavy',
          title: 'Rent',
          amount: 800,
          date: `${currentMonthId}-02`,
          categoryId: 'housing',
          paymentMethod: 'bank',
          type: 'fixed',
          recurring: false,
          notes: '',
          tags: [],
          goalId: null,
          debtId: null,
          allocationKind: 'spend'
        },
        {
          id: 'expense-food-heavy',
          title: 'Food',
          amount: 200,
          date: `${currentMonthId}-03`,
          categoryId: 'food',
          paymentMethod: 'card',
          type: 'variable',
          recurring: false,
          notes: '',
          tags: [],
          goalId: null,
          debtId: null,
          allocationKind: 'spend'
        }
      ],
      categories: defaultCategories,
      goals: [],
      goalContributions: [],
      debts: [],
      budgetPlans: [{ ...demoBudgetPlan, month: currentMonthId }],
      settings: englishSettings
    })

    expect(result.analytics.forecast.projectedMonthEndBalance).toBeLessThan(0)
    expect(result.analytics.forecast.affordabilityStatus).toBe('insufficient')
    expect(result.analytics.forecast.willRunOutBeforeMonthEnd).toBe(true)
  })

  it('derives debt progress from a linked installment expense', () => {
    const paidDebtExpense = {
      ...demoExpenses[0],
      id: 'expense-debt-linked',
      title: 'Car loan payment',
      categoryId: 'debt',
      amount: 100,
      debtId: 'debt-1',
      goalId: null,
      allocationKind: 'spend' as const
    }

    const result = calculateFinanceSnapshot({
      incomes: demoIncomes,
      expenses: [paidDebtExpense],
      categories: defaultCategories,
      goals: [],
      goalContributions: [],
      debts: [
        {
          ...demoDebts[0],
          totalAmount: 500,
          installmentAmount: 100
        }
      ],
      budgetPlans: [demoBudgetPlan],
      settings: englishSettings
    })

    const debt = result.analytics.debtInsights.find((entry) => entry.debtId === 'debt-1')
    expect(debt?.paidSoFar).toBe(100)
    expect(debt?.remainingBalance).toBe(400)
    expect(debt?.installmentsRemaining).toBe(4)
  })

  it('calculates remaining after fixed and variable expense layers clearly', () => {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const currentMonthId = `${year}-${month}`

    const result = calculateFinanceSnapshot({
      incomes: [
        {
          id: 'income-example',
          name: 'Salary',
          groupName: 'Primary',
          amount: 2427,
          date: `${currentMonthId}-01`,
          type: 'fixed',
          recurring: false,
          notes: ''
        }
      ],
      expenses: [
        {
          id: 'expense-fixed-example',
          title: 'Fixed commitments',
          amount: 1772,
          date: `${currentMonthId}-02`,
          categoryId: 'housing',
          paymentMethod: 'bank',
          type: 'fixed',
          recurring: false,
          notes: '',
          tags: [],
          goalId: null,
          debtId: null,
          allocationKind: 'spend'
        },
        {
          id: 'expense-variable-example',
          title: 'Variable spend',
          amount: 200,
          date: `${currentMonthId}-03`,
          categoryId: 'food',
          paymentMethod: 'card',
          type: 'variable',
          recurring: false,
          notes: '',
          tags: [],
          goalId: null,
          debtId: null,
          allocationKind: 'spend'
        }
      ],
      categories: defaultCategories,
      goals: [],
      goalContributions: [],
      debts: [],
      budgetPlans: [{ ...demoBudgetPlan, month: currentMonthId }],
      settings: englishSettings
    })

    expect(result.analytics.dashboard.fixedMonthlyExpenses).toBe(1772)
    expect(result.analytics.dashboard.remainingAfterFixedExpenses).toBe(655)
    expect(result.analytics.dashboard.variableExpensesThisMonth).toBe(200)
    expect(result.analytics.dashboard.remainingAfterFixedAndVariableExpenses).toBe(455)
  })

  it('keeps the month-end status consistent with the projected balance sign', () => {
    const result = calculateFinanceSnapshot({
      incomes: demoIncomes,
      expenses: demoExpenses,
      categories: defaultCategories,
      goals: demoGoals,
      goalContributions: [],
      debts: demoDebts,
      budgetPlans: [demoBudgetPlan],
      settings: englishSettings
    })

    expect(result.analytics.forecast.willRunOutBeforeMonthEnd).toBe(result.analytics.forecast.projectedMonthEndBalance < 0)
    expect(result.analytics.forecast.affordabilityStatus === 'insufficient').toBe(result.analytics.forecast.projectedMonthEndBalance < 0)
  })

  it('builds a smart spending planner from remaining balance and unpaid commitments', () => {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const currentMonthId = `${year}-${month}`

    const result = calculateFinanceSnapshot({
      incomes: [
        {
          id: 'income-planner',
          name: 'Salary',
          groupName: 'Primary',
          amount: 1000,
          date: `${currentMonthId}-01`,
          type: 'fixed',
          recurring: false,
          notes: ''
        }
      ],
      expenses: [
        {
          id: 'expense-fixed-future',
          title: 'Rent due later',
          amount: 300,
          date: `${currentMonthId}-28`,
          categoryId: 'housing',
          paymentMethod: 'bank',
          type: 'fixed',
          recurring: false,
          notes: '',
          tags: [],
          goalId: null,
          debtId: null,
          allocationKind: 'spend'
        }
      ],
      categories: defaultCategories,
      goals: [
        {
          id: 'goal-planner',
          name: 'Emergency',
          type: 'general',
          targetAmount: 600,
          currentAmount: 0,
          targetDate: `${year + 1}-01-01`,
          priority: 'medium',
          notes: ''
        }
      ],
      goalContributions: [],
      debts: [
        {
          id: 'debt-planner',
          name: 'Phone',
          totalAmount: 1000,
          installmentAmount: 200,
          startDate: `${currentMonthId}-10`,
          endDate: null,
          desiredPayoffDate: null,
          paymentFrequency: 'monthly',
          recurringAutomatically: true,
          categoryId: 'debt',
          notes: ''
        }
      ],
      budgetPlans: [{ ...demoBudgetPlan, month: currentMonthId }],
      settings: { ...englishSettings, includeOptionalGoalsInForecast: true }
    })

    const planner = result.analytics.smartPlanner

    expect(planner.currentRemainingBalance).toBe(1000)
    expect(planner.debtInstallmentsDueThisMonth).toBe(200)
    expect(planner.fixedAndRecurringExpensesStillDueThisMonth).toBe(300)
    expect(planner.plannedGoalContributionsThisMonth).toBeGreaterThan(0)
    expect(planner.remainingUsableBalance).toBe(
      result.analytics.forecast.remainingBalance -
        result.analytics.forecast.unpaidFixedExpensesDueThisMonth -
        result.analytics.forecast.installmentsDueThisMonth -
        result.analytics.forecast.optionalGoalContributionsThisMonth
    )
    expect(planner.safeMonthlyFlexibleSpending).toBe(planner.remainingUsableBalance)
  })

  it('survives missing linked relationships without crashing calculations', () => {
    const result = calculateFinanceSnapshot({
      incomes: demoIncomes,
      expenses: [
        {
          ...demoExpenses[0],
          id: 'expense-orphan-links',
          categoryId: 'missing-category',
          goalId: 'missing-goal',
          debtId: 'missing-debt',
          allocationKind: 'goal-contribution'
        }
      ],
      categories: defaultCategories,
      goals: demoGoals,
      goalContributions: [],
      debts: demoDebts,
      budgetPlans: [demoBudgetPlan],
      settings: englishSettings
    })

    expect(result.analytics.dashboard.totalExpenses).toBeGreaterThan(0)
    expect(result.analytics.forecast.projectedMonthEndBalance).toBeTypeOf('number')
    expect(result.analytics.goalInsights.length).toBe(demoGoals.length)
    expect(result.analytics.debtInsights.length).toBe(demoDebts.length)
  })
})
