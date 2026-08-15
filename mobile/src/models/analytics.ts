import type { DashboardAnalytics, DebtRecord, ExpenseRecord, FinanceState, Goal } from './types'
import { divideMoney, multiplyMoneyByBasisPoints } from './money'

function monthId(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function round2(value: number): number {
  return Math.round(value)
}

function roundMetric2(value: number): number {
  return Math.round(value * 100) / 100
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function parseRecordDate(value: string): Date {
  const [year, month, day] = value.split('-').map((part) => Number(part))
  return new Date(year, Math.max((month ?? 1) - 1, 0), day ?? 1)
}

function daysUntilMonthEnd(now = new Date()): number {
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  monthEnd.setHours(0, 0, 0, 0)
  const current = startOfDay(now)
  const diff = Math.ceil((monthEnd.getTime() - current.getTime()) / (1000 * 60 * 60 * 24))
  return Math.max(diff + 1, 1)
}

function differenceInCalendarDays(end: Date, start: Date): number {
  const millisecondsPerDay = 24 * 60 * 60 * 1000
  return Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / millisecondsPerDay)
}

function addMonths(value: Date, amount: number): Date {
  return new Date(value.getFullYear(), value.getMonth() + amount, value.getDate())
}

function addDays(value: Date, amount: number): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + amount)
}

function addFrequency(date: Date, frequency: DebtRecord['paymentFrequency'], count: number): Date {
  return frequency === 'weekly' ? addDays(date, count * 7) : addMonths(date, count)
}

function sumGoalRemaining(goals: Goal[]): number {
  return round2(
    goals.reduce((total, goal) => {
      return total + Math.max(goal.targetAmount - goal.currentAmount, 0)
    }, 0)
  )
}

function sumDebtBalance(debts: DebtRecord[], expenses: ExpenseRecord[]): { remaining: number; paidThisMonth: number } {
  const currentMonth = monthId()
  const paidMap = new Map<string, number>()
  const monthlyPaidMap = new Map<string, number>()

  expenses.forEach((expense) => {
    if (!expense.debtId) {
      return
    }
    paidMap.set(expense.debtId, (paidMap.get(expense.debtId) ?? 0) + expense.amount)
    if (expense.date.startsWith(currentMonth)) {
      monthlyPaidMap.set(expense.debtId, (monthlyPaidMap.get(expense.debtId) ?? 0) + expense.amount)
    }
  })

  return debts.reduce(
    (summary, debt) => {
      const paid = paidMap.get(debt.id) ?? 0
      const paidThisMonth = monthlyPaidMap.get(debt.id) ?? 0
      return {
        remaining: summary.remaining + Math.max(debt.totalAmount - paid, 0),
        paidThisMonth: summary.paidThisMonth + paidThisMonth
      }
    },
    { remaining: 0, paidThisMonth: 0 }
  )
}

function getGoalContributionProgress(goals: Goal[], expenses: ExpenseRecord[], currentMonth: string): Map<string, { monthlyRequired: number; contributedThisMonth: number }> {
  const currentMonthStart = parseRecordDate(`${currentMonth}-01`)
  const result = new Map<string, { monthlyRequired: number; contributedThisMonth: number }>()

  goals.forEach((goal) => {
    const contributedThisMonth = round2(
      expenses
        .filter((expense) => expense.goalId === goal.id && expense.allocationKind === 'goal-contribution' && expense.date.startsWith(currentMonth))
        .reduce((sum, expense) => sum + expense.amount, 0)
    )
    const remainingAmount = Math.max(goal.targetAmount - goal.currentAmount, 0)
    const targetDate = parseRecordDate(goal.targetDate)
    const monthsRemaining = remainingAmount <= 0 ? 0 : Math.max((targetDate.getFullYear() - currentMonthStart.getFullYear()) * 12 + (targetDate.getMonth() - currentMonthStart.getMonth()), 1)
    const monthlyRequired = remainingAmount <= 0 ? 0 : divideMoney(remainingAmount, monthsRemaining)
    result.set(goal.id, { monthlyRequired, contributedThisMonth })
  })

  return result
}

function getDebtInstallmentsDueThisMonth(state: FinanceState, currentMonth: string): number {
  const monthStart = parseRecordDate(`${currentMonth}-01`)
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0)

  return round2(
    state.debts.reduce((sum, debt) => {
      const paidBeforeMonth = state.expenses
        .filter((expense) => expense.debtId === debt.id && parseRecordDate(expense.date) < monthStart)
        .reduce((paid, expense) => paid + expense.amount, 0)
      const paidThisMonth = state.expenses
        .filter((expense) => expense.debtId === debt.id && expense.date.startsWith(currentMonth))
        .reduce((paid, expense) => paid + expense.amount, 0)

      let remainingTracker = Math.max(debt.totalAmount - paidBeforeMonth, 0)
      let scheduledDate = parseRecordDate(debt.startDate)
      let totalDueThisMonth = 0

      while (remainingTracker > 0 && scheduledDate <= monthEnd) {
        const dueAmount = round2(Math.min(Math.max(debt.installmentAmount, 0), remainingTracker))
        if (scheduledDate >= monthStart && dueAmount > 0) {
          totalDueThisMonth += dueAmount
        }
        remainingTracker = Math.max(remainingTracker - dueAmount, 0)
        scheduledDate = addFrequency(scheduledDate, debt.paymentFrequency, 1)
      }

      return sum + Math.max(round2(totalDueThisMonth) - round2(paidThisMonth), 0)
    }, 0)
  )
}

