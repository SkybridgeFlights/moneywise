import type { DebtRecord, ExpenseRecord, FinanceState, Goal, IncomeRecord } from './types'

export type PlannerPeriodFilter = 'today' | 'week' | 'month' | 'year' | 'previousMonth' | 'previousYear' | 'nextMonth' | 'nextYear'

export interface BudgetPlannerSnapshot {
  openingAvailableBalance: number
  expectedIncome: number
  totalIncomeAvailable: number
  fixedExpenses: number
  debtInstallments: number
  recurringRequiredExpenses: number
  totalCommitments: number
  variableSpentToDate: number
  balanceAfterCommitments: number
  remainingFlexibleBalance: number
  allowedMonthlySpending: number
  allowedWeeklySpending: number
  allowedDailySpending: number
  plannedGoalContributions: number
  recommendedGoalContributions: number
  balanceAfterGoals: number
  allowedMonthlySpendingAfterGoals: number
  allowedWeeklySpendingAfterGoals: number
  allowedDailySpendingAfterGoals: number
  remainingDaysInPeriod: number
  remainingWeeksInPeriod: number
  goalsIncludedInPlanner: boolean
  goalsIncludedCount: number
  goalsExcludedCount: number
  excludedGoalsNote: boolean
  shortfallAmount: number
  status: 'comfortable' | 'tight' | 'risky' | 'not-enough'
  isPastPeriod: boolean
}

export interface DateInterval {
  start: Date
  end: Date
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function isValidDateValue(value: Date): boolean {
  return !Number.isNaN(value.getTime())
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function endOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999)
}

function startOfWeek(value: Date): Date {
  const day = value.getDay()
  const result = new Date(value)
  result.setDate(value.getDate() - day)
  return startOfDay(result)
}

function endOfWeek(value: Date): Date {
  const result = new Date(startOfWeek(value))
  result.setDate(result.getDate() + 6)
  return endOfDay(result)
}

function startOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1)
}

function endOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth() + 1, 0, 23, 59, 59, 999)
}

function startOfYear(value: Date): Date {
  return new Date(value.getFullYear(), 0, 1)
}

function endOfYear(value: Date): Date {
  return new Date(value.getFullYear(), 11, 31, 23, 59, 59, 999)
}

function addMonths(value: Date, amount: number): Date {
  return new Date(value.getFullYear(), value.getMonth() + amount, value.getDate())
}

function addYears(value: Date, amount: number): Date {
  return new Date(value.getFullYear() + amount, value.getMonth(), value.getDate())
}

function addDays(value: Date, amount: number): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + amount)
}

function differenceInCalendarDays(end: Date, start: Date): number {
  const millisecondsPerDay = 24 * 60 * 60 * 1000
  return Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / millisecondsPerDay)
}

function getDaysInMonth(value: Date): number {
  return Math.max(differenceInCalendarDays(endOfMonth(value), startOfMonth(value)) + 1, 1)
}

function getInclusiveMonthCount(start: Date, end: Date): number {
  const startIndex = start.getFullYear() * 12 + start.getMonth()
  const endIndex = end.getFullYear() * 12 + end.getMonth()
  return Math.max(endIndex - startIndex + 1, 1)
}

function parseRecordDate(value: string): Date {
  const [year, month, day] = value.split('-').map((part) => Number(part))
  return new Date(year, Math.max((month ?? 1) - 1, 0), day ?? 1)
}

function isWithinInterval(date: Date, interval: DateInterval): boolean {
  return date >= interval.start && date <= interval.end
}

function getBalanceBefore(state: FinanceState, cutoff: Date): number {
  const correction = state.settings.balanceCorrection
  if (correction) {
    const effectiveDate = new Date(correction.effectiveDate)
    if (isValidDateValue(effectiveDate) && effectiveDate < cutoff) {
      const incomeAfterCorrection = state.incomes
        .filter((entry) => {
          const date = parseRecordDate(entry.date)
          return date > effectiveDate && date < cutoff
        })
        .reduce((sum, entry) => sum + entry.amount, 0)
      const expensesAfterCorrection = state.expenses
        .filter((entry) => {
          const date = parseRecordDate(entry.date)
          return date > effectiveDate && date < cutoff
        })
        .reduce((sum, entry) => sum + entry.amount, 0)
      return round2(correction.correctedBalance + incomeAfterCorrection - expensesAfterCorrection)
    }
  }
  return round2(
    state.incomes.filter((entry) => parseRecordDate(entry.date) < cutoff).reduce((sum, entry) => sum + entry.amount, 0) -
      state.expenses.filter((entry) => parseRecordDate(entry.date) < cutoff).reduce((sum, entry) => sum + entry.amount, 0)
  )
}

