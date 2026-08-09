import { Suspense, lazy, startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { addDays, addMonths, addYears, differenceInCalendarDays, endOfDay, endOfMonth, endOfWeek, endOfYear, isWithinInterval, parseISO, startOfDay, startOfMonth, startOfWeek, startOfYear } from 'date-fns'
import {
  ArrowDownCircle,
  ArrowUpCircle,
  BriefcaseBusiness,
  CalendarRange,
  ChartNoAxesCombined,
  CircleHelp,
  Gauge,
  Goal,
  Landmark,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  TrendingDown,
  TrendingUp,
  Wallet
} from 'lucide-react'
import type { AppSnapshot, DeleteCategoryInput, SaveBudgetPlanInput, SaveCategoryInput, SaveDebtInput, SaveExpenseInput, SaveGoalContributionInput, SaveGoalInput, SaveIncomeInput, SyncStatusSnapshot } from '@shared/contracts'
import type { BudgetMethod, Category, CategoryDeletionImpact, Settings } from '@shared/types'
import {
  Badge,
  EmptyState,
  InputField,
  MetricLine,
  MetricTile,
  RiskChip,
  ScreenSkeleton,
  SectionCard,
  SelectField,
  TextAreaField,
  ToggleField
} from './components/ui'
import { currencyFormatter, parseDecimalInput, todayString } from './lib/format'
import {
  applyLanguageToSettings,
  currencyOptions,
  getUiText,
  iconOptions,
  translateBudgetMethod,
  translateCategoryName,
  translateCategoryType,
  translateExpenseAllocation,
  translateGoalType,
  translatePaymentMethod,
  translatePriority,
  translateRiskLevel,
  translateStatus
} from './lib/i18n'

const DashboardScreen = lazy(() => import('./screens/DashboardScreen'))
const ReportsScreen = lazy(() => import('./screens/ReportsScreen'))

type TabKey = 'dashboard' | 'income' | 'expenses' | 'budget' | 'reports' | 'goals' | 'debts' | 'settings'
type AsyncAction = () => Promise<AppSnapshot>
type ExpensePeriodFilter = 'today' | 'week' | 'month' | 'previousMonth' | 'previousYear' | 'nextMonth' | 'nextYear'
type BudgetPeriodFilter = ExpensePeriodFilter | 'year'
type BudgetPlannerView = {
  openingAvailableBalance: number
  expectedIncome: number
  totalIncomeAvailable: number
  fixedExpenses: number
  debtInstallments: number
  recurringRequiredExpenses: number
  totalCommitments: number
  variableSpentToDate: number
  flexibleSpent: number
  balanceAfterCommitments: number
  flexibleBalanceRemaining: number
  remainingFlexible: number
  availableToAllocate: number
  allowedMonthlySpending: number
  allowedWeeklySpending: number
  allowedDailySpending: number
  plannedGoalContributions: number
  recommendedGoalContributions: number
  balanceAfterGoals: number
  allowedMonthlySpendingAfterGoals: number
  allowedWeeklySpendingAfterGoals: number
  allowedDailySpendingAfterGoals: number
  budgetEngineReserveTotal: number
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

type ExpensePeriodSummaryView = {
  totalIncomeForPeriod: number
  totalExpensesForPeriod: number
  fixedExpensesForPeriod: number
  variableExpensesForPeriod: number
  commitmentsForPeriod: number
  netForPeriod: number
  transactionCount: number
  recurringCount: number
}

type BudgetCategoryComparisonView = {
  categoryId: string
  categoryName: string
  color: string
  allocationType: 'required' | 'flexible'
  recommended: number
  actual: number
  difference: number
  percentUsed: number
  status: 'paid' | 'remaining' | 'over' | 'healthy' | 'watch' | 'danger' | 'not-available'
}

type BudgetPageInsights = {
  summary: ExpensePeriodSummaryView
  budgetSummary: {
    periodStart: string
    periodEnd: string
    availableBalance: number
    expectedIncome: number
    totalAvailableIncome: number
    fixedExpenses: number
    debtInstallments: number
    requiredRecurringExpenses: number
    totalCommitments: number
    variableSpentSoFar: number
    flexibleSpent: number
    balanceAfterCommitments: number
    flexibleBalanceRemaining: number
    remainingFlexible: number
    budgetEngineReserve: number
    availableToAllocate: number
    allowedMonthlySpending: number
    allowedWeeklySpending: number
    allowedDailySpending: number
    remainingDaysInPeriod: number
    remainingWeeksInPeriod: number
    plannerStatus: 'comfortable' | 'tight' | 'risky' | 'not-enough'
    isPastPeriod: boolean
    status: 'healthy' | 'tight' | 'risky' | 'not-enough'
  }
  sustainability: {
    income: number
    commitments: number
    variableSpending: number
    remainingBalance: number
    status: 'healthy' | 'tight' | 'risky' | 'not-enough'
  }
  comparison: BudgetCategoryComparisonView[]
  comparisonSummary: {
    availableIncomeForPeriod: number
    requiredCommitments: number
    budgetEngineReserve: number
    availableToAllocate: number
    totalRecommended: number
    totalRequiredPlanned: number
    totalFlexibleRecommended: number
    totalActualSpending: number
    remainingDifference: number
    hasNoAvailableAmount: boolean
  }
  savingsAdvice: {
    conservativeAmount: number
    conservativeDaily: number
    conservativeWeekly: number
    strongAmount: number
    strongDaily: number
    strongWeekly: number
    categoriesToReduce: Array<{
      categoryId: string
      categoryName: string
      spent: number
      suggestedReduction: number
      color?: string
    }>
  }
}

const getExpensePeriodInterval = (filter: ExpensePeriodFilter, referenceDate = new Date()): { start: Date; end: Date } => {
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
  }
}

const getBudgetPeriodInterval = (filter: BudgetPeriodFilter, referenceDate = new Date()): { start: Date; end: Date } => {
  if (filter === 'year') {
    const today = startOfDay(referenceDate)
    return { start: startOfYear(today), end: endOfYear(today) }
  }

  return getExpensePeriodInterval(filter, referenceDate)
}

const getExpensePeriodDayCount = (filter: ExpensePeriodFilter): number => {
  if (filter === 'today') return 1
  if (filter === 'week') return 7
  if (filter === 'month') return Math.max(new Date().getDate(), 1)
  const interval = getExpensePeriodInterval(filter)
  return Math.max(differenceInCalendarDays(interval.end, interval.start) + 1, 1)
}

const round2 = (value: number): number => Math.round(value * 100) / 100

const getBalanceBefore = (snapshot: AppSnapshot, cutoff: Date): number => {
  const correction = snapshot.settings.balanceCorrection
  if (correction) {
    const effectiveDate = parseISO(correction.effectiveDate)
    if (isValidDateValue(effectiveDate) && effectiveDate < cutoff) {
      const incomeAfterCorrection = snapshot.incomes
        .filter((entry) => {
          const date = parseISO(entry.date)
          return date > effectiveDate && date < cutoff
        })
        .reduce((sum, entry) => sum + entry.amount, 0)
      const expensesAfterCorrection = snapshot.expenses
        .filter((entry) => {
          const date = parseISO(entry.date)
          return date > effectiveDate && date < cutoff
        })
        .reduce((sum, entry) => sum + entry.amount, 0)
      return round2(correction.correctedBalance + incomeAfterCorrection - expensesAfterCorrection)
    }
  }
  return round2(
    snapshot.incomes.filter((entry) => parseISO(entry.date) < cutoff).reduce((sum, entry) => sum + entry.amount, 0) -
      snapshot.expenses.filter((entry) => parseISO(entry.date) < cutoff).reduce((sum, entry) => sum + entry.amount, 0)
  )
}

const isValidDateValue = (value: Date): boolean => !Number.isNaN(value.getTime())

const getDaysInMonth = (value: Date): number => Math.max(differenceInCalendarDays(endOfMonth(value), startOfMonth(value)) + 1, 1)

const getInclusiveMonthCount = (start: Date, end: Date): number => {
  const startIndex = start.getFullYear() * 12 + start.getMonth()
  const endIndex = end.getFullYear() * 12 + end.getMonth()
  return Math.max(endIndex - startIndex + 1, 1)
}

const getGoalContributionForPeriod = (
  filter: BudgetPeriodFilter,
  interval: { start: Date; end: Date },
  targetDate: Date,
  remainingAmount: number
): number => {
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

const getBudgetEngineReserveForPeriod = (
  budgetPlan: AppSnapshot['budgetPlans'][number] | undefined,
  filter: BudgetPeriodFilter,
  interval: { start: Date; end: Date }
): number => {
  if (!budgetPlan) return 0

  const monthlyBase = round2(
    Math.max(budgetPlan.customSavingsTarget, 0) +
      Math.max(budgetPlan.customEmergencyTarget, 0) +
      Math.max(budgetPlan.debtAcceleration, 0)
  )

  if (monthlyBase <= 0) return 0

  const monthDays = getDaysInMonth(interval.start)
  if (filter === 'today') {
    return round2(monthlyBase / monthDays)
  }

  if (filter === 'week') {
    return round2(monthlyBase * (Math.max(differenceInCalendarDays(interval.end, interval.start) + 1, 1) / monthDays))
  }

  if (filter === 'year' || filter === 'previousYear' || filter === 'nextYear') {
    return round2(monthlyBase * 12)
  }

  return monthlyBase
}

const getBudgetPlannerStateForInterval = (
  snapshot: AppSnapshot,
  filter: BudgetPeriodFilter,
  budgetPlan?: AppSnapshot['budgetPlans'][number],
  referenceDate = new Date()
): BudgetPlannerView => {
  const interval = getBudgetPeriodInterval(filter, referenceDate)
  const today = startOfDay(referenceDate)
  const periodDays = Math.max(differenceInCalendarDays(interval.end, interval.start) + 1, 1)
  const isPastPeriod = interval.end < today
  const isFuturePeriod = interval.start > today
  const effectiveDate = isPastPeriod ? interval.end : isFuturePeriod ? addDays(interval.start, -1) : today
  const remainingDaysInPeriod = isPastPeriod ? 0 : isFuturePeriod ? periodDays : Math.max(differenceInCalendarDays(interval.end, today) + 1, 1)
  const remainingWeeksInPeriod = round2(remainingDaysInPeriod > 0 ? Math.max(remainingDaysInPeriod / 7, 1) : 0)

  const openingAvailableBalance = getBalanceBefore(snapshot, interval.start)

  const actualIncome = round2(
    snapshot.incomes
      .filter((entry) => isWithinInterval(parseISO(entry.date), interval))
      .reduce((sum, entry) => sum + entry.amount, 0)
  )
  const projectedRecurringIncome = round2(
    snapshot.incomes
      .filter((entry) => entry.recurring)
      .reduce((sum, entry) => {
        const baseDate = parseISO(entry.date)
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
          const alreadyRecorded = snapshot.incomes.some((income) => {
            const incomeDate = parseISO(income.date)
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
  const expectedIncome = round2(actualIncome + projectedRecurringIncome)
  const totalIncomeAvailable = round2(openingAvailableBalance + expectedIncome)

  const categoryById = new Map(snapshot.categories.map((category) => [category.id, category]))
  const actualFixedExpenses = round2(
    snapshot.expenses
      .filter((entry) => {
        const date = parseISO(entry.date)
        return isWithinInterval(date, interval) && entry.type === 'fixed' && !entry.debtId
      })
      .reduce((sum, entry) => sum + entry.amount, 0)
  )
  const actualRecurringRequiredExpenses = round2(
    snapshot.expenses
      .filter((entry) => {
        const date = parseISO(entry.date)
        const categoryType = categoryById.get(entry.categoryId)?.type
        return isWithinInterval(date, interval) && entry.recurring && entry.type !== 'fixed' && categoryType === 'essential' && !entry.debtId
      })
      .reduce((sum, entry) => sum + entry.amount, 0)
  )
  const projectedRecurringExpenses = snapshot.expenses
    .filter((entry) => entry.recurring && !entry.debtId)
    .reduce(
      (totals, entry) => {
        const baseDate = parseISO(entry.date)
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
          const alreadyRecorded = snapshot.expenses.some((expense) => {
            const expenseDate = parseISO(expense.date)
            return (
              expense.title === entry.title &&
              expense.amount === entry.amount &&
              expense.categoryId === entry.categoryId &&
              startOfDay(expenseDate).getTime() === startOfDay(occurrence).getTime()
            )
          })
          if (!alreadyRecorded && occurrence >= interval.start) {
            const categoryType = categoryById.get(entry.categoryId)?.type
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
  const fixedExpenses = round2(actualFixedExpenses + projectedRecurringExpenses.fixed)
  const recurringRequiredExpenses = round2(actualRecurringRequiredExpenses + projectedRecurringExpenses.recurringRequired)

  const debtInstallments = round2(
    snapshot.debts.reduce((sum, debt) => {
      if (isPastPeriod) {
        return (
          sum +
          snapshot.expenses
            .filter((entry) => entry.debtId === debt.id && isWithinInterval(parseISO(entry.date), interval))
            .reduce((paid, entry) => paid + entry.amount, 0)
        )
      }

      const paymentsBeforePeriod = snapshot.expenses
        .filter((entry) => entry.debtId === debt.id && parseISO(entry.date) < interval.start)
        .reduce((paid, entry) => paid + entry.amount, 0)
      const paidInSelectedPeriodToDate = snapshot.expenses
        .filter((entry) => {
          const date = parseISO(entry.date)
          return entry.debtId === debt.id && isWithinInterval(date, interval) && date <= effectiveDate
        })
        .reduce((paid, entry) => paid + entry.amount, 0)

      let remainingDebt = Math.max(debt.totalAmount - paymentsBeforePeriod, 0)
      let scheduledDate = parseISO(debt.startDate)
      let dueInPeriod = 0

      while (remainingDebt > 0 && scheduledDate <= interval.end) {
        const installment = round2(Math.min(Math.max(debt.installmentAmount, 0), remainingDebt))
        if (scheduledDate >= interval.start && installment > 0) {
          dueInPeriod += installment
        }
        remainingDebt = Math.max(remainingDebt - installment, 0)
        scheduledDate = debt.paymentFrequency === 'weekly' ? addDays(scheduledDate, 7) : addMonths(scheduledDate, 1)
      }

      return sum + Math.max(round2(dueInPeriod) - round2(paidInSelectedPeriodToDate), 0)
    }, 0)
  )

  const totalGoalContributedToDate = new Map<string, number>()
  snapshot.expenses
    .filter((entry) => entry.goalId && entry.allocationKind === 'goal-contribution')
    .forEach((entry) => {
      totalGoalContributedToDate.set(entry.goalId as string, (totalGoalContributedToDate.get(entry.goalId as string) ?? 0) + entry.amount)
    })
  snapshot.goalContributions.forEach((entry) => {
    totalGoalContributedToDate.set(entry.goalId, (totalGoalContributedToDate.get(entry.goalId) ?? 0) + entry.amount)
  })

  const periodGoalContributedToDate = new Map<string, number>()
  snapshot.expenses
    .filter((entry) => {
      const date = parseISO(entry.date)
      return entry.goalId && entry.allocationKind === 'goal-contribution' && isWithinInterval(date, interval) && date <= effectiveDate
    })
    .forEach((entry) => {
      periodGoalContributedToDate.set(entry.goalId as string, (periodGoalContributedToDate.get(entry.goalId as string) ?? 0) + entry.amount)
    })
  snapshot.goalContributions
    .filter((entry) => {
      const date = parseISO(entry.date)
      return isWithinInterval(date, interval) && date <= effectiveDate
    })
    .forEach((entry) => {
      periodGoalContributedToDate.set(entry.goalId, (periodGoalContributedToDate.get(entry.goalId) ?? 0) + entry.amount)
    })

  let recommendedGoalContributionsRaw = 0
  let plannedGoalContributionsRaw = 0
  let goalsIncludedCount = 0
  let goalsExcludedCount = 0

  snapshot.goals.forEach((goal) => {
    const saved = goal.currentAmount + (totalGoalContributedToDate.get(goal.id) ?? 0)
    const remainingAmount = Math.max(goal.targetAmount - saved, 0)
    if (remainingAmount <= 0) {
      return
    }

    const targetDate = parseISO(goal.targetDate)
    if (!isValidDateValue(targetDate)) {
      goalsExcludedCount += 1
      return
    }

    const recommendedForPeriod = round2(getGoalContributionForPeriod(filter, interval, targetDate, remainingAmount))
    if (recommendedForPeriod <= 0 && !isPastPeriod) {
      goalsExcludedCount += 1
      return
    }

    goalsIncludedCount += 1
    recommendedGoalContributionsRaw += recommendedForPeriod

    if (snapshot.settings.includeOptionalGoalsInForecast) {
      plannedGoalContributionsRaw += isPastPeriod ? periodGoalContributedToDate.get(goal.id) ?? 0 : recommendedForPeriod
    }
  })

  const recommendedGoalContributions = round2(recommendedGoalContributionsRaw)
  const plannedGoalContributions = round2(plannedGoalContributionsRaw)

  const totalCommitments = round2(fixedExpenses + debtInstallments + recurringRequiredExpenses)
  const balanceAfterCommitments = round2(totalIncomeAvailable - totalCommitments)
  const budgetEngineReserveTotal = 0
  const variableSpentToDate = round2(
    snapshot.expenses
      .filter((entry) => {
        const date = parseISO(entry.date)
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
  console.info('RECALCULATING WITH VALUES:', {
    filter,
    totalIncomeAvailable,
    totalCommitments,
    availableToAllocate: Math.max(balanceAfterCommitments, 0)
  })
  const availableToAllocate = round2(Math.max(balanceAfterCommitments, 0))
  const flexibleBalanceRemaining = round2(availableToAllocate - variableSpentToDate)
  const allowedMonthlySpending = round2(flexibleBalanceRemaining - budgetEngineReserveTotal)
  const allowedDailySpending = remainingDaysInPeriod > 0 ? round2(allowedMonthlySpending / remainingDaysInPeriod) : 0
  const allowedWeeklySpending = remainingWeeksInPeriod > 0 ? round2(allowedMonthlySpending / remainingWeeksInPeriod) : 0
  const balanceAfterGoals = round2(allowedMonthlySpending)
  const allowedDailySpendingAfterGoals = allowedDailySpending
  const allowedWeeklySpendingAfterGoals = allowedWeeklySpending

  const averageDailyVariableSpend = round2(
    variableSpentToDate /
      Math.max(
        isFuturePeriod ? periodDays : Math.max(differenceInCalendarDays(effectiveDate, interval.start) + 1, 1),
        1
      )
  )
  let status: BudgetPlannerView['status'] = 'comfortable'
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
    flexibleSpent: variableSpentToDate,
    balanceAfterCommitments,
    flexibleBalanceRemaining,
    remainingFlexible: flexibleBalanceRemaining,
    availableToAllocate,
    allowedMonthlySpending,
    allowedWeeklySpending,
    allowedDailySpending,
    plannedGoalContributions,
    recommendedGoalContributions,
    balanceAfterGoals,
    allowedMonthlySpendingAfterGoals: balanceAfterGoals,
    allowedWeeklySpendingAfterGoals,
    allowedDailySpendingAfterGoals,
    budgetEngineReserveTotal,
    remainingDaysInPeriod,
    remainingWeeksInPeriod,
    goalsIncludedInPlanner: snapshot.settings.includeOptionalGoalsInForecast,
    goalsIncludedCount,
    goalsExcludedCount,
    excludedGoalsNote: goalsExcludedCount > 0,
    shortfallAmount: round2(Math.max(-allowedMonthlySpending, 0)),
    status,
    isPastPeriod
  }
}

const getExpensePeriodSummary = (
  snapshot: AppSnapshot,
  filter: ExpensePeriodFilter | BudgetPeriodFilter,
  budgetPlan?: AppSnapshot['budgetPlans'][number],
  referenceDate = new Date()
): ExpensePeriodSummaryView => {
  const interval = filter === 'year' ? getBudgetPeriodInterval(filter, referenceDate) : getExpensePeriodInterval(filter, referenceDate)
  const planner = getBudgetPlannerStateForInterval(snapshot, filter === 'year' ? filter : filter, budgetPlan, referenceDate)
  const periodExpenses = snapshot.expenses.filter((entry) => isWithinInterval(parseISO(entry.date), interval))

  const actualIncome = round2(
    snapshot.incomes
      .filter((entry) => isWithinInterval(parseISO(entry.date), interval))
      .reduce((sum, entry) => sum + entry.amount, 0)
  )
  const projectedRecurringIncome = round2(
    snapshot.incomes
      .filter((entry) => entry.recurring)
      .reduce((sum, entry) => {
        const baseDate = parseISO(entry.date)
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
          const alreadyRecorded = snapshot.incomes.some((income) => {
            const incomeDate = parseISO(income.date)
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
  const totalIncomeForPeriod = round2(actualIncome + projectedRecurringIncome)
  const totalExpensesForPeriod = round2(
    periodExpenses.reduce((sum, entry) => sum + entry.amount, 0)
  )
  const fixedExpensesForPeriod = round2(
    periodExpenses
      .filter((entry) => entry.type === 'fixed')
      .reduce((sum, entry) => sum + entry.amount, 0)
  )
  const variableExpensesForPeriod = round2(
    periodExpenses
      .filter((entry) => entry.type === 'variable')
      .reduce((sum, entry) => sum + entry.amount, 0)
  )

  return {
    totalIncomeForPeriod,
    totalExpensesForPeriod,
    fixedExpensesForPeriod,
    variableExpensesForPeriod,
    commitmentsForPeriod: planner.totalCommitments,
    netForPeriod: round2(totalIncomeForPeriod - totalExpensesForPeriod),
    transactionCount: periodExpenses.length,
    recurringCount: periodExpenses.filter((entry) => entry.recurring).length
  }
}

const getBudgetPageInsights = (
  snapshot: AppSnapshot,
  budgetPlan: AppSnapshot['budgetPlans'][number] | undefined,
  filter: BudgetPeriodFilter,
  referenceDate = new Date()
): BudgetPageInsights => {
  const interval = getBudgetPeriodInterval(filter, referenceDate)
  const planner = getBudgetPlannerStateForInterval(snapshot, filter, budgetPlan, referenceDate)
  const summary = getExpensePeriodSummary(snapshot, filter, budgetPlan, referenceDate)
  const periodDays = Math.max(differenceInCalendarDays(interval.end, interval.start) + 1, 1)
  const periodWeeks = Math.max(periodDays / 7, 1)
  const categoryById = new Map(snapshot.categories.map((category) => [category.id, category]))
  const actualByCategory = new Map<string, number>()
  const requiredByCategory = new Map<string, number>()

  snapshot.expenses
    .filter((entry) => isWithinInterval(parseISO(entry.date), interval))
    .forEach((entry) => {
      actualByCategory.set(entry.categoryId, (actualByCategory.get(entry.categoryId) ?? 0) + entry.amount)
      const categoryType = categoryById.get(entry.categoryId)?.type
      if (entry.type === 'fixed' || (entry.recurring && categoryType === 'essential' && !entry.debtId)) {
        requiredByCategory.set(entry.categoryId, round2((requiredByCategory.get(entry.categoryId) ?? 0) + entry.amount))
      }
    })

  snapshot.expenses
    .filter((entry) => entry.recurring && !entry.debtId)
    .forEach((entry) => {
      const baseDate = parseISO(entry.date)
      if (baseDate > interval.end) return
      let occurrence = new Date(
        interval.start.getFullYear(),
        interval.start.getMonth(),
        Math.min(baseDate.getDate(), new Date(interval.start.getFullYear(), interval.start.getMonth() + 1, 0).getDate())
      )
      while (occurrence < baseDate) {
        occurrence = addMonths(occurrence, 1)
      }
      while (occurrence <= interval.end) {
        const alreadyRecorded = snapshot.expenses.some((expense) => {
          const expenseDate = parseISO(expense.date)
          return (
            expense.title === entry.title &&
            expense.amount === entry.amount &&
            expense.categoryId === entry.categoryId &&
            startOfDay(expenseDate).getTime() === startOfDay(occurrence).getTime()
          )
        })
        if (!alreadyRecorded && occurrence >= interval.start) {
          const categoryType = categoryById.get(entry.categoryId)?.type
          if (entry.type === 'fixed' || categoryType === 'essential') {
            requiredByCategory.set(entry.categoryId, round2((requiredByCategory.get(entry.categoryId) ?? 0) + entry.amount))
          }
        }
        occurrence = addMonths(occurrence, 1)
      }
    })

  const percentagesByType: Record<BudgetMethod, Record<Category['type'], number>> = {
    'fifty-thirty-twenty': { essential: 50, lifestyle: 30, saving: 15, debt: 5, custom: 5 },
    'zero-based': { essential: 52, lifestyle: 18, saving: 18, debt: 12, custom: 5 },
    'custom-percentage': { essential: 45, lifestyle: 20, saving: 20, debt: 10, custom: 5 },
    'priority-based': { essential: 48, lifestyle: 17, saving: 20, debt: 15, custom: 5 },
    'goal-first': { essential: 45, lifestyle: 15, saving: 25, debt: 15, custom: 5 },
    'debt-focused': { essential: 44, lifestyle: 12, saving: 14, debt: 25, custom: 5 }
  }

  const method = budgetPlan?.method ?? snapshot.settings.defaultBudgetMethod
  const availableForCategoryBudget = round2(
    Math.max(planner.availableToAllocate, 0)
  )
  const typeBudgets = percentagesByType[method]
  snapshot.debts.forEach((debt) => {
    const categoryId = debt.categoryId
    if (!categoryId) return
    const debtExpensesBeforePeriod = snapshot.expenses
      .filter((entry) => entry.debtId === debt.id && parseISO(entry.date) < interval.start)
      .reduce((sum, entry) => sum + entry.amount, 0)
    let remainingDebt = Math.max(debt.totalAmount - debtExpensesBeforePeriod, 0)
    let scheduledDate = parseISO(debt.startDate)
    let dueInPeriod = 0
    while (remainingDebt > 0 && scheduledDate <= interval.end) {
      const installment = round2(Math.min(Math.max(debt.installmentAmount, 0), remainingDebt))
      if (scheduledDate >= interval.start && installment > 0) {
        dueInPeriod += installment
      }
      remainingDebt = Math.max(remainingDebt - installment, 0)
      scheduledDate = debt.paymentFrequency === 'weekly' ? addDays(scheduledDate, 7) : addMonths(scheduledDate, 1)
    }
    const requiredDebtAmount = planner.isPastPeriod
      ? round2(dueInPeriod)
      : round2(dueInPeriod)

    if (requiredDebtAmount > 0) {
      requiredByCategory.set(categoryId, round2((requiredByCategory.get(categoryId) ?? 0) + requiredDebtAmount))
    }
  })

  const committedCategoryIds = new Set([...requiredByCategory.keys()])

  const eligibleCategories = snapshot.categories.filter((category) => {
    if (category.type === 'debt' || category.type === 'saving') return false
    if (committedCategoryIds.has(category.id)) return false
    return true
  })

  const weightByCategory = new Map<string, number>()
  eligibleCategories.forEach((category) => {
    const actual = round2(actualByCategory.get(category.id) ?? 0)
    const rule = budgetPlan?.rules.find((entry) => entry.categoryId === category.id)
    let weight = 0

    if (budgetPlan && method === 'custom-percentage' && (rule?.percentage ?? 0) > 0) {
      weight = rule?.percentage ?? 0
    } else if (budgetPlan && method === 'priority-based' && (rule?.priorityWeight ?? 0) > 0) {
      weight = rule?.priorityWeight ?? 0
    } else if (actual > 0) {
      weight = actual
    } else {
      weight = typeBudgets[category.type] ?? 1
    }

    weightByCategory.set(category.id, Math.max(weight, 0.01))
  })
  const totalEligibleWeights = Math.max([...weightByCategory.values()].reduce((sum, value) => sum + value, 0), 1)

  const recommendedFlexibleByCategory = new Map<string, number>()
  if (availableForCategoryBudget > 0 && eligibleCategories.length > 0) {
    let remainingPool = availableForCategoryBudget
    let remainingWeight = totalEligibleWeights
    eligibleCategories.forEach((category, index) => {
      const weight = weightByCategory.get(category.id) ?? 0
      const isLast = index === eligibleCategories.length - 1
      const allocation = isLast
        ? round2(Math.max(remainingPool, 0))
        : round2(Math.max((remainingPool * weight) / Math.max(remainingWeight, 0.01), 0))
      const safeAllocation = round2(Math.min(allocation, remainingPool))
      recommendedFlexibleByCategory.set(category.id, safeAllocation)
      remainingPool = round2(Math.max(remainingPool - safeAllocation, 0))
      remainingWeight = Math.max(remainingWeight - weight, 0.01)
    })
  }

  const comparison = snapshot.categories.map((category) => {
    const actual = round2(actualByCategory.get(category.id) ?? 0)
    const requiredAmount = round2(requiredByCategory.get(category.id) ?? 0)
    const isRequired = requiredAmount > 0 || category.type === 'debt'
    const allocationType: BudgetCategoryComparisonView['allocationType'] = isRequired ? 'required' : 'flexible'
    const finalRecommended = round2(
      isRequired ? requiredAmount : recommendedFlexibleByCategory.get(category.id) ?? 0
    )
    const percentUsed = finalRecommended <= 0 ? 0 : round2((actual / finalRecommended) * 100)
    const status: BudgetCategoryComparisonView['status'] = isRequired
      ? actual > finalRecommended
        ? 'over'
        : actual < finalRecommended
          ? 'remaining'
          : 'paid'
      : availableForCategoryBudget <= 0
        ? 'not-available'
        : percentUsed > 110
          ? 'danger'
          : percentUsed > 90
            ? 'watch'
            : 'healthy'

    return {
      categoryId: category.id,
      categoryName: translateCategoryName(category, snapshot.settings.language),
      color: category.color,
      allocationType,
      recommended: finalRecommended,
      actual,
      difference: round2(finalRecommended - actual),
      percentUsed,
      status
    }
  }).sort((left, right) => {
    if (left.allocationType !== right.allocationType) {
      return left.allocationType === 'required' ? -1 : 1
    }
    return right.recommended - left.recommended
  })
  const totalRecommended = round2(comparison.reduce((sum, item) => sum + item.recommended, 0))
  const totalRequiredPlanned = round2(comparison.filter((item) => item.allocationType === 'required').reduce((sum, item) => sum + item.recommended, 0))
  const totalFlexibleRecommended = round2(comparison.filter((item) => item.allocationType === 'flexible').reduce((sum, item) => sum + item.recommended, 0))
  const totalActualSpending = round2(comparison.reduce((sum, item) => sum + item.actual, 0))

  const savingsBase = Math.max(planner.flexibleBalanceRemaining, 0)
  const adviceDays = Math.max(planner.remainingDaysInPeriod || periodDays, 1)
  const adviceWeeks = Math.max(planner.remainingWeeksInPeriod || periodWeeks, 1)
  const nonEssentialCategories = comparison
    .filter((item) => {
      const categoryType = categoryById.get(item.categoryId)?.type
      return categoryType === 'lifestyle' || categoryType === 'custom'
    })
    .filter((item) => item.actual > 0)
    .sort((left, right) => right.actual - left.actual)
    .slice(0, 3)
    .map((item) => ({
      categoryId: item.categoryId,
      categoryName: item.categoryName,
      spent: item.actual,
      suggestedReduction: round2(item.actual * 0.1),
      color: item.color
    }))

  const sustainabilityStatus: BudgetPageInsights['sustainability']['status'] =
    planner.allowedMonthlySpending < 0
      ? 'not-enough'
      : planner.status === 'comfortable'
        ? 'healthy'
        : planner.status === 'tight'
          ? 'tight'
          : 'risky'

  return {
    summary: {
      ...summary,
      totalIncomeForPeriod: planner.totalIncomeAvailable
    },
    budgetSummary: {
      periodStart: interval.start.toISOString(),
      periodEnd: interval.end.toISOString(),
      availableBalance: planner.openingAvailableBalance,
      expectedIncome: planner.expectedIncome,
      totalAvailableIncome: planner.totalIncomeAvailable,
      fixedExpenses: planner.fixedExpenses,
      debtInstallments: planner.debtInstallments,
      requiredRecurringExpenses: planner.recurringRequiredExpenses,
      totalCommitments: planner.totalCommitments,
      variableSpentSoFar: planner.variableSpentToDate,
      flexibleSpent: planner.flexibleSpent,
      balanceAfterCommitments: planner.balanceAfterCommitments,
      flexibleBalanceRemaining: planner.flexibleBalanceRemaining,
      remainingFlexible: planner.remainingFlexible,
      budgetEngineReserve: planner.budgetEngineReserveTotal,
      availableToAllocate: planner.availableToAllocate,
      allowedMonthlySpending: planner.allowedMonthlySpending,
      allowedWeeklySpending: planner.allowedWeeklySpending,
      allowedDailySpending: planner.allowedDailySpending,
      remainingDaysInPeriod: planner.remainingDaysInPeriod,
      remainingWeeksInPeriod: planner.remainingWeeksInPeriod,
      plannerStatus: planner.status,
      isPastPeriod: planner.isPastPeriod,
      status: sustainabilityStatus
    },
    sustainability: {
      income: planner.totalIncomeAvailable,
      commitments: planner.totalCommitments,
      variableSpending: planner.variableSpentToDate,
      remainingBalance: planner.flexibleBalanceRemaining,
      status: sustainabilityStatus
    },
    comparison,
    comparisonSummary: {
      availableIncomeForPeriod: planner.totalIncomeAvailable,
      requiredCommitments: planner.totalCommitments,
      budgetEngineReserve: planner.budgetEngineReserveTotal,
      availableToAllocate: availableForCategoryBudget,
      totalRecommended,
      totalRequiredPlanned,
      totalFlexibleRecommended,
      totalActualSpending,
      remainingDifference: round2(availableForCategoryBudget - totalFlexibleRecommended),
      hasNoAvailableAmount: availableForCategoryBudget <= 0
    },
    savingsAdvice: {
      conservativeAmount: round2(savingsBase * 0.1),
      conservativeDaily: round2((savingsBase * 0.1) / adviceDays),
      conservativeWeekly: round2((savingsBase * 0.1) / adviceWeeks),
      strongAmount: round2(savingsBase * 0.2),
      strongDaily: round2((savingsBase * 0.2) / adviceDays),
      strongWeekly: round2((savingsBase * 0.2) / adviceWeeks),
      categoriesToReduce: nonEssentialCategories
    }
  }
}

const navItems = (text: ReturnType<typeof getUiText>): Array<{ key: TabKey; label: string; icon: typeof Gauge }> => [
  { key: 'dashboard', label: text.nav.dashboard, icon: Gauge },
  { key: 'income', label: text.nav.income, icon: ArrowUpCircle },
  { key: 'expenses', label: text.nav.expenses, icon: ArrowDownCircle },
  { key: 'budget', label: text.nav.budget, icon: Wallet },
  { key: 'reports', label: text.nav.reports, icon: ChartNoAxesCombined },
  { key: 'goals', label: text.nav.goals, icon: Goal },
  { key: 'debts', label: text.nav.debts, icon: Landmark },
  { key: 'settings', label: text.nav.settings, icon: SettingsIcon }
]

function createCategoryForm(category?: Category): SaveCategoryInput {
  if (!category) {
    return {
      name: '',
      type: 'custom',
      color: '#64748b',
      icon: 'folder',
      monthlyLimit: 0
    }
  }

  return {
    id: category.id,
    name: category.name,
    type: category.type,
    color: category.color,
    icon: category.icon,
    monthlyLimit: category.monthlyLimit ?? 0,
    builtIn: category.builtIn
  }
}

function createIncomeForm(input?: Partial<SaveIncomeInput>): SaveIncomeInput {
  return {
    id: input?.id,
    name: input?.name ?? '',
    groupName: input?.groupName ?? 'Primary',
    amount: input?.amount ?? 0,
    date: input?.date ?? todayString(),
    type: input?.type ?? 'fixed',
    recurring: input?.recurring ?? false,
    notes: input?.notes ?? ''
  }
}

function createExpenseForm(input?: Partial<SaveExpenseInput>): SaveExpenseInput {
  return {
    id: input?.id,
    title: input?.title ?? '',
    amount: input?.amount ?? 0,
    date: input?.date ?? todayString(),
    categoryId: input?.categoryId ?? 'misc',
    paymentMethod: input?.paymentMethod ?? 'card',
    type: input?.type ?? 'variable',
    recurring: input?.recurring ?? false,
    notes: input?.notes ?? '',
    tags: input?.tags ?? [],
    goalId: input?.goalId ?? null,
    debtId: input?.debtId ?? null,
    allocationKind: input?.allocationKind ?? 'spend'
  }
}

function createGoalForm(input?: Partial<SaveGoalInput>): SaveGoalInput {
  return {
    id: input?.id,
    name: input?.name ?? '',
    type: input?.type ?? 'general',
    targetAmount: input?.targetAmount ?? 0,
    currentAmount: input?.currentAmount ?? 0,
    targetDate: input?.targetDate ?? todayString(),
    priority: input?.priority ?? 'medium',
    notes: input?.notes ?? ''
  }
}

function createDebtForm(input?: Partial<SaveDebtInput>): SaveDebtInput {
  return {
    id: input?.id,
    name: input?.name ?? '',
    totalAmount: input?.totalAmount ?? 0,
    installmentAmount: input?.installmentAmount ?? 0,
    startDate: input?.startDate ?? todayString(),
    endDate: input?.endDate ?? null,
    desiredPayoffDate: input?.desiredPayoffDate ?? null,
    paymentFrequency: input?.paymentFrequency ?? 'monthly',
    recurringAutomatically: input?.recurringAutomatically ?? true,
    categoryId: input?.categoryId ?? 'debt',
    notes: input?.notes ?? ''
  }
}

function HelpButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="help-icon-button" onClick={onClick} aria-label={label}>
      <CircleHelp size={14} />
    </button>
  )
}

function ExplainedMetricLine({
  label,
  value,
  help,
  onHelp
}: {
  label: string
  value: string
  help: string
  onHelp: (title: string, body: string) => void
}) {
  return (
    <div className="metric-line">
      <span className="metric-label-with-help">
        {label}
        <HelpButton label={label} onClick={() => onHelp(label, help)} />
      </span>
      <strong>{value}</strong>
    </div>
  )
}

export function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard')
  const [busyLabel, setBusyLabel] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [actionError, setActionError] = useState('')
  const [startupError, setStartupError] = useState<Error | null>(null)
  const [expenseSearch, setExpenseSearch] = useState('')
  const [expensePeriodFilter, setExpensePeriodFilter] = useState<ExpensePeriodFilter>('month')
  const [budgetPeriodFilter, setBudgetPeriodFilter] = useState<BudgetPeriodFilter>('month')
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [pendingGoalLinkExpense, setPendingGoalLinkExpense] = useState<SaveExpenseInput | null>(null)
  const [goalLinkPromptGoalId, setGoalLinkPromptGoalId] = useState('')
  const [categoryDeletionImpact, setCategoryDeletionImpact] = useState<CategoryDeletionImpact | null>(null)
  const [categoryDeletionMode, setCategoryDeletionMode] = useState<DeleteCategoryInput['mode']>('fallback')
  const [categoryDeletionTargetId, setCategoryDeletionTargetId] = useState('')
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [fullUploadDialogOpen, setFullUploadDialogOpen] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatusSnapshot | null>(null)
  const [helpDialog, setHelpDialog] = useState<{ title: string; body: string } | null>(null)
  const [balanceAdjustmentValue, setBalanceAdjustmentValue] = useState('')
  const [balanceAdjustmentNote, setBalanceAdjustmentNote] = useState('')

  const [incomeForm, setIncomeForm] = useState<SaveIncomeInput>(createIncomeForm())
  const [expenseForm, setExpenseForm] = useState<SaveExpenseInput>(createExpenseForm())
  const [goalForm, setGoalForm] = useState<SaveGoalInput>(createGoalForm())
  const [goalContributionForm, setGoalContributionForm] = useState<SaveGoalContributionInput>({
    goalId: '',
    amount: 0,
    date: todayString(),
    notes: '',
    categoryId: 'savings',
    paymentMethod: 'transfer'
  })
  const [debtForm, setDebtForm] = useState<SaveDebtInput>(createDebtForm())
  const [categoryForm, setCategoryForm] = useState<SaveCategoryInput>(createCategoryForm())

  useEffect(() => {
    const bridge = window.moneywise
    if (!bridge) {
      const error = new Error('Preload bridge is unavailable in renderer. Check preload loading and contextBridge exposure.')
      console.error('[renderer] Missing preload bridge', error)
      setStartupError(error)
      return
    }

    console.info('[renderer] Loading initial snapshot')
    setStatusMessage(getUiText('ar').startingApp)
    void bridge
      .getSnapshot()
      .then((data) => {
        setSnapshot(data)
        setStatusMessage('')
      })
      .catch((error: unknown) => {
        const nextError = error instanceof Error ? error : new Error(String(error))
        console.error('[renderer] Initial snapshot load failed', nextError)
        setStartupError(nextError)
      })
  }, [])

  const bridge = window.moneywise
  const syncBridge = window.syncApi
  const settings = snapshot?.settings
  const language = settings?.language ?? 'ar'
  const text = useMemo(() => getUiText(language), [language])
  const deferredSearch = useDeferredValue(expenseSearch)
  const currentBudgetPlan = useMemo(() => {
    if (!snapshot) return null
    return snapshot.budgetPlans.find((entry) => entry.month === snapshot.analytics.dashboard.month) ?? snapshot.budgetPlans[0] ?? null
  }, [snapshot])

  useEffect(() => {
    if (!bridge) {
      return
    }
    let disposed = false
    const loadSyncStatus = async (): Promise<void> => {
      try {
        const status = await bridge.getSyncStatus()
        if (!disposed) {
          console.info('[renderer] SYNC STATUS RECEIVED', {
            enabled: status.enabled,
            paused: status.paused,
            connection: status.backendReachable,
            account: status.accountEmail
          })
          setSyncStatus(status)
        }
      } catch (error) {
        if (!disposed) {
          const nextError = error instanceof Error ? error : new Error(String(error))
          setActionError(nextError.message || getUiText('ar').common.genericError)
        }
      }
    }
    void loadSyncStatus()
    const timer = window.setInterval(() => {
      void loadSyncStatus()
    }, 7000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [bridge])

  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.dir = settings?.rtl ? 'rtl' : 'ltr'
  }, [language, settings?.rtl])

  const periodFilteredExpenses = useMemo(() => {
    if (!snapshot) return []
    const interval = getExpensePeriodInterval(expensePeriodFilter)
    return snapshot.expenses.filter((expense) => isWithinInterval(parseISO(expense.date), interval))
  }, [expensePeriodFilter, snapshot])

  const filteredExpenses = useMemo(() => {
    if (!snapshot) return []
    const query = deferredSearch.trim().toLowerCase()
    if (!query) return periodFilteredExpenses

    return periodFilteredExpenses.filter((expense) => {
      const category = snapshot.categories.find((entry) => entry.id === expense.categoryId)
      const categoryName = category ? translateCategoryName(category, language) : expense.categoryId
      return [expense.title, expense.notes, expense.amount.toString(), expense.date, categoryName, expense.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
  }, [deferredSearch, language, periodFilteredExpenses, snapshot])

  useEffect(() => {
    if (!snapshot) return
    const fallbackCategory = snapshot.categories[0]?.id ?? 'misc'
    const defaultSavingCategory = snapshot.categories.find((entry) => entry.type === 'saving')?.id ?? 'savings'
    const defaultDebtCategory = snapshot.categories.find((entry) => entry.type === 'debt')?.id ?? 'debt'
    setExpenseForm((current) => ({ ...current, categoryId: current.categoryId || fallbackCategory }))
    setGoalContributionForm((current) => ({
      ...current,
      goalId: current.goalId || snapshot.goals[0]?.id || '',
      categoryId: current.categoryId || defaultSavingCategory
    }))
    setDebtForm((current) => ({
      ...current,
      categoryId: current.categoryId || defaultDebtCategory
    }))

    if (editingCategoryId && !snapshot.categories.some((category) => category.id === editingCategoryId)) {
      setEditingCategoryId(null)
      setCategoryForm(createCategoryForm())
    }
  }, [editingCategoryId, snapshot])

  const expensePeriodOptions: Array<{ label: string; value: ExpensePeriodFilter }> = [
    { label: text.expenses.todayFilter, value: 'today' },
    { label: text.expenses.weekFilter, value: 'week' },
    { label: text.expenses.monthFilter, value: 'month' },
    { label: text.expenses.previousMonthFilter, value: 'previousMonth' },
    { label: text.expenses.previousYearFilter, value: 'previousYear' },
    { label: text.expenses.nextMonthFilter, value: 'nextMonth' },
    { label: text.expenses.nextYearFilter, value: 'nextYear' }
  ]
  const expensePeriodDays = getExpensePeriodDayCount(expensePeriodFilter)
  const expensePeriodTotal = filteredExpenses.reduce((sum, entry) => sum + entry.amount, 0)
  const expensePeriodAverageDaily = expensePeriodFilter === 'today' ? expensePeriodTotal : expensePeriodTotal / Math.max(expensePeriodDays, 1)
  const isFutureExpensePeriod = expensePeriodFilter === 'nextMonth' || expensePeriodFilter === 'nextYear'
  const budgetPlanner = useMemo(() => {
    if (!snapshot) return null
    return getBudgetPlannerStateForInterval(snapshot, budgetPeriodFilter, currentBudgetPlan ?? undefined)
  }, [budgetPeriodFilter, currentBudgetPlan, snapshot])
  const budgetPageInsights = useMemo(() => {
    if (!snapshot) return null
    return getBudgetPageInsights(snapshot, currentBudgetPlan ?? undefined, budgetPeriodFilter)
  }, [budgetPeriodFilter, currentBudgetPlan, snapshot])
  const expensePeriodSummary = useMemo(() => {
    if (!snapshot) return null
    return getExpensePeriodSummary(snapshot, expensePeriodFilter, currentBudgetPlan ?? undefined)
  }, [expensePeriodFilter, currentBudgetPlan, snapshot])
  const expensePeriodChart = useMemo(() => {
    const totals = new Map<string, number>()
    filteredExpenses.forEach((expense) => {
      totals.set(expense.categoryId, (totals.get(expense.categoryId) ?? 0) + expense.amount)
    })
    return [...totals.entries()]
      .map(([categoryId, amount]) => {
        const category = snapshot?.categories.find((entry) => entry.id === categoryId)
        return {
          categoryId,
          categoryName: category ? translateCategoryName(category, language) : categoryId,
          amount,
          color: category?.color ?? '#5b7fff'
        }
      })
      .sort((left, right) => right.amount - left.amount)
      .slice(0, 6)
  }, [filteredExpenses, language, snapshot?.categories])
  const expensePeriodLabel = expensePeriodOptions.find((entry) => entry.value === expensePeriodFilter)?.label ?? text.expenses.monthFilter
  const budgetPeriodOptions: Array<{ label: string; value: BudgetPeriodFilter }> = [
    { label: text.expenses.todayFilter, value: 'today' },
    { label: text.expenses.weekFilter, value: 'week' },
    { label: text.expenses.monthFilter, value: 'month' },
    { label: text.budget.thisYearFilter, value: 'year' },
    { label: text.expenses.previousMonthFilter, value: 'previousMonth' },
    { label: text.expenses.previousYearFilter, value: 'previousYear' },
    { label: text.expenses.nextMonthFilter, value: 'nextMonth' },
    { label: text.expenses.nextYearFilter, value: 'nextYear' }
  ]
  const budgetPlannerPeriodLabel = budgetPeriodOptions.find((entry) => entry.value === budgetPeriodFilter)?.label ?? text.expenses.monthFilter
  const balanceCopy =
    language === 'ar'
      ? {
          editCurrentBalance: 'تعديل الرصيد الحالي',
          currentAvailableBalance: 'الرصيد الحالي المتاح',
          newBalance: 'الرصيد الجديد',
          adjustmentReason: 'سبب التعديل',
          saveAdjustment: 'حفظ تعديل الرصيد',
          lastAdjustment: 'آخر تعديل يدوي',
          noAdjustment: 'لا يوجد تعديل يدوي محفوظ',
          notePlaceholder: 'سبب اختياري للتعديل',
          amountError: 'أدخل رصيدًا صحيحًا',
          adjustedOn: 'تاريخ التعديل'
        }
      : {
          editCurrentBalance: 'Edit current balance',
          currentAvailableBalance: 'Current available balance',
          newBalance: 'New balance',
          adjustmentReason: 'Adjustment reason',
          saveAdjustment: 'Save balance adjustment',
          lastAdjustment: 'Last manual adjustment',
          noAdjustment: 'No manual adjustment saved',
          notePlaceholder: 'Optional reason for the adjustment',
          amountError: 'Enter a valid balance',
          adjustedOn: 'Adjustment date'
        }
  const helpCopy =
    language === 'ar'
      ? {
          availableBalance:
            `المعنى: الرصيد المتاح للفترة المحددة.\nالصيغة: الرصيد المتاح = الرصيد المرحّل من الفترات السابقة + آخر تعديل يدوي إن وجد.\nمصادر البيانات: الدخل السابق، المصاريف السابقة، وآخر تعديل يدوي محفوظ في الإعدادات.\nالفترة المحددة: ${budgetPlannerPeriodLabel}.\nيشمل: الرصيد المرحّل والتعديل اليدوي. لا يشمل دخل أو إنفاق الفترة نفسها في هذا السطر.`,
          expectedIncome:
            `المعنى: الدخل المتوقع داخل الفترة المحددة.\nالصيغة: دخل الفترة = الدخل المسجل داخل الفترة + الدخل المتكرر المتوقع غير المسجل بعد.\nمصادر البيانات: سجلات الدخل والدخل المتكرر.\nالفترة المحددة: ${budgetPlannerPeriodLabel}.`,
          totalAvailable:
            `المعنى: إجمالي المال المتاح قبل الالتزامات.\nالصيغة: إجمالي المال المتاح = الرصيد المرحّل + دخل الفترة.\nمصادر البيانات: الدخل، المصاريف السابقة، الدخل المتكرر، والتعديل اليدوي إن وجد.\nالفترة المحددة: ${budgetPlannerPeriodLabel}.`,
          fixedSpending:
            `المعنى: مجموع المصاريف المسجلة كـ "ثابت" داخل الفترة المحددة فقط.\nالصيغة: المصاريف الثابتة = مجموع المصاريف الثابتة بتاريخ داخل الفترة.\nمصادر البيانات: سجلات المصاريف المرئية بعد فلتر الفترة.\nالفترة المحددة: ${expensePeriodLabel}.\nيشمل: المصاريف الثابتة الفعلية فقط. لا يشمل التوقعات.`,
          totalSpending:
            `المعنى: إجمالي الإنفاق الفعلي داخل الفترة المحددة.\nالصيغة: إجمالي الإنفاق = مجموع كل المصاريف بتاريخ داخل الفترة.\nمصادر البيانات: سجلات المصاريف المرئية بعد فلتر الفترة.\nالفترة المحددة: ${expensePeriodLabel}.\nيشمل: الثابت والمتغير والديون إذا كانت مسجلة كمصاريف فعلية.`,
          variableSpending:
            `المعنى: مجموع المصاريف المسجلة كـ "متغير" داخل الفترة المحددة فقط.\nالصيغة: المصاريف المتغيرة = مجموع المصاريف المتغيرة بتاريخ داخل الفترة.\nمصادر البيانات: سجلات المصاريف المرئية بعد فلتر الفترة.\nالفترة المحددة: ${expensePeriodLabel}.`,
          commitments:
            `المعنى: الالتزامات المطلوبة للفترة.\nالصيغة: الالتزامات = المصاريف الثابتة + أقساط الديون + المصاريف المتكررة المطلوبة.\nمصادر البيانات: المصاريف، الديون، والمصاريف المتكررة.\nالفترة المحددة: ${budgetPlannerPeriodLabel}.\nلا تشمل الأهداف إلا إذا تم تسجيلها كمصروف فعلي.`,
          flexibleRemaining:
            `المعنى: المال المتبقي للإنفاق المرن.\nالصيغة: الرصيد المرن المتبقي = إجمالي المال المتاح - الالتزامات - الإنفاق المتغير المسجل.\nمصادر البيانات: الدخل، المصاريف، الديون، والتعديل اليدوي إن وجد.\nالفترة المحددة: ${budgetPlannerPeriodLabel}.`,
          allowedSpend:
            `المعنى: حد الصرف الآمن حتى نهاية الفترة.\nالصيغة اليومية: المسموح يوميًا = الرصيد المرن المتبقي ÷ الأيام المتبقية.\nالصيغة الأسبوعية: المسموح أسبوعيًا = الرصيد المرن المتبقي ÷ الأسابيع المتبقية.\nمصادر البيانات: الرصيد المرن المتبقي وعدد الأيام/الأسابيع المتبقية.\nالفترة المحددة: ${budgetPlannerPeriodLabel}.`
        }
      : {
          availableBalance:
            `Meaning: available balance for the selected period.\nFormula: available balance = carried balance from previous periods + latest manual adjustment if one exists.\nData sources: prior income, prior expenses, and the latest manual balance adjustment saved in settings.\nSelected period: ${budgetPlannerPeriodLabel}.\nIncludes: carried balance and manual adjustment. It does not include this period's income or spending in this row.`,
          expectedIncome:
            `Meaning: income expected inside the selected period.\nFormula: period income = recorded income inside the period + expected recurring income not recorded yet.\nData sources: income records and recurring income records.\nSelected period: ${budgetPlannerPeriodLabel}.`,
          totalAvailable:
            `Meaning: total money available before commitments.\nFormula: total available money = carried balance + period income.\nData sources: income, prior expenses, recurring income, and manual adjustment if one exists.\nSelected period: ${budgetPlannerPeriodLabel}.`,
          fixedSpending:
            `Meaning: total expenses marked "fixed" inside the selected period only.\nFormula: fixed spending = sum of fixed expenses dated inside the period.\nData sources: visible expense records after the period filter.\nSelected period: ${expensePeriodLabel}.\nIncludes: actual fixed expenses only. It does not include projections.`,
          totalSpending:
            `Meaning: actual spending inside the selected period.\nFormula: total spending = sum of all expenses dated inside the period.\nData sources: visible expense records after the period filter.\nSelected period: ${expensePeriodLabel}.\nIncludes: fixed, variable, and debt payments when they are recorded as actual expenses.`,
          variableSpending:
            `Meaning: total expenses marked "variable" inside the selected period only.\nFormula: variable spending = sum of variable expenses dated inside the period.\nData sources: visible expense records after the period filter.\nSelected period: ${expensePeriodLabel}.`,
          commitments:
            `Meaning: required commitments for the period.\nFormula: commitments = fixed expenses + debt installments + required recurring expenses.\nData sources: expenses, debts, and recurring expenses.\nSelected period: ${budgetPlannerPeriodLabel}.\nGoals are excluded unless they were recorded as actual expenses.`,
          flexibleRemaining:
            `Meaning: money left for flexible spending.\nFormula: flexible remaining = total available money - commitments - recorded variable spending.\nData sources: income, expenses, debts, and manual adjustment if one exists.\nSelected period: ${budgetPlannerPeriodLabel}.`,
          allowedSpend:
            `Meaning: safe spending limit until the end of the period.\nDaily formula: allowed daily spend = flexible remaining ÷ remaining days.\nWeekly formula: allowed weekly spend = flexible remaining ÷ remaining weeks.\nData sources: flexible remaining and remaining days/weeks.\nSelected period: ${budgetPlannerPeriodLabel}.`
        }

  const performAction = async (label: string, action: AsyncAction): Promise<boolean> => {
    setBusyLabel(label)
    setActionError('')
    try {
      const next = await action()
      startTransition(() => {
        setSnapshot(next)
        setStatusMessage(text.completedAction(label))
      })
      void refreshSyncStatus()
      window.setTimeout(() => setStatusMessage(''), 2200)
      return true
    } catch (error) {
      const nextError = error instanceof Error ? error : new Error(String(error))
      console.error(`[renderer] Action failed: ${label}`, nextError)
      setActionError(nextError.message || text.common.genericError)
      return false
    } finally {
      setBusyLabel('')
    }
  }

  const refreshSyncStatus = async (): Promise<void> => {
    if (!bridge && !syncBridge) return
    console.info('[renderer] CLICK REFRESH')
    try {
      const nextStatus = bridge ? await bridge.getSyncStatus() : await syncBridge!.refreshSyncState()
      console.info('[renderer] SYNC STATUS RECEIVED', {
        enabled: nextStatus.enabled,
        paused: nextStatus.paused,
        connection: nextStatus.backendReachable,
        account: nextStatus.accountEmail
      })
      setSyncStatus(nextStatus)
    } catch (error) {
      const nextError = error instanceof Error ? error : new Error(String(error))
      setActionError(nextError.message || text.common.genericError)
    }
  }

  const runManualSync = async (): Promise<void> => {
    if (!bridge && !syncBridge) return
    console.info('[renderer] CLICK SYNC')
    setBusyLabel(text.settings.syncNow)
    setActionError('')
    try {
      const nextStatus = bridge ? await bridge.syncNow() : await syncBridge!.syncNow()
      setSyncStatus(nextStatus)
      if (nextStatus.phase === 'error' && nextStatus.lastError) {
        setActionError(nextStatus.lastError)
      } else {
        setStatusMessage(text.completedAction(text.settings.syncNow))
        window.setTimeout(() => setStatusMessage(''), 2200)
      }
    } catch (error) {
      const nextError = error instanceof Error ? error : new Error(String(error))
      setActionError(nextError.message || text.common.genericError)
    } finally {
      setBusyLabel('')
    }
  }

  const updateSyncPaused = async (paused: boolean): Promise<void> => {
    if (!bridge) return
    setBusyLabel(paused ? text.settings.pauseSync : text.settings.resumeSync)
    setActionError('')
    try {
      const nextStatus = await bridge.setSyncPaused(paused)
      setSyncStatus(nextStatus)
      setStatusMessage(text.completedAction(paused ? text.settings.pauseSync : text.settings.resumeSync))
      window.setTimeout(() => setStatusMessage(''), 2200)
    } catch (error) {
      const nextError = error instanceof Error ? error : new Error(String(error))
      setActionError(nextError.message || text.common.genericError)
    } finally {
      setBusyLabel('')
    }
  }

  const uploadAllLocalData = async (): Promise<void> => {
    if (!bridge && !syncBridge) return
    console.info('[renderer] CLICK UPLOAD ALL')
    setBusyLabel(text.settings.uploadingAllLocalData)
    setActionError('')
    try {
      console.info('[renderer] Full upload started')
      const nextStatus = bridge ? await bridge.uploadAllLocalData() : await syncBridge!.uploadAllData()
      setSyncStatus(nextStatus)
      setFullUploadDialogOpen(false)
      if (nextStatus.phase === 'error' && nextStatus.lastError) {
        console.error('[renderer] Full upload failed', nextStatus.lastError)
        setActionError(nextStatus.lastError)
      } else {
        console.info('[renderer] Full upload completed')
        setStatusMessage(text.settings.uploadCompleted)
        window.setTimeout(() => setStatusMessage(''), 2200)
      }
    } catch (error) {
      const nextError = error instanceof Error ? error : new Error(String(error))
      console.error('[renderer] Full upload failed', nextError)
      setActionError(nextError.message || text.common.genericError)
      setStatusMessage(text.settings.uploadFailed)
      window.setTimeout(() => setStatusMessage(''), 2200)
    } finally {
      setBusyLabel('')
    }
  }

  if (startupError) {
    return (
      <div className="boot-error-screen">
        <div className="boot-error-card">
          <h1>{text.startupTitle}</h1>
          <p>{text.startupPhaseData}</p>
          <pre>{`${startupError.message}\n\n${startupError.stack ?? ''}`}</pre>
        </div>
      </div>
    )
  }

  if (!bridge) {
    return (
      <div className="boot-error-screen">
        <div className="boot-error-card">
          <h1>{text.startupTitle}</h1>
          <p>{text.startupPhaseBridge}</p>
          <pre>{text.startupBridgeMissing}</pre>
        </div>
      </div>
    )
  }

  if (!snapshot || !settings || !currentBudgetPlan) {
    return <div className="loading-state">{text.preparingApp}</div>
  }

  const fmtMoney = (value: number): string => currencyFormatter(value, settings.currency, settings.locale)
  const dashboard = snapshot.analytics.dashboard
  const actionsDisabled = busyLabel.length > 0
  const syncConnectionLabel = !syncStatus?.enabled
    ? text.settings.syncDisabled
    : syncStatus.paused
      ? text.settings.syncPausedStatus
      : syncStatus.backendReachable
        ? text.settings.syncConnected
        : text.settings.syncOffline
  const syncPhaseLabel =
    syncStatus?.phase === 'syncing'
      ? text.settings.syncInProgress
      : syncStatus?.phase === 'error'
        ? text.settings.syncNeedsAttention
        : syncStatus?.pendingChanges
          ? text.settings.syncPending
          : text.settings.syncReady
  const syncTopbarLabel = syncStatus
    ? `${text.settings.syncTitle}: ${syncPhaseLabel}`
    : `${text.settings.syncTitle}: ${text.settings.syncLoading}`
  const plannerStatusSource = budgetPageInsights?.budgetSummary.plannerStatus ?? budgetPlanner?.status
  const plannerStatusLabel = plannerStatusSource
    ? plannerStatusSource === 'comfortable'
      ? text.budget.plannerStatusComfortable
      : plannerStatusSource === 'tight'
        ? text.budget.plannerStatusTight
        : plannerStatusSource === 'risky'
          ? text.budget.plannerStatusRisky
          : text.budget.plannerStatusNotEnough
    : text.budget.plannerStatusComfortable
  const defaultExpenseCategoryId = snapshot.categories.find((entry) => entry.id === 'misc')?.id ?? snapshot.categories[0]?.id ?? 'misc'
  const defaultDebtCategoryId = snapshot.categories.find((entry) => entry.type === 'debt')?.id ?? snapshot.categories[0]?.id ?? 'debt'
  const budgetMethodLabels = Object.fromEntries(
    (Object.keys({
      'fifty-thirty-twenty': true,
      'zero-based': true,
      'custom-percentage': true,
      'priority-based': true,
      'goal-first': true,
      'debt-focused': true
    }) as BudgetMethod[]).map((method) => [method, translateBudgetMethod(method, language)])
  ) as Record<BudgetMethod, string>
  const nav = navItems(text)

  const resetIncomeForm = (): void => setIncomeForm(createIncomeForm())
  const resetExpenseForm = (): void => setExpenseForm(createExpenseForm({ categoryId: defaultExpenseCategoryId }))
  const resetGoalForm = (): void => setGoalForm(createGoalForm())
  const resetDebtForm = (): void => setDebtForm(createDebtForm({ categoryId: defaultDebtCategoryId }))

  const incomeErrors = {
    name: incomeForm.name.trim() ? '' : text.income.errors.name,
    amount: incomeForm.amount > 0 ? '' : text.income.errors.amount
  }
  const expenseErrors = {
    title: expenseForm.title.trim() ? '' : text.expenses.errors.title,
    amount: expenseForm.amount > 0 ? '' : text.expenses.errors.amount
  }
  const goalErrors = {
    name: goalForm.name.trim() ? '' : text.goals.errors.name,
    targetAmount: goalForm.targetAmount > 0 ? '' : text.goals.errors.targetAmount
  }
  const debtErrors = {
    name: debtForm.name.trim() ? '' : text.debts.errors.name,
    totalAmount: debtForm.totalAmount > 0 ? '' : text.debts.errors.totalAmount
  }

  const handleIncomeSubmit = async (): Promise<void> => {
    if (incomeErrors.name || incomeErrors.amount) return
    const saved = await performAction(incomeForm.id ? text.common.edit : text.income.saveAction, () => bridge.saveIncome(incomeForm))
    if (saved) {
      resetIncomeForm()
    }
  }

  const handleExpenseSubmit = async (): Promise<void> => {
    if (expenseErrors.title || expenseErrors.amount) return
    const category = snapshot.categories.find((entry) => entry.id === expenseForm.categoryId)
    const linkedDebt = expenseForm.debtId ? snapshot.debts.find((entry) => entry.id === expenseForm.debtId) ?? null : null
    const normalizedExpense: SaveExpenseInput = {
      ...expenseForm,
      categoryId: linkedDebt?.categoryId ?? expenseForm.categoryId,
      goalId: linkedDebt ? null : expenseForm.goalId ?? null,
      debtId: linkedDebt?.id ?? null,
      allocationKind: linkedDebt ? 'spend' : expenseForm.goalId ? 'goal-contribution' : category?.type === 'saving' ? 'saving' : 'spend'
    }

    if (normalizedExpense.goalId && category?.type !== 'saving') {
      setPendingGoalLinkExpense(normalizedExpense)
      setGoalLinkPromptGoalId(normalizedExpense.goalId)
      return
    }

    const saved = await performAction(expenseForm.id ? text.common.edit : text.expenses.saveAction, () => bridge.saveExpense(normalizedExpense))
    if (saved) {
      resetExpenseForm()
    }
  }

  const handleGoalSubmit = async (): Promise<void> => {
    if (goalErrors.name || goalErrors.targetAmount) return
    const saved = await performAction(goalForm.id ? text.common.edit : text.goals.saveAction, () => bridge.saveGoal(goalForm))
    if (saved) {
      resetGoalForm()
    }
  }

  const handleGoalContributionSubmit = async (): Promise<void> => {
    if (!goalContributionForm.goalId || goalContributionForm.amount <= 0) return
    const saved = await performAction(text.goals.addContribution, () => bridge.saveGoalContribution(goalContributionForm))
    if (saved) {
      setGoalContributionForm((current) => ({ ...current, amount: 0, notes: '', date: todayString() }))
    }
  }

  const handleDebtSubmit = async (): Promise<void> => {
    if (debtErrors.name || debtErrors.totalAmount) return
    const saved = await performAction(text.nav.debts, () =>
      bridge.saveDebt({
        ...debtForm,
        endDate: debtForm.endDate || null,
        desiredPayoffDate: debtForm.desiredPayoffDate || null
      })
    )
    if (saved) {
      resetDebtForm()
    }
  }

  const confirmGoalExpenseLink = async (mode: 'convert' | 'keep'): Promise<void> => {
    if (!pendingGoalLinkExpense) return
    const savingCategoryId = snapshot.categories.find((entry) => entry.type === 'saving')?.id ?? pendingGoalLinkExpense.categoryId
    const payload: SaveExpenseInput =
      mode === 'convert'
        ? {
            ...pendingGoalLinkExpense,
            categoryId: savingCategoryId,
            goalId: goalLinkPromptGoalId || snapshot.goals[0]?.id || null,
            allocationKind: 'goal-contribution'
          }
        : {
            ...pendingGoalLinkExpense,
            goalId: goalLinkPromptGoalId || snapshot.goals[0]?.id || null,
            allocationKind: 'goal-contribution'
          }

    const saved = await performAction(text.expenses.saveAction, () => bridge.saveExpense(payload))
    if (saved) {
      setPendingGoalLinkExpense(null)
      setGoalLinkPromptGoalId('')
      resetExpenseForm()
    }
  }

  const beginEditIncome = (income: AppSnapshot['incomes'][number]): void => {
    setIncomeForm(createIncomeForm(income))
    setActiveTab('income')
  }

  const beginEditExpense = (expense: AppSnapshot['expenses'][number]): void => {
    setExpenseForm(createExpenseForm(expense))
    setActiveTab('expenses')
  }

  const beginEditGoal = (goal: AppSnapshot['goals'][number]): void => {
    setGoalForm(createGoalForm(goal))
    setActiveTab('goals')
  }

  const beginEditDebt = (debt: AppSnapshot['debts'][number]): void => {
    setDebtForm(createDebtForm(debt))
    setActiveTab('debts')
  }

  const confirmResetData = async (): Promise<void> => {
    const reset = await performAction(text.settings.reset, () => bridge.resetData())
    if (reset) {
      setResetDialogOpen(false)
      resetIncomeForm()
      resetExpenseForm()
      resetGoalForm()
      resetDebtForm()
      setCategoryForm(createCategoryForm())
      setEditingCategoryId(null)
    }
  }

  const openCategoryDeletionDialog = async (category: Category): Promise<void> => {
    try {
      const impact = await bridge.getCategoryDeletionImpact(category.id)
      setCategoryDeletionImpact(impact)
      setCategoryDeletionMode('fallback')
      setCategoryDeletionTargetId(impact.availableTargetCategories[0]?.id ?? '')
    } catch (error) {
      const nextError = error instanceof Error ? error : new Error(String(error))
      setActionError(nextError.message || text.common.genericError)
    }
  }

  const confirmCategoryDeletion = async (): Promise<void> => {
    if (!categoryDeletionImpact) return
    const payload: DeleteCategoryInput = {
      categoryId: categoryDeletionImpact.categoryId,
      mode: categoryDeletionMode,
      targetCategoryId: categoryDeletionMode === 'reassign' ? categoryDeletionTargetId : undefined
    }
    const deleted = await performAction(text.settings.confirmDeleteCategory, () => bridge.deleteCategory(payload))
    if (deleted) {
      setCategoryDeletionImpact(null)
    }
  }

  const handleCategorySubmit = async (): Promise<void> => {
    if (!categoryForm.name.trim()) return
    const saved = await performAction(editingCategoryId ? text.settings.updateCategory : text.settings.saveCategory, () =>
      bridge.saveCategory({
        ...categoryForm,
        monthlyLimit: categoryForm.monthlyLimit && categoryForm.monthlyLimit > 0 ? categoryForm.monthlyLimit : null
      })
    )
    if (saved) {
      setEditingCategoryId(null)
      setCategoryForm(createCategoryForm())
    }
  }

  const beginEditCategory = (category: Category): void => {
    setEditingCategoryId(category.id)
    setCategoryForm(createCategoryForm(category))
  }

  const updateBudgetMethod = async (method: BudgetMethod): Promise<void> => {
    console.info('BUDGET ENGINE UPDATED', { method })
    const payload: SaveBudgetPlanInput = { ...currentBudgetPlan, method }
    await performAction(text.budget.method, () => bridge.saveBudgetPlan(payload))
  }

  const updateBudgetEnginePlan = async (patch: Partial<SaveBudgetPlanInput>, label: string): Promise<void> => {
    console.info('BUDGET ENGINE UPDATED', patch)
    await performAction(label, () => bridge.saveBudgetPlan({ ...currentBudgetPlan, ...patch }))
  }

  const updateSettings = async (next: Settings): Promise<void> => {
    await performAction(text.nav.settings, () => bridge.saveSettings(next))
  }

  const saveBalanceCorrection = async (currentBalance: number): Promise<void> => {
    if (!settings) return
    const newBalance = Number.parseFloat(balanceAdjustmentValue.replace(',', '.').trim())
    if (!Number.isFinite(newBalance)) {
      setActionError(balanceCopy.amountError)
      return
    }
    const now = new Date().toISOString()
    const correction = {
      id: `balance-adjustment-${Date.now()}`,
      effectiveDate: now,
      calculatedBalanceBefore: round2(currentBalance),
      correctedBalance: round2(newBalance),
      difference: round2(newBalance - currentBalance),
      note: balanceAdjustmentNote.trim(),
      createdAt: now,
      updatedAt: now
    }
    await performAction(balanceCopy.editCurrentBalance, () =>
      bridge.saveSettings({
        ...settings,
        balanceCorrection: correction
      })
    )
    setBalanceAdjustmentValue('')
    setBalanceAdjustmentNote('')
  }

  const renderIncome = () => (
    <div className="screen-grid">
      <div className="two-column-grid">
        <SectionCard title={text.income.addTitle} subtitle={text.income.addSubtitle}>
          <div className="form-grid">
            <InputField label={text.income.sourceName} value={incomeForm.name} onChange={(value) => setIncomeForm({ ...incomeForm, name: value })} error={incomeErrors.name} />
            <InputField label={text.income.group} value={incomeForm.groupName} onChange={(value) => setIncomeForm({ ...incomeForm, groupName: value })} hint={text.income.groupHint} />
            <InputField label={text.income.amount} type="number" value={incomeForm.amount} onChange={(value) => setIncomeForm({ ...incomeForm, amount: parseDecimalInput(value) })} error={incomeErrors.amount} />
            <InputField label={text.income.date} type="date" value={incomeForm.date} onChange={(value) => setIncomeForm({ ...incomeForm, date: value })} />
            <SelectField label={text.income.type} value={incomeForm.type} options={[{ label: text.income.fixed, value: 'fixed' }, { label: text.income.variable, value: 'variable' }]} onChange={(value) => setIncomeForm({ ...incomeForm, type: value as SaveIncomeInput['type'] })} />
            <ToggleField label={text.income.recurringMonthly} checked={incomeForm.recurring} onChange={(checked) => setIncomeForm({ ...incomeForm, recurring: checked })} />
            <TextAreaField label={text.income.notes} value={incomeForm.notes} onChange={(value) => setIncomeForm({ ...incomeForm, notes: value })} />
            <button className="primary-button" onClick={() => void handleIncomeSubmit()} disabled={actionsDisabled || Boolean(incomeErrors.name || incomeErrors.amount)}>
              <Plus size={16} />
              {incomeForm.id ? text.common.edit : text.income.saveAction}
            </button>
            {incomeForm.id ? <button className="ghost-button" onClick={resetIncomeForm}>{text.common.cancel}</button> : null}
          </div>
        </SectionCard>

        <SectionCard title={text.income.summaryTitle} subtitle={text.income.summarySubtitle}>
          <div className="metric-grid">
            <MetricTile label={text.income.sources} value={String(snapshot.incomes.length)} icon={BriefcaseBusiness} />
            <MetricTile label={text.common.recurring} value={String(snapshot.incomes.filter((entry) => entry.recurring).length)} icon={RefreshCw} />
            <MetricTile label={text.income.fixed} value={fmtMoney(snapshot.incomes.filter((entry) => entry.type === 'fixed').reduce((sum, entry) => sum + entry.amount, 0))} icon={TrendingUp} />
            <MetricTile label={text.income.variable} value={fmtMoney(snapshot.incomes.filter((entry) => entry.type === 'variable').reduce((sum, entry) => sum + entry.amount, 0))} icon={TrendingDown} />
          </div>
        </SectionCard>
      </div>

      <SectionCard title={text.income.recordsTitle} subtitle={text.income.recordsSubtitle}>
        <table className="data-table">
          <thead>
            <tr>
              <th>{text.income.source}</th>
              <th>{text.income.group}</th>
              <th>{text.income.type}</th>
              <th>{text.income.date}</th>
              <th>{text.income.amount}</th>
              <th>{text.common.recurring}</th>
              <th>{text.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.incomes.map((income) => (
              <tr key={income.id}>
                <td>{income.name}</td>
                <td>{income.groupName}</td>
                <td>{income.type === 'fixed' ? text.income.fixed : text.income.variable}</td>
                <td>{income.date}</td>
                <td>{fmtMoney(income.amount)}</td>
                <td>{income.recurring ? text.common.yes : text.common.no}</td>
                <td>
                  <div className="toolbar">
                    <button className="ghost-button" onClick={() => beginEditIncome(income)}><Pencil size={14} />{text.common.edit}</button>
                    <button className="ghost-button" onClick={() => void performAction(text.common.delete, () => bridge.deleteIncome(income.id))}>{text.common.delete}</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>
    </div>
  )

  const renderExpenses = () => (
    <div className="screen-grid">
      <div className="two-column-grid">
        <SectionCard title={text.expenses.addTitle} subtitle={text.expenses.addSubtitle}>
          <div className="form-grid">
            <InputField label={text.expenses.title} value={expenseForm.title} onChange={(value) => setExpenseForm({ ...expenseForm, title: value })} error={expenseErrors.title} />
            <InputField label={text.income.amount} type="number" value={expenseForm.amount} onChange={(value) => setExpenseForm({ ...expenseForm, amount: parseDecimalInput(value) })} error={expenseErrors.amount} />
            <InputField label={text.expenses.date} type="date" value={expenseForm.date} onChange={(value) => setExpenseForm({ ...expenseForm, date: value })} />
            <SelectField
              label={text.expenses.category}
              value={expenseForm.categoryId}
              options={snapshot.categories.map((category) => ({ label: translateCategoryName(category, language), value: category.id }))}
              onChange={(value) => setExpenseForm({ ...expenseForm, categoryId: value })}
            />
            <SelectField
              label={text.expenses.goalLink}
              value={expenseForm.goalId ?? ''}
              options={[{ label: text.common.keepUnlinked, value: '' }, ...snapshot.goals.map((goal) => ({ label: goal.name, value: goal.id }))]}
              onChange={(value) => setExpenseForm({ ...expenseForm, goalId: value || null, debtId: value ? null : expenseForm.debtId })}
            />
            <SelectField
              label={text.expenses.debtLink}
              value={expenseForm.debtId ?? ''}
              options={[{ label: text.common.keepUnlinked, value: '' }, ...snapshot.debts.map((debt) => ({ label: debt.name, value: debt.id }))]}
              onChange={(value) => {
                const linkedDebt = snapshot.debts.find((debt) => debt.id === value)
                setExpenseForm({
                  ...expenseForm,
                  debtId: value || null,
                  goalId: value ? null : expenseForm.goalId,
                  categoryId: linkedDebt?.categoryId ?? expenseForm.categoryId
                })
              }}
            />
            <SelectField
              label={text.expenses.paymentMethod}
              value={expenseForm.paymentMethod}
              options={(['card', 'bank', 'cash', 'wallet', 'transfer'] as const).map((value) => ({ label: translatePaymentMethod(value, language), value }))}
              onChange={(value) => setExpenseForm({ ...expenseForm, paymentMethod: value as SaveExpenseInput['paymentMethod'] })}
            />
            <SelectField
              label={text.expenses.expenseType}
              value={expenseForm.type}
              options={[{ label: text.income.variable, value: 'variable' }, { label: text.income.fixed, value: 'fixed' }]}
              onChange={(value) => setExpenseForm({ ...expenseForm, type: value as SaveExpenseInput['type'] })}
            />
            <ToggleField label={text.income.recurringMonthly} checked={expenseForm.recurring} onChange={(checked) => setExpenseForm({ ...expenseForm, recurring: checked })} />
            <InputField label={text.expenses.tags} value={expenseForm.tags.join(', ')} onChange={(value) => setExpenseForm({ ...expenseForm, tags: value.split(',').map((item) => item.trim()).filter(Boolean) })} hint={text.expenses.tagsHint} />
            <TextAreaField label={text.expenses.notes} value={expenseForm.notes} onChange={(value) => setExpenseForm({ ...expenseForm, notes: value })} />
            <button className="primary-button" onClick={() => void handleExpenseSubmit()} disabled={actionsDisabled || Boolean(expenseErrors.title || expenseErrors.amount)}>
              <Plus size={16} />
              {expenseForm.id ? text.common.edit : text.expenses.saveAction}
            </button>
            {expenseForm.id ? <button className="ghost-button" onClick={resetExpenseForm}>{text.common.cancel}</button> : null}
          </div>
        </SectionCard>

        <SectionCard title={text.expenses.filtersTitle} subtitle={text.expenses.filtersSubtitle}>
          <div className="form-grid compact">
            <SelectField
              label={text.expenses.periodFilter}
              value={expensePeriodFilter}
              options={expensePeriodOptions}
              onChange={(value) => setExpensePeriodFilter(value as ExpensePeriodFilter)}
            />
          </div>
          <div className="search-box">
            <Search size={16} />
            <input value={expenseSearch} onChange={(event) => setExpenseSearch(event.target.value)} placeholder={text.expenses.searchPlaceholder} />
          </div>
          <div className="metric-grid">
            <MetricTile label={text.expenses.periodSpending} value={fmtMoney(expensePeriodTotal)} icon={CalendarRange} />
            <MetricTile label={text.expenses.transactionsCount} value={String(filteredExpenses.length)} icon={Search} />
            <MetricTile label={text.expenses.averageDailySpending} value={fmtMoney(expensePeriodAverageDaily)} icon={ChartNoAxesCombined} />
            <MetricTile label={text.common.recurring} value={String(filteredExpenses.filter((entry) => entry.recurring).length)} icon={RefreshCw} />
          </div>
          <div className="forecast-list">
            <ExplainedMetricLine label={text.expenses.totalExpensesForPeriod} value={fmtMoney(expensePeriodSummary?.totalExpensesForPeriod ?? 0)} help={helpCopy.totalSpending} onHelp={(title, body) => setHelpDialog({ title, body })} />
            <ExplainedMetricLine label={text.expenses.fixedExpensesForPeriod} value={fmtMoney(expensePeriodSummary?.fixedExpensesForPeriod ?? 0)} help={helpCopy.fixedSpending} onHelp={(title, body) => setHelpDialog({ title, body })} />
            <ExplainedMetricLine label={text.expenses.variableExpensesForPeriod} value={fmtMoney(expensePeriodSummary?.variableExpensesForPeriod ?? 0)} help={helpCopy.variableSpending} onHelp={(title, body) => setHelpDialog({ title, body })} />
            <MetricLine label={text.common.recurring} value={String(expensePeriodSummary?.recurringCount ?? 0)} />
            <MetricLine label={text.expenses.transactionsCount} value={String(expensePeriodSummary?.transactionCount ?? 0)} />
          </div>
        </SectionCard>
      </div>

      <SectionCard title={text.expenses.recordsTitle} subtitle={text.expenses.recordsSubtitle}>
        {filteredExpenses.length === 0 ? (
          <EmptyState icon={Search} title={text.expenses.noResultsTitle} description={isFutureExpensePeriod ? text.expenses.noFutureResultsDescription : text.expenses.noResultsDescription} />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{text.expenses.title}</th>
                <th>{text.expenses.category}</th>
                <th>{text.expenses.date}</th>
                <th>{text.expenses.paymentMethod}</th>
                <th>{text.expenses.expenseType}</th>
                <th>{text.expenses.allocation}</th>
                <th>{text.income.amount}</th>
                <th>{text.common.actions}</th>
              </tr>
            </thead>
            <tbody>
              {filteredExpenses.map((expense) => {
                const category = snapshot.categories.find((entry) => entry.id === expense.categoryId)
                return (
                  <tr key={expense.id}>
                    <td>
                      <div className="stacked-cell">
                        <strong>{expense.title}</strong>
                        <span>{expense.notes || expense.tags.join(', ') || '-'}</span>
                      </div>
                    </td>
                    <td><Badge label={category ? translateCategoryName(category, language) : expense.categoryId} color={category?.color} /></td>
                    <td>{expense.date}</td>
                    <td>{translatePaymentMethod(expense.paymentMethod, language)}</td>
                    <td>{expense.type === 'fixed' ? text.income.fixed : text.income.variable}</td>
                    <td>
                      <div className="stacked-cell">
                        <span>{translateExpenseAllocation(expense.allocationKind, language)}</span>
                        {expense.goalId ? <strong>{snapshot.goals.find((goal) => goal.id === expense.goalId)?.name ?? expense.goalId}</strong> : null}
                        {expense.debtId ? <strong>{snapshot.debts.find((debt) => debt.id === expense.debtId)?.name ?? expense.debtId}</strong> : null}
                      </div>
                    </td>
                    <td>{fmtMoney(expense.amount)}</td>
                    <td>
                      <div className="toolbar">
                        <button className="ghost-button" onClick={() => beginEditExpense(expense)}><Pencil size={14} />{text.common.edit}</button>
                        <button className="ghost-button" onClick={() => void performAction(text.common.delete, () => bridge.deleteExpense(expense.id))}>{text.common.delete}</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </SectionCard>
    </div>
  )

  const renderBudget = () => {
    const budgetSummary = budgetPageInsights?.budgetSummary
    const hasCommitmentsOverflow = (budgetSummary?.totalCommitments ?? 0) > (budgetSummary?.totalAvailableIncome ?? 0)
    const currentAvailableBalance = budgetSummary?.availableBalance ?? 0
    const lastAdjustment = settings?.balanceCorrection ?? null

    return (
      <div className="screen-grid">
        <SectionCard title={text.budget.selectedPeriod} subtitle={text.budget.periodFilterSubtitle}>
          <div className="form-grid compact">
            <SelectField
              label={text.budget.selectedPeriod}
              value={budgetPeriodFilter}
              options={budgetPeriodOptions}
              onChange={(value) => setBudgetPeriodFilter(value as BudgetPeriodFilter)}
            />
          </div>
        </SectionCard>

        <SectionCard title={balanceCopy.editCurrentBalance} subtitle={balanceCopy.currentAvailableBalance}>
          <div className="metric-grid">
            <MetricTile label={balanceCopy.currentAvailableBalance} value={fmtMoney(currentAvailableBalance)} icon={Wallet} />
            <MetricTile
              label={balanceCopy.lastAdjustment}
              value={lastAdjustment ? fmtMoney(lastAdjustment.difference) : balanceCopy.noAdjustment}
              icon={Pencil}
            />
          </div>
          {lastAdjustment ? (
            <p className="section-note">
              {balanceCopy.adjustedOn}: {lastAdjustment.updatedAt.slice(0, 10)}
              {lastAdjustment.note ? ` - ${lastAdjustment.note}` : ''}
            </p>
          ) : null}
          <div className="form-grid compact">
            <InputField label={balanceCopy.newBalance} type="number" value={balanceAdjustmentValue} onChange={setBalanceAdjustmentValue} hint={fmtMoney(currentAvailableBalance)} />
            <InputField label={balanceCopy.adjustmentReason} value={balanceAdjustmentNote} onChange={setBalanceAdjustmentNote} hint={balanceCopy.notePlaceholder} />
          </div>
          <button className="primary-button" onClick={() => void saveBalanceCorrection(currentAvailableBalance)} disabled={actionsDisabled || !balanceAdjustmentValue.trim()}>
            <Pencil size={16} />
            {balanceCopy.saveAdjustment}
          </button>
        </SectionCard>

        <SectionCard title={text.budget.summaryTitle} subtitle={text.budget.summarySubtitle}>
          <div className="metric-grid">
            <MetricTile label={text.budget.openingAvailableBalance} value={fmtMoney(budgetSummary?.availableBalance ?? 0)} icon={Wallet} />
            <MetricTile label={text.budget.expectedIncome} value={fmtMoney(budgetSummary?.expectedIncome ?? 0)} icon={TrendingUp} />
            <MetricTile label={text.budget.totalIncomeAvailable} value={fmtMoney(budgetSummary?.totalAvailableIncome ?? 0)} icon={ArrowUpCircle} />
            <MetricTile label={text.budget.totalCommitmentsOnly} value={fmtMoney(budgetSummary?.totalCommitments ?? 0)} icon={Landmark} />
            <MetricTile label={text.budget.variableSpentToDate} value={fmtMoney(budgetSummary?.variableSpentSoFar ?? 0)} icon={ArrowDownCircle} />
            <MetricTile label={text.budget.flexibleBalanceRemaining} value={fmtMoney(budgetSummary?.remainingFlexible ?? 0)} icon={Goal} />
          </div>
          <div className="forecast-list">
            <ExplainedMetricLine label={text.budget.openingAvailableBalance} value={fmtMoney(budgetSummary?.availableBalance ?? 0)} help={helpCopy.availableBalance} onHelp={(title, body) => setHelpDialog({ title, body })} />
            <ExplainedMetricLine label={text.budget.expectedIncome} value={fmtMoney(budgetSummary?.expectedIncome ?? 0)} help={helpCopy.expectedIncome} onHelp={(title, body) => setHelpDialog({ title, body })} />
            <ExplainedMetricLine label={text.budget.totalIncomeAvailable} value={fmtMoney(budgetSummary?.totalAvailableIncome ?? 0)} help={helpCopy.totalAvailable} onHelp={(title, body) => setHelpDialog({ title, body })} />
            <ExplainedMetricLine label={text.budget.totalCommitmentsOnly} value={fmtMoney(budgetSummary?.totalCommitments ?? 0)} help={helpCopy.commitments} onHelp={(title, body) => setHelpDialog({ title, body })} />
            <ExplainedMetricLine label={text.budget.flexibleBalanceRemaining} value={fmtMoney(budgetSummary?.remainingFlexible ?? 0)} help={helpCopy.flexibleRemaining} onHelp={(title, body) => setHelpDialog({ title, body })} />
          </div>
          {hasCommitmentsOverflow ? <p className="section-note">{text.budget.commitmentsOverflowWarning}</p> : null}
        </SectionCard>

        <SectionCard title={text.budget.commitmentsTitle} subtitle={text.budget.commitmentsSubtitle}>
          <div className="forecast-list">
            <ExplainedMetricLine label={text.budget.fixedExpenses} value={fmtMoney(budgetSummary?.fixedExpenses ?? 0)} help={helpCopy.commitments} onHelp={(title, body) => setHelpDialog({ title, body })} />
            <ExplainedMetricLine label={text.budget.debtInstallments} value={fmtMoney(budgetSummary?.debtInstallments ?? 0)} help={helpCopy.commitments} onHelp={(title, body) => setHelpDialog({ title, body })} />
            <ExplainedMetricLine label={text.budget.recurringRequiredExpenses} value={fmtMoney(budgetSummary?.requiredRecurringExpenses ?? 0)} help={helpCopy.commitments} onHelp={(title, body) => setHelpDialog({ title, body })} />
            <ExplainedMetricLine label={text.budget.totalCommitmentsOnly} value={fmtMoney(budgetSummary?.totalCommitments ?? 0)} help={helpCopy.commitments} onHelp={(title, body) => setHelpDialog({ title, body })} />
          </div>
        </SectionCard>

        <SectionCard title={text.budget.smartPlannerTitle} subtitle={budgetSummary?.isPastPeriod ? text.budget.smartPlannerPastSubtitle : text.budget.smartPlannerSubtitle}>
          <div className="metric-grid">
            <MetricTile label={text.budget.selectedPeriod} value={budgetPlannerPeriodLabel} icon={CalendarRange} />
            <MetricTile label={text.budget.plannerStatus} value={plannerStatusLabel} icon={Wallet} />
            <MetricTile label={text.budget.remainingDaysInPeriod} value={String(budgetSummary?.remainingDaysInPeriod ?? 0)} icon={TrendingDown} />
            <MetricTile label={text.budget.flexibleBalanceRemaining} value={fmtMoney(budgetSummary?.remainingFlexible ?? 0)} icon={Goal} />
          </div>
          <div className="forecast-list">
            <MetricLine label={text.budget.balanceAfterCommitments} value={fmtMoney(budgetSummary?.balanceAfterCommitments ?? 0)} />
            <MetricLine label={text.budget.variableSpentToDate} value={fmtMoney(budgetSummary?.variableSpentSoFar ?? 0)} />
            <MetricLine label={text.budget.flexibleBalanceRemaining} value={fmtMoney(budgetSummary?.remainingFlexible ?? 0)} />
            <ExplainedMetricLine label={text.budget.allowedMonthly} value={fmtMoney(budgetSummary?.allowedMonthlySpending ?? 0)} help={helpCopy.allowedSpend} onHelp={(title, body) => setHelpDialog({ title, body })} />
            <ExplainedMetricLine label={text.budget.allowedWeekly} value={fmtMoney(budgetSummary?.allowedWeeklySpending ?? 0)} help={helpCopy.allowedSpend} onHelp={(title, body) => setHelpDialog({ title, body })} />
            <ExplainedMetricLine label={text.budget.allowedDaily} value={fmtMoney(budgetSummary?.allowedDailySpending ?? 0)} help={helpCopy.allowedSpend} onHelp={(title, body) => setHelpDialog({ title, body })} />
          </div>
        </SectionCard>

        <SectionCard title={text.budget.formulaTitle} subtitle={text.budget.formulaSubtitle}>
          <div className="forecast-list">
            <MetricLine label={text.budget.totalIncomeAvailable} value={`${text.budget.openingAvailableBalance} + ${text.budget.expectedIncome}`} />
            <MetricLine label={text.budget.balanceAfterCommitments} value={`${text.budget.totalIncomeAvailable} - ${text.budget.totalCommitmentsOnly}`} />
            <MetricLine label={text.budget.allowedMonthly} value={`${text.budget.balanceAfterCommitments} - ${text.budget.variableSpentToDate}`} />
          </div>
          {hasCommitmentsOverflow ? <p className="section-note">{text.budget.commitmentsOverflowWarning}</p> : null}
        </SectionCard>

      </div>
    )
  }

  const renderGoals = () => (
    <div className="screen-grid">
      <div className="two-column-grid">
        <SectionCard title={text.goals.addTitle} subtitle={text.goals.addSubtitle}>
          <div className="form-grid">
            <InputField label={text.goals.name} value={goalForm.name} onChange={(value) => setGoalForm({ ...goalForm, name: value })} error={goalErrors.name} />
            <SelectField label={text.goals.type} value={goalForm.type} options={(['general', 'emergency-fund', 'travel', 'device', 'debt-payoff', 'large-purchase'] as const).map((value) => ({ label: translateGoalType(value, language), value }))} onChange={(value) => setGoalForm({ ...goalForm, type: value as SaveGoalInput['type'] })} />
            <InputField label={text.goals.targetAmount} type="number" value={goalForm.targetAmount} onChange={(value) => setGoalForm({ ...goalForm, targetAmount: parseDecimalInput(value) })} error={goalErrors.targetAmount} />
            <InputField label={text.goals.openingAmount} type="number" value={goalForm.currentAmount} onChange={(value) => setGoalForm({ ...goalForm, currentAmount: parseDecimalInput(value) })} />
            <InputField label={text.goals.targetDate} type="date" value={goalForm.targetDate} onChange={(value) => setGoalForm({ ...goalForm, targetDate: value })} />
            <SelectField label={text.goals.priority} value={goalForm.priority} options={(['high', 'medium', 'low'] as const).map((value) => ({ label: translatePriority(value, language), value }))} onChange={(value) => setGoalForm({ ...goalForm, priority: value as SaveGoalInput['priority'] })} />
            <TextAreaField label={text.goals.notes} value={goalForm.notes} onChange={(value) => setGoalForm({ ...goalForm, notes: value })} />
            <button className="primary-button" onClick={() => void handleGoalSubmit()} disabled={actionsDisabled || Boolean(goalErrors.name || goalErrors.targetAmount)}>
              <Plus size={16} />
              {goalForm.id ? text.common.edit : text.goals.saveAction}
            </button>
            {goalForm.id ? <button className="ghost-button" onClick={resetGoalForm}>{text.common.cancel}</button> : null}
          </div>
        </SectionCard>

        <SectionCard title={text.goals.insightsTitle} subtitle={text.goals.insightsSubtitle}>
          <div className="goal-insights">
            {snapshot.analytics.goalInsights.map((goal) => (
              <div key={goal.goalId} className="goal-insight-card">
                <strong>{goal.name}</strong>
                <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.min(goal.completionPercent, 100)}%` }} /></div>
                <p>{text.goals.current}: {fmtMoney(goal.currentAmount)}</p>
                <p>{text.goals.requiredMonthlyContribution}: {fmtMoney(goal.monthlyRequiredContribution)}</p>
                <p>{text.goals.requiredWeeklyContribution}: {fmtMoney(goal.weeklyRequiredContribution)}</p>
                <p>{text.goals.goalStatus}: {text.goals.statuses[goal.status]}</p>
                <p>{text.goals.estimatedCompletion}: {goal.estimatedCompletionDate}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard title={text.goals.addContribution} subtitle={text.goals.contributionHistory}>
        <div className="form-grid">
          <SelectField label={text.goals.name} value={goalContributionForm.goalId} options={snapshot.goals.map((goal) => ({ label: goal.name, value: goal.id }))} onChange={(value) => setGoalContributionForm({ ...goalContributionForm, goalId: value })} />
          <SelectField
            label={text.expenses.category}
            value={goalContributionForm.categoryId ?? 'savings'}
            options={snapshot.categories.map((entry) => ({ label: translateCategoryName(entry, language), value: entry.id }))}
            onChange={(value) => setGoalContributionForm({ ...goalContributionForm, categoryId: value })}
          />
          <InputField label={text.goals.contributionAmount} type="number" value={goalContributionForm.amount} onChange={(value) => setGoalContributionForm({ ...goalContributionForm, amount: parseDecimalInput(value) })} />
          <InputField label={text.goals.contributionDate} type="date" value={goalContributionForm.date} onChange={(value) => setGoalContributionForm({ ...goalContributionForm, date: value })} />
          <SelectField
            label={text.expenses.paymentMethod}
            value={goalContributionForm.paymentMethod ?? 'transfer'}
            options={(['card', 'bank', 'cash', 'wallet', 'transfer'] as const).map((value) => ({ label: translatePaymentMethod(value, language), value }))}
            onChange={(value) => setGoalContributionForm({ ...goalContributionForm, paymentMethod: value as SaveGoalContributionInput['paymentMethod'] })}
          />
          <TextAreaField label={text.goals.contributionNotes} value={goalContributionForm.notes} onChange={(value) => setGoalContributionForm({ ...goalContributionForm, notes: value })} />
          <button className="primary-button" onClick={() => void handleGoalContributionSubmit()} disabled={actionsDisabled || !goalContributionForm.goalId || goalContributionForm.amount <= 0}>
            <Plus size={16} />
            {text.goals.addContribution}
          </button>
        </div>
      </SectionCard>

      <SectionCard title={text.goals.currentGoalsTitle} subtitle={text.goals.currentGoalsSubtitle}>
        <div className="goal-grid">
          {snapshot.goals.map((goal) => {
            const insight = snapshot.analytics.goalInsights.find((entry) => entry.goalId === goal.id)
            const contributions = snapshot.goalContributions.filter((entry) => entry.goalId === goal.id)
            return (
              <div key={goal.id} className="goal-card">
                <div className="goal-card-header">
                  <div><h3>{goal.name}</h3><p>{translateGoalType(goal.type, language)}</p></div>
                  <Badge label={translatePriority(goal.priority, language)} />
                </div>
                <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.min(insight?.completionPercent ?? 0, 100)}%` }} /></div>
                <div className="goal-metrics">
                  <MetricLine label={text.goals.openingAmount} value={fmtMoney(goal.currentAmount)} />
                  <MetricLine label={text.goals.current} value={fmtMoney(insight?.currentAmount ?? goal.currentAmount)} />
                  <MetricLine label={text.goals.target} value={fmtMoney(goal.targetAmount)} />
                  <MetricLine label={text.goals.remaining} value={fmtMoney(insight?.remainingAmount ?? goal.targetAmount - goal.currentAmount)} />
                  <MetricLine label={text.goals.requiredMonthlyContribution} value={fmtMoney(insight?.monthlyRequiredContribution ?? 0)} />
                  <MetricLine label={text.goals.requiredWeeklyContribution} value={fmtMoney(insight?.weeklyRequiredContribution ?? 0)} />
                  <MetricLine label={text.goals.goalStatus} value={insight ? text.goals.statuses[insight.status] : text.goals.statuses['on-track']} />
                </div>
                <div className="timeline-list">
                  {contributions.slice(0, 3).map((entry) => (
                    <div key={entry.id} className="timeline-item">
                      <strong>{fmtMoney(entry.amount)}</strong>
                      <span>{entry.date}</span>
                      <small>{entry.notes || text.goals.addContribution}</small>
                    </div>
                  ))}
                </div>
                <div className="toolbar">
                  <button className="ghost-button" onClick={() => beginEditGoal(goal)}><Pencil size={14} />{text.common.edit}</button>
                  <button className="ghost-button" onClick={() => void performAction(text.goals.deleteAction, () => bridge.deleteGoal(goal.id))}>{text.goals.deleteAction}</button>
                </div>
              </div>
            )
          })}
        </div>
      </SectionCard>
    </div>
  )

  const renderDebts = () => (
    <div className="screen-grid">
      <div className="two-column-grid">
        <SectionCard title={text.debts.title} subtitle={text.debts.subtitle}>
          <div className="form-grid">
            <InputField label={text.debts.name} value={debtForm.name} onChange={(value) => setDebtForm({ ...debtForm, name: value })} error={debtErrors.name} />
            <InputField label={text.debts.totalAmount} type="number" value={debtForm.totalAmount} onChange={(value) => setDebtForm({ ...debtForm, totalAmount: parseDecimalInput(value) })} error={debtErrors.totalAmount} />
            <InputField label={text.debts.installmentAmount} type="number" value={debtForm.installmentAmount} onChange={(value) => setDebtForm({ ...debtForm, installmentAmount: parseDecimalInput(value) })} />
            <InputField label={text.debts.startDate} type="date" value={debtForm.startDate} onChange={(value) => setDebtForm({ ...debtForm, startDate: value })} />
            <InputField label={text.debts.endDate} type="date" value={debtForm.endDate ?? ''} onChange={(value) => setDebtForm({ ...debtForm, endDate: value || null })} />
            <InputField label={text.debts.desiredPayoffDate} type="date" value={debtForm.desiredPayoffDate ?? ''} onChange={(value) => setDebtForm({ ...debtForm, desiredPayoffDate: value || null })} />
            <SelectField
              label={text.debts.paymentFrequency}
              value={debtForm.paymentFrequency}
              options={[
                { label: text.debts.monthly, value: 'monthly' },
                { label: text.debts.weekly, value: 'weekly' }
              ]}
              onChange={(value) => setDebtForm({ ...debtForm, paymentFrequency: value as SaveDebtInput['paymentFrequency'] })}
            />
            <SelectField
              label={text.expenses.category}
              value={debtForm.categoryId}
              options={snapshot.categories.map((entry) => ({ label: translateCategoryName(entry, language), value: entry.id }))}
              onChange={(value) => setDebtForm({ ...debtForm, categoryId: value })}
            />
            <ToggleField label={text.debts.recurringAutomatically} checked={debtForm.recurringAutomatically} onChange={(checked) => setDebtForm({ ...debtForm, recurringAutomatically: checked })} />
            <TextAreaField label={text.debts.notes} value={debtForm.notes} onChange={(value) => setDebtForm({ ...debtForm, notes: value })} />
            <button className="primary-button" onClick={() => void handleDebtSubmit()} disabled={actionsDisabled || Boolean(debtErrors.name || debtErrors.totalAmount)}>
              <Plus size={16} />
              {debtForm.id ? text.common.edit : text.debts.saveAction}
            </button>
            {debtForm.id ? <button className="ghost-button" onClick={resetDebtForm}>{text.common.cancel}</button> : null}
          </div>
        </SectionCard>

        <SectionCard title={text.debts.summaryTitle} subtitle={text.debts.summarySubtitle}>
          <div className="forecast-list">
            <MetricLine label={text.debts.activeDebts} value={String(snapshot.analytics.debtInsights.filter((entry) => entry.status === 'active').length)} />
            <MetricLine label={text.debts.completedDebts} value={String(snapshot.analytics.debtInsights.filter((entry) => entry.status === 'completed').length)} />
            <MetricLine
              label={text.debts.remainingBalance}
              value={fmtMoney(snapshot.analytics.debtInsights.filter((entry) => entry.status === 'active').reduce((sum, entry) => sum + entry.remainingBalance, 0))}
            />
            <MetricLine
              label={text.debts.nextPayment}
              value={snapshot.analytics.debtInsights.find((entry) => entry.status === 'active')?.nextPaymentDate ?? text.common.no}
            />
          </div>
        </SectionCard>
      </div>

      <SectionCard title={text.debts.activeDebtsTitle} subtitle={text.debts.activeDebtsSubtitle}>
        <div className="goal-grid">
          {snapshot.analytics.debtInsights.map((debt) => (
            <div key={debt.debtId} className="goal-card">
              <div className="goal-card-header">
                <div><h3>{debt.name}</h3><p>{debt.status === 'completed' ? text.debts.completed : text.debts.active}</p></div>
                <Badge label={debt.status === 'completed' ? text.debts.completed : text.debts.active} />
              </div>
              <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.min(debt.progressPercent, 100)}%` }} /></div>
              <div className="goal-metrics">
                <MetricLine label={text.debts.totalAmount} value={fmtMoney(debt.totalAmount)} />
                <MetricLine label={text.debts.paidSoFar} value={fmtMoney(debt.paidSoFar)} />
                <MetricLine label={text.debts.remainingBalance} value={fmtMoney(debt.remainingBalance)} />
                <MetricLine label={text.debts.installmentsRemaining} value={String(debt.installmentsRemaining)} />
                <MetricLine label={text.debts.installmentAmount} value={fmtMoney(debt.installmentAmount)} />
                <MetricLine label={text.debts.requiredInstallment} value={fmtMoney(debt.requiredInstallmentAmount)} />
                <MetricLine label={text.debts.payoffDate} value={debt.payoffDate ?? text.common.no} />
                <MetricLine label={text.debts.nextPayment} value={debt.nextPaymentDate ?? text.common.no} />
                <MetricLine label={text.debts.progress} value={`${debt.progressPercent.toFixed(1)}%`} />
              </div>
              <p>{debt.isInstallmentEnough ? text.debts.onTrack : text.debts.needsHigherInstallment}</p>
              <div className="toolbar">
                <button className="ghost-button" onClick={() => {
                  const debtRecord = snapshot.debts.find((entry) => entry.id === debt.debtId)
                  if (debtRecord) beginEditDebt(debtRecord)
                }}><Pencil size={14} />{text.common.edit}</button>
                <button className="ghost-button" onClick={() => void performAction(text.common.delete, () => bridge.deleteDebt(debt.debtId))}>{text.common.delete}</button>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  )

  const renderSettings = () => (
    <div className="screen-grid">
      <div className="two-column-grid">
        <SectionCard title={text.settings.appTitle} subtitle={text.settings.appSubtitle}>
          <div className="form-grid">
            <SelectField label={text.settings.language} value={settings.language} options={[{ label: text.settings.languageArabic, value: 'ar' }, { label: text.settings.languageEnglish, value: 'en' }]} onChange={(value) => void updateSettings(applyLanguageToSettings(settings, value as Settings['language']))} />
            <SelectField label={text.settings.currency} value={settings.currency} options={currencyOptions.map((value) => ({ label: value, value }))} onChange={(value) => void updateSettings({ ...settings, currency: value.toUpperCase() })} />
            <SelectField label={text.settings.theme} value={settings.theme} options={[{ label: text.themes.dark, value: 'dark' }, { label: text.themes.light, value: 'light' }]} onChange={(value) => void updateSettings({ ...settings, theme: value as Settings['theme'] })} />
            <InputField label={text.settings.financialMonthStart} type="number" value={settings.financialMonthStartDay} onChange={(value) => void updateSettings({ ...settings, financialMonthStartDay: Number(value) })} />
            <ToggleField label={text.settings.smartNotifications} checked={settings.notificationsEnabled} onChange={(checked) => void updateSettings({ ...settings, notificationsEnabled: checked })} />
            <ToggleField
              label={text.settings.includeGoalsInForecast}
              checked={settings.includeOptionalGoalsInForecast}
              onChange={(checked) => void updateSettings({ ...settings, includeOptionalGoalsInForecast: checked })}
            />
          </div>
        </SectionCard>

        <SectionCard
          title={text.settings.syncTitle}
          subtitle={text.settings.syncSubtitle}
          action={syncStatus ? <Badge label={syncConnectionLabel} color={syncStatus.backendReachable ? '#10b981' : '#f59e0b'} /> : undefined}
        >
          <div className="forecast-list">
            <MetricLine label={text.settings.syncStatus} value={syncPhaseLabel} />
            <MetricLine label={text.settings.syncConnection} value={syncConnectionLabel} />
            <MetricLine label={text.settings.syncLastSync} value={syncStatus?.lastSyncAt ? new Date(syncStatus.lastSyncAt).toLocaleString(settings.locale) : text.settings.syncNever} />
            <MetricLine label={text.settings.syncPendingChanges} value={String(syncStatus?.pendingChanges ?? 0)} />
            <MetricLine label={text.settings.syncBackendUrl} value={syncStatus?.backendUrl ?? text.settings.syncNotConfigured} />
            <MetricLine label={text.settings.syncDevice} value={syncStatus?.deviceId ?? text.settings.syncNotAvailable} />
            <MetricLine label={text.settings.syncAuthMode} value={syncStatus?.authMode === 'password' ? text.settings.authPassword : syncStatus?.authMode === 'dev-session' ? text.settings.authDevSession : text.settings.syncNotAvailable} />
            <MetricLine label={text.settings.syncAccount} value={syncStatus?.accountEmail ?? text.settings.syncNotAvailable} />
            {syncStatus?.lastError ? <MetricLine label={text.settings.syncError} value={syncStatus.lastError} /> : null}
          </div>
          <div className="toolbar wrap sync-action-toolbar">
            <button
              className="primary-button sync-action-button"
              onClick={() => {
                console.log('SYNC BUTTON ACTUAL CLICK')
                void runManualSync()
              }}
              disabled={actionsDisabled || !bridge}
            >
              <RefreshCw size={16} />
              {text.settings.syncNow}
            </button>
            <button
              className="secondary-button sync-action-button"
              onClick={() => {
                console.log('UPLOAD ALL BUTTON ACTUAL CLICK')
                console.info('[renderer] Open full upload confirmation')
                setFullUploadDialogOpen(true)
              }}
              disabled={actionsDisabled || !bridge}
            >
              {text.settings.uploadAllLocalData}
            </button>
            <button
              className="secondary-button sync-action-button"
              onClick={() => {
                console.log('REFRESH BUTTON ACTUAL CLICK')
                void refreshSyncStatus()
              }}
              disabled={actionsDisabled}
            >
              {text.settings.refreshSyncStatus}
            </button>
          </div>
          <ToggleField label={text.settings.pauseSyncToggle} checked={Boolean(syncStatus?.paused)} onChange={(checked) => void updateSyncPaused(checked)} />
          <p className="section-note">
            {syncStatus?.enabled ? text.settings.syncLocalFirstNote : text.settings.syncDisabledNote}
          </p>
        </SectionCard>

        <SectionCard title={text.settings.categoryTitle} subtitle={text.settings.categorySubtitle}>
          <div className="form-grid">
            <InputField label={text.settings.categoryName} value={categoryForm.name} onChange={(value) => setCategoryForm({ ...categoryForm, name: value })} />
            <SelectField
              label={text.settings.categoryType}
              value={categoryForm.type}
              options={(['custom', 'essential', 'lifestyle', 'saving', 'debt'] as const).map((value) => ({ label: translateCategoryType(value, language), value }))}
              onChange={(value) => setCategoryForm({ ...categoryForm, type: value as Category['type'] })}
            />
            <InputField label={text.settings.color} value={categoryForm.color} onChange={(value) => setCategoryForm({ ...categoryForm, color: value })} hint={text.settings.colorHint} />
            <SelectField label={text.settings.icon} value={categoryForm.icon} options={iconOptions.map((value) => ({ label: value, value }))} onChange={(value) => setCategoryForm({ ...categoryForm, icon: value })} />
            <InputField label={text.settings.monthlyLimit} type="number" value={categoryForm.monthlyLimit ?? 0} onChange={(value) => setCategoryForm({ ...categoryForm, monthlyLimit: parseDecimalInput(value) })} />
            <button className="primary-button" onClick={() => void handleCategorySubmit()} disabled={actionsDisabled || !categoryForm.name.trim()}>
              <Plus size={16} />
              {editingCategoryId ? text.settings.updateCategory : text.settings.saveCategory}
            </button>
            {editingCategoryId ? <button className="ghost-button" onClick={() => { setEditingCategoryId(null); setCategoryForm(createCategoryForm()) }}>{text.common.cancel}</button> : null}
          </div>
        </SectionCard>
      </div>

      <div className="two-column-grid">
        <SectionCard title={text.settings.dataToolsTitle} subtitle={text.settings.dataToolsSubtitle}>
          <div className="toolbar wrap">
            <button className="primary-button" onClick={() => void performAction(text.settings.loadDemo, () => bridge.seedDemoData())}><RefreshCw size={16} />{text.settings.loadDemo}</button>
            <button className="secondary-button" onClick={() => void performAction(text.settings.importCsv, () => bridge.importData('csv'))}>{text.settings.importCsv}</button>
            <button className="secondary-button" onClick={() => void performAction(text.settings.importExcel, () => bridge.importData('xlsx'))}>{text.settings.importExcel}</button>
            <button className="ghost-button" onClick={() => setResetDialogOpen(true)}>{text.settings.reset}</button>
          </div>
        </SectionCard>

        <SectionCard title={text.settings.currentCategoriesTitle} subtitle={text.settings.currentCategoriesSubtitle}>
          <div className="category-grid">
            {snapshot.categories.map((category) => (
              <div key={category.id} className="category-tile">
                <span className="color-dot" style={{ backgroundColor: category.color }} />
                <div>
                  <strong>{translateCategoryName(category, language)}</strong>
                  <p>{category.monthlyLimit ? fmtMoney(category.monthlyLimit) : text.common.noLimit}</p>
                  <small>{translateCategoryType(category.type, language)} · {category.builtIn ? text.common.builtIn : text.common.custom}</small>
                </div>
                <div className="toolbar">
                  <button className="ghost-button" onClick={() => beginEditCategory(category)}><Pencil size={14} />{text.common.edit}</button>
                  <button className="ghost-button" onClick={() => void openCategoryDeletionDialog(category)}>{text.common.delete}</button>
                </div>
              </div>
            ))}
          </div>
          <p className="section-note">{text.settings.editBuiltInHint}</p>
        </SectionCard>
      </div>
    </div>
  )

  const contentByTab: Record<TabKey, ReactNode> = {
    dashboard: (
      <Suspense fallback={<ScreenSkeleton />}>
        <DashboardScreen
          snapshot={snapshot}
          fmtMoney={fmtMoney}
          actionsDisabled={actionsDisabled}
          performAction={performAction}
          setActiveTab={(tab) => setActiveTab(tab)}
          budgetMethodLabels={budgetMethodLabels}
          language={language}
          text={text}
        />
      </Suspense>
    ),
    income: renderIncome(),
    expenses: renderExpenses(),
    budget: renderBudget(),
    reports: (
      <Suspense fallback={<ScreenSkeleton />}>
        <ReportsScreen
          snapshot={snapshot}
          fmtMoney={fmtMoney}
          actionsDisabled={actionsDisabled}
          performAction={performAction}
          filteredExpenses={filteredExpenses}
          expensePeriodLabel={expensePeriodLabel}
          expensePeriodTotal={expensePeriodTotal}
          expensePeriodAverageDaily={expensePeriodAverageDaily}
          expensePeriodChart={expensePeriodChart}
          language={language}
          text={text}
          onExport={(format) => void bridge.exportData(format)}
          onImport={(format) => void performAction(format, () => bridge.importData(format))}
          onMonthlyClose={(month) => void performAction(text.reports.monthlyCloseTitle, () => bridge.runMonthlyClose(month))}
        />
      </Suspense>
    ),
    goals: renderGoals(),
    debts: renderDebts(),
    settings: renderSettings()
  }

  return (
    <div className={`app-shell theme-${settings.theme}`} dir={settings.rtl ? 'rtl' : 'ltr'}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">MW</div>
          <div>
            <h1>{text.appName}</h1>
            <p>{text.appTagline}</p>
          </div>
        </div>

        <nav className="nav-list">
          {nav.map((item) => {
            const Icon = item.icon
            return (
              <button key={item.key} className={`nav-item ${activeTab === item.key ? 'active' : ''}`} onClick={() => setActiveTab(item.key)}>
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="footer-card">
            <span>{text.budget.healthScore}</span>
            <strong>{dashboard.budgetHealthScore.toFixed(0)} / 100</strong>
            <small>
              {dashboard.riskLevel === 'low'
                ? text.topbar.stablePlan
                : dashboard.riskLevel === 'moderate'
                  ? text.topbar.reviewPlan
                  : text.topbar.interventionPlan}
            </small>
          </div>
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <span className="eyebrow">{text.topbar.month} {dashboard.month}</span>
            <h2>{nav.find((item) => item.key === activeTab)?.label}</h2>
          </div>
          <div className="topbar-actions">
            {busyLabel ? <span className="status-chip busy">{busyLabel}</span> : null}
            {statusMessage ? <span className="status-chip">{statusMessage}</span> : null}
            {actionError ? <span className="status-chip error">{actionError}</span> : null}
            {syncStatus ? <span className={`status-chip ${syncStatus.phase === 'error' ? 'error' : syncStatus.phase === 'syncing' ? 'busy' : ''}`}>{syncTopbarLabel}</span> : null}
            <span className="status-chip">{settings.currency}</span>
            <span className="status-chip">{translateRiskLevel(dashboard.riskLevel, language)}</span>
          </div>
        </header>

        {contentByTab[activeTab]}
      </main>

      {pendingGoalLinkExpense ? (
        <div className="dialog-overlay">
          <div className="dialog-card">
            <h3>{text.expenses.goalLinkDecisionTitle}</h3>
            <p>{text.expenses.goalLinkDecisionDescription}</p>
            <div className="form-grid compact">
              <SelectField label={text.expenses.goalLink} value={goalLinkPromptGoalId} options={snapshot.goals.map((goal) => ({ label: goal.name, value: goal.id }))} onChange={setGoalLinkPromptGoalId} />
            </div>
            <div className="toolbar">
              <button className="primary-button" onClick={() => void confirmGoalExpenseLink('convert')} disabled={!goalLinkPromptGoalId}>
                {text.expenses.convertToSavingAndLink}
              </button>
              <button className="secondary-button" onClick={() => void confirmGoalExpenseLink('keep')} disabled={!goalLinkPromptGoalId}>
                {text.expenses.keepCategoryAndLink}
              </button>
              <button className="ghost-button" onClick={() => setPendingGoalLinkExpense(null)}>
                {text.common.cancel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {categoryDeletionImpact ? (
        <div className="dialog-overlay">
          <div className="dialog-card">
            <h3>{text.settings.deleteDialogTitle}</h3>
            <p>{text.settings.deleteDialogDescription}</p>
            <div className="forecast-list">
              <MetricLine label={text.settings.linkedExpenses} value={String(categoryDeletionImpact.expenseCount)} />
              <MetricLine label={text.settings.linkedBudgets} value={String(categoryDeletionImpact.budgetRuleCount)} />
              <MetricLine label={text.settings.linkedRecurring} value={String(categoryDeletionImpact.recurringCount)} />
              <MetricLine label={text.settings.affectedAmount} value={fmtMoney(categoryDeletionImpact.affectedReportAmount)} />
            </div>
            <div className="form-grid compact">
              <SelectField
                label={text.common.actions}
                value={categoryDeletionMode}
                options={[
                  { label: text.settings.fallbackData, value: 'fallback' },
                  { label: text.settings.reassignData, value: 'reassign' }
                ]}
                onChange={(value) => setCategoryDeletionMode(value as DeleteCategoryInput['mode'])}
              />
              {categoryDeletionMode === 'reassign' ? (
                <SelectField
                  label={text.settings.targetCategory}
                  value={categoryDeletionTargetId}
                  options={categoryDeletionImpact.availableTargetCategories.map((entry) => ({
                    label: translateCategoryName(snapshot.categories.find((category) => category.id === entry.id) ?? { id: entry.id, name: entry.name, builtIn: entry.builtIn, type: 'custom', color: '#64748b', icon: 'folder', monthlyLimit: null }, language),
                    value: entry.id
                  }))}
                  onChange={setCategoryDeletionTargetId}
                />
              ) : null}
            </div>
            <div className="toolbar">
              <button className="primary-button" onClick={() => void confirmCategoryDeletion()} disabled={categoryDeletionMode === 'reassign' && !categoryDeletionTargetId}>
                {text.settings.confirmDeleteCategory}
              </button>
              <button className="ghost-button" onClick={() => setCategoryDeletionImpact(null)}>
                {text.common.cancel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {resetDialogOpen ? (
        <div className="dialog-overlay">
          <div className="dialog-card">
            <h3>{text.settings.resetDialogTitle}</h3>
            <p>{text.settings.resetDialogDescription}</p>
            <div className="toolbar">
              <button className="primary-button" onClick={() => void confirmResetData()}>
                {text.settings.confirmReset}
              </button>
              <button className="ghost-button" onClick={() => setResetDialogOpen(false)}>
                {text.common.cancel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {fullUploadDialogOpen ? (
        <div className="dialog-overlay">
          <div className="dialog-card">
            <h3>{text.settings.fullUploadDialogTitle}</h3>
            <p>{text.settings.fullUploadDialogDescription}</p>
            <div className="toolbar">
              <button
                className="primary-button"
                onClick={() => {
                  console.log('UPLOAD ALL CONFIRM BUTTON ACTUAL CLICK')
                  void uploadAllLocalData()
                }}
              >
                {text.settings.confirmFullUpload}
              </button>
              <button className="ghost-button" onClick={() => setFullUploadDialogOpen(false)}>
                {text.common.cancel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {helpDialog ? (
        <div className="dialog-overlay">
          <div className="dialog-card help-dialog">
            <h3>{helpDialog.title}</h3>
            {helpDialog.body.split('\n').map((line) => (
              <p key={line}>{line}</p>
            ))}
            <div className="toolbar">
              <button className="primary-button" onClick={() => setHelpDialog(null)}>
                {language === 'ar' ? 'حسنًا' : 'OK'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