export function computeDashboardAnalytics(state: FinanceState): DashboardAnalytics {
  const now = new Date()
  const currentMonth = monthId(now)
  const monthStart = parseRecordDate(`${currentMonth}-01`)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const today = startOfDay(now)
  const effectiveToday = today < monthStart ? monthStart : today > monthEnd ? monthEnd : today
  const elapsedDays = Math.max(differenceInCalendarDays(effectiveToday, monthStart) + 1, 1)

  const incomes = state.incomes.filter((entry) => entry.date.startsWith(currentMonth))
  const expenses = state.expenses.filter((entry) => entry.date.startsWith(currentMonth))
  const totalIncome = round2(incomes.reduce((total, entry) => total + entry.amount, 0))
  const totalExpenses = round2(expenses.reduce((total, entry) => total + entry.amount, 0))
  const fixedMonthlyExpenses = round2(expenses.filter((entry) => entry.type === 'fixed').reduce((total, entry) => total + entry.amount, 0))
  const variableExpensesThisMonth = round2(expenses.filter((entry) => entry.type === 'variable').reduce((total, entry) => total + entry.amount, 0))
  const remainingBalance = round2(totalIncome - totalExpenses)
  const remainingDaysInMonth = daysUntilMonthEnd(now)
  const remainingWeeksInMonth = roundMetric2(Math.max(remainingDaysInMonth / 7, 1))
  const debtSummary = sumDebtBalance(state.debts, state.expenses)
  const debtBalance = round2(debtSummary.remaining)
  const monthlyDebtPayments = round2(debtSummary.paidThisMonth)
  const remainingGoalAmount = sumGoalRemaining(state.goals)

  const carryOverBalance =
    [...state.monthlySummaries]
      .filter((summary) => summary.month < currentMonth)
      .sort((left, right) => right.month.localeCompare(left.month))[0]?.closingBalance ?? 0
  const spentToDate = round2(
    expenses.filter((entry) => parseRecordDate(entry.date) <= effectiveToday).reduce((sum, entry) => sum + entry.amount, 0)
  )
  const currentRemainingBalance = round2(carryOverBalance + totalIncome - spentToDate)
  const fixedAndRecurringExpensesStillDueThisMonth = round2(
    expenses
      .filter((entry) => entry.type === 'fixed' && parseRecordDate(entry.date) > effectiveToday && !entry.debtId)
      .reduce((sum, entry) => sum + entry.amount, 0)
  )
  const debtInstallmentsDueThisMonth = getDebtInstallmentsDueThisMonth(state, currentMonth)
  const goalProgress = getGoalContributionProgress(state.goals, state.expenses, currentMonth)
  const recommendedGoalContributionsThisMonth = round2(
    [...goalProgress.values()].reduce((sum, goal) => sum + goal.monthlyRequired, 0)
  )
  const plannedGoalContributionsThisMonth = round2(
    state.settings.includeOptionalGoalsInForecast
      ? [...goalProgress.values()].reduce((sum, goal) => sum + Math.max(goal.monthlyRequired - goal.contributedThisMonth, 0), 0)
      : 0
  )
  const remainingUsableBalance = round2(
    currentRemainingBalance -
      fixedAndRecurringExpensesStillDueThisMonth -
      debtInstallmentsDueThisMonth -
      plannedGoalContributionsThisMonth
  )
  const safeDailySpending = divideMoney(remainingUsableBalance, Math.max(remainingDaysInMonth, 1))
  const safeWeeklySpending = divideMoney(remainingUsableBalance, Math.max(remainingWeeksInMonth, 1))
  const averageDailySpend = divideMoney(spentToDate, elapsedDays)

  let plannerStatus: DashboardAnalytics['smartPlanner']['status'] = 'comfortable'
  if (remainingUsableBalance < 0) {
    plannerStatus = 'not-enough'
  } else if (safeDailySpending <= 0 || safeDailySpending < multiplyMoneyByBasisPoints(averageDailySpend, 7_500)) {
    plannerStatus = 'risky'
  } else if (safeDailySpending < multiplyMoneyByBasisPoints(averageDailySpend, 10_500)) {
    plannerStatus = 'tight'
  }

  return {
    currentMonth,
    totalIncome,
    totalExpenses,
    remainingBalance,
    fixedMonthlyExpenses,
    variableExpensesThisMonth,
    remainingAfterFixedExpenses: round2(totalIncome - fixedMonthlyExpenses),
    remainingAfterFixedAndVariableExpenses: round2(totalIncome - fixedMonthlyExpenses - variableExpensesThisMonth),
    debtBalance,
    monthlyDebtPayments,
    remainingGoalAmount,
    remainingDaysInMonth,
    remainingWeeksInMonth,
    safeDailySpending: divideMoney(remainingBalance, remainingDaysInMonth),
    safeWeeklySpending: divideMoney(remainingBalance, remainingWeeksInMonth),
    smartPlanner: {
      currentRemainingBalance,
      remainingUsableBalance,
      safeDailySpending,
      safeWeeklySpending,
      safeMonthlyFlexibleSpending: remainingUsableBalance,
      remainingDaysInMonth,
      remainingWeeksInMonth,
      debtInstallmentsDueThisMonth,
      plannedGoalContributionsThisMonth,
      recommendedGoalContributionsThisMonth,
      fixedAndRecurringExpensesStillDueThisMonth,
      goalsIncludedInPlanner: state.settings.includeOptionalGoalsInForecast,
      shortfallAmount: round2(Math.max(-remainingUsableBalance, 0)),
      status: plannerStatus
    }
  }
}