export function getPlannerPeriodInterval(filter: PlannerPeriodFilter, referenceDate = new Date()): DateInterval {
  const today = startOfDay(referenceDate)
  switch (filter) {
    case 'today':
      return { start: today, end: endOfDay(today) }
    case 'week':
      return { start: startOfWeek(today), end: endOfWeek(today) }
    case 'previousMonth': {
      const previousMonth = addMonths(today, -1)
      return { start: startOfMonth(previousMonth), end: endOfMonth(previousMonth) }
    }
    case 'previousYear': {
      const previousYear = addYears(today, -1)
      return { start: startOfYear(previousYear), end: endOfYear(previousYear) }
    }
    case 'nextMonth': {
      const nextMonth = addMonths(today, 1)
      return { start: startOfMonth(nextMonth), end: endOfMonth(nextMonth) }
    }
    case 'nextYear': {
      const nextYear = addYears(today, 1)
      return { start: startOfYear(nextYear), end: endOfYear(nextYear) }
    }
    case 'month':
    default:
      return { start: startOfMonth(today), end: endOfMonth(today) }
    case 'year':
      return { start: startOfYear(today), end: endOfYear(today) }
  }
}

function getGoalContributionForPeriod(
  filter: PlannerPeriodFilter,
  interval: DateInterval,
  targetDate: Date,
  remainingAmount: number
): number {
  const targetMonth = startOfMonth(targetDate)
  const anchorMonth = startOfMonth(interval.start)
  if (targetMonth < anchorMonth || remainingAmount <= 0) {
    return 0
  }

  const monthlyContribution = remainingAmount / getInclusiveMonthCount(anchorMonth, targetMonth)

  if (filter === 'today') {
    return monthlyContribution / getDaysInMonth(interval.start)
  }

  if (filter === 'week') {
    return monthlyContribution / Math.max(getDaysInMonth(interval.start) / 7, 1)
  }

  if (filter === 'month' || filter === 'previousMonth' || filter === 'nextMonth') {
    return monthlyContribution
  }

  if (filter === 'year' || filter === 'previousYear' || filter === 'nextYear') {
    let coveredMonths = 0
    let cursor = startOfMonth(interval.start)
    while (cursor <= interval.end) {
      if (startOfMonth(cursor) <= targetMonth) {
        coveredMonths += 1
      }
      cursor = addMonths(cursor, 1)
    }
    return monthlyContribution * coveredMonths
  }

  return monthlyContribution
}

function projectedRecurringIncome(incomes: IncomeRecord[], interval: DateInterval): number {
  return round2(
    incomes
      .filter((entry) => entry.recurring)
      .reduce((sum, entry) => {
        const baseDate = parseRecordDate(entry.date)
        if (baseDate > interval.end) return sum
        let occurrence = new Date(
          interval.start.getFullYear(),
          interval.start.getMonth(),
          Math.min(baseDate.getDate(), new Date(interval.start.getFullYear(), interval.start.getMonth() + 1, 0).getDate())
        )
        while (occurrence < baseDate) {
          occurrence = addMonths(occurrence, 1)
        }
        while (occurrence <= interval.end) {
          const alreadyRecorded = incomes.some((income) => {
            const incomeDate = parseRecordDate(income.date)
            return (
              income.name === entry.name &&
              income.groupName === entry.groupName &&
              income.amount === entry.amount &&
              startOfDay(incomeDate).getTime() === startOfDay(occurrence).getTime()
            )
          })
          if (!alreadyRecorded && occurrence >= interval.start) {
            sum += entry.amount
          }
          occurrence = addMonths(occurrence, 1)
        }
        return sum
      }, 0)
  )
}

function projectedRecurringExpenses(
  expenses: ExpenseRecord[],
  interval: DateInterval,
  getCategoryType: (categoryId: string) => string | undefined
): { fixed: number; recurringRequired: number } {
  return expenses
    .filter((entry) => entry.recurring && !entry.debtId)
    .reduce(
      (totals, entry) => {
        const baseDate = parseRecordDate(entry.date)
        if (baseDate > interval.end) return totals
        let occurrence = new Date(
          interval.start.getFullYear(),
          interval.start.getMonth(),
          Math.min(baseDate.getDate(), new Date(interval.start.getFullYear(), interval.start.getMonth() + 1, 0).getDate())
        )
        while (occurrence < baseDate) {
          occurrence = addMonths(occurrence, 1)
        }
        while (occurrence <= interval.end) {
          const alreadyRecorded = expenses.some((expense) => {
            const expenseDate = parseRecordDate(expense.date)
            return (
              expense.title === entry.title &&
              expense.amount === entry.amount &&
              expense.categoryId === entry.categoryId &&
              startOfDay(expenseDate).getTime() === startOfDay(occurrence).getTime()
            )
          })
          if (!alreadyRecorded && occurrence >= interval.start) {
            const categoryType = getCategoryType(entry.categoryId)
            if (entry.type === 'fixed') {
              totals.fixed += entry.amount
            } else if (categoryType === 'essential') {
              totals.recurringRequired += entry.amount
            }
          }
          occurrence = addMonths(occurrence, 1)
        }
        return totals
      },
      { fixed: 0, recurringRequired: 0 }
    )
}

function debtInstallmentsForPeriod(
  debts: DebtRecord[],
  expenses: ExpenseRecord[],
  interval: DateInterval,
  effectiveDate: Date,
  isPastPeriod: boolean
): number {
  return round2(
    debts.reduce((sum, debt) => {
      if (isPastPeriod) {
        return (
          sum +
          expenses
            .filter((entry) => entry.debtId === debt.id && isWithinInterval(parseRecordDate(entry.date), interval))
            .reduce((paid, entry) => paid + entry.amount, 0)
        )
      }

      const paymentsBeforePeriod = expenses
        .filter((entry) => entry.debtId === debt.id && parseRecordDate(entry.date) < interval.start)
        .reduce((paid, entry) => paid + entry.amount, 0)
      const paidInPeriodToDate = expenses
        .filter((entry) => {
          const date = parseRecordDate(entry.date)
          return entry.debtId === debt.id && isWithinInterval(date, interval) && date <= effectiveDate
        })
        .reduce((paid, entry) => paid + entry.amount, 0)

      let remainingDebt = Math.max(debt.totalAmount - paymentsBeforePeriod, 0)
      let scheduledDate = parseRecordDate(debt.startDate)
      let dueInPeriod = 0

      while (remainingDebt > 0 && scheduledDate <= interval.end) {
        const installment = round2(Math.min(Math.max(debt.installmentAmount, 0), remainingDebt))
        if (scheduledDate >= interval.start && installment > 0) {
          dueInPeriod += installment
        }
        remainingDebt = Math.max(remainingDebt - installment, 0)
        scheduledDate = debt.paymentFrequency === 'weekly' ? addDays(scheduledDate, 7) : addMonths(scheduledDate, 1)
      }

      return sum + Math.max(round2(dueInPeriod) - round2(paidInPeriodToDate), 0)
    }, 0)
  )
}

export function buildBudgetPlanner(state: FinanceState, filter: PlannerPeriodFilter, referenceDate = new Date()): BudgetPlannerSnapshot {
  const interval = getPlannerPeriodInterval(filter, referenceDate)
  const today = startOfDay(referenceDate)
  const periodDays = Math.max(differenceInCalendarDays(interval.end, interval.start) + 1, 1)
  const isPastPeriod = interval.end < today
  const isFuturePeriod = interval.start > today
  const effectiveDate = isPastPeriod ? interval.end : isFuturePeriod ? addDays(interval.start, -1) : today
  const remainingDaysInPeriod = isPastPeriod ? 0 : isFuturePeriod ? periodDays : Math.max(differenceInCalendarDays(interval.end, today) + 1, 1)
  const remainingWeeksInPeriod = round2(remainingDaysInPeriod > 0 ? Math.max(remainingDaysInPeriod / 7, 1) : 0)

  const openingAvailableBalance = getBalanceBefore(state, interval.start)
  const actualIncome = round2(
    state.incomes
      .filter((entry) => isWithinInterval(parseRecordDate(entry.date), interval))
      .reduce((sum, entry) => sum + entry.amount, 0)
  )
  const expectedIncome = round2(actualIncome + projectedRecurringIncome(state.incomes, interval))
  const totalIncomeAvailable = round2(openingAvailableBalance + expectedIncome)

  const categoryById = new Map(state.categories.map((category) => [category.id, category]))
  const actualFixedExpenses = round2(
    state.expenses
      .filter((entry) => isWithinInterval(parseRecordDate(entry.date), interval) && entry.type === 'fixed' && !entry.debtId)
      .reduce((sum, entry) => sum + entry.amount, 0)
  )
  const actualRecurringRequiredExpenses = round2(
    state.expenses
      .filter((entry) => {
        const categoryType = categoryById.get(entry.categoryId)?.type
        return isWithinInterval(parseRecordDate(entry.date), interval) && entry.recurring && entry.type !== 'fixed' && categoryType === 'essential' && !entry.debtId
      })
      .reduce((sum, entry) => sum + entry.amount, 0)
  )
  const projectedExpenses = projectedRecurringExpenses(state.expenses, interval, (categoryId) => categoryById.get(categoryId)?.type)
  const fixedExpenses = round2(actualFixedExpenses + projectedExpenses.fixed)
  const recurringRequiredExpenses = round2(actualRecurringRequiredExpenses + projectedExpenses.recurringRequired)
  const debtInstallments = debtInstallmentsForPeriod(state.debts, state.expenses, interval, effectiveDate, isPastPeriod)
  const totalCommitments = round2(fixedExpenses + recurringRequiredExpenses + debtInstallments)
  const balanceAfterCommitments = round2(totalIncomeAvailable - totalCommitments)

  const variableSpentToDate = round2(
    state.expenses
      .filter((entry) => {
        const date = parseRecordDate(entry.date)
        return (
          isWithinInterval(date, interval) &&
          date <= effectiveDate &&
          entry.type === 'variable' &&
          entry.allocationKind !== 'goal-contribution' &&
          !entry.debtId
        )
      })
      .reduce((sum, entry) => sum + entry.amount, 0)
  )
  const allowedMonthlySpending = round2(balanceAfterCommitments - variableSpentToDate)
  const allowedWeeklySpending = remainingWeeksInPeriod > 0 ? round2(allowedMonthlySpending / remainingWeeksInPeriod) : 0
  const allowedDailySpending = remainingDaysInPeriod > 0 ? round2(allowedMonthlySpending / remainingDaysInPeriod) : 0

  const totalGoalContributed = new Map<string, number>()
  const periodGoalContributed = new Map<string, number>()
  state.expenses
    .filter((entry) => entry.goalId && entry.allocationKind === 'goal-contribution')
    .forEach((entry) => {
      totalGoalContributed.set(entry.goalId as string, (totalGoalContributed.get(entry.goalId as string) ?? 0) + entry.amount)
      const date = parseRecordDate(entry.date)
      if (isWithinInterval(date, interval) && date <= effectiveDate) {
        periodGoalContributed.set(entry.goalId as string, (periodGoalContributed.get(entry.goalId as string) ?? 0) + entry.amount)
      }
    })

  const recommendedGoalContributions = 0
  const plannedGoalContributions = 0
  const goalsIncludedCount = 0
  const goalsExcludedCount = 0

  const balanceAfterGoals = round2(allowedMonthlySpending)
  const allowedWeeklySpendingAfterGoals = allowedWeeklySpending
  const allowedDailySpendingAfterGoals = allowedDailySpending

  const averageDailyVariableSpend = round2(
    variableSpentToDate /
      Math.max(isFuturePeriod ? periodDays : Math.max(differenceInCalendarDays(effectiveDate, interval.start) + 1, 1), 1)
  )
  let status: BudgetPlannerSnapshot['status'] = 'comfortable'
  if (allowedMonthlySpending < 0) {
    status = 'not-enough'
  } else if (allowedDailySpending <= 0 || allowedDailySpending < averageDailyVariableSpend * 1.05) {
    status = 'tight'
  }

  return {
    openingAvailableBalance,
    expectedIncome,
    totalIncomeAvailable,
    fixedExpenses,
    debtInstallments,
    recurringRequiredExpenses,
    totalCommitments,
    variableSpentToDate,
    balanceAfterCommitments,
    remainingFlexibleBalance: allowedMonthlySpending,
    allowedMonthlySpending,
    allowedWeeklySpending,
    allowedDailySpending,
    plannedGoalContributions,
    recommendedGoalContributions,
    balanceAfterGoals,
    allowedMonthlySpendingAfterGoals: balanceAfterGoals,
    allowedWeeklySpendingAfterGoals,
    allowedDailySpendingAfterGoals,
    remainingDaysInPeriod,
    remainingWeeksInPeriod,
    goalsIncludedInPlanner: state.settings.includeOptionalGoalsInForecast,
    goalsIncludedCount,
    goalsExcludedCount,
    excludedGoalsNote: goalsExcludedCount > 0,
    shortfallAmount: round2(Math.max(-allowedMonthlySpending, 0)),
    status,
    isPastPeriod
  }
}
