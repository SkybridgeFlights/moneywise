import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  differenceInCalendarWeeks,
  differenceInMonths,
  format,
  parseISO,
  startOfDay
} from 'date-fns'
import { defaultSettings } from './defaults'
import { financeCopy, getCategoryDisplayName } from './i18n'
import { allocateMoney, decimalToHundredths, divideMoney, multiplyMoneyByBasisPoints, percentageToBasisPoints } from './money'
import type {
  AlertItem,
  AnalyticsSnapshot,
  BudgetMethod,
  BudgetPlan,
  Category,
  CategoryBudgetInsight,
  DashboardMetrics,
  DebtInsight,
  DebtRecord,
  ExpenseRecord,
  Goal,
  GoalContribution,
  GoalInsight,
  IncomeRecord,
  MonthlySummary,
  SmartSpendingPlanner,
  Settings
} from './types'

interface FinanceInput {
  incomes: IncomeRecord[]
  expenses: ExpenseRecord[]
  categories: Category[]
  goals: Goal[]
  goalContributions: GoalContribution[]
  debts: DebtRecord[]
  budgetPlans: BudgetPlan[]
  settings?: Settings
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
const safeDivide = (value: number, total: number): number => (total <= 0 ? 0 : value / total)
const round2 = (value: number): number => Math.round(value)
const roundMetric2 = (value: number): number => Math.round(value * 100) / 100
const isSameOrBefore = (left: Date, right: Date): boolean => left.getTime() <= right.getTime()
const isDevLoggingEnabled = (): boolean => typeof process !== 'undefined' && process.env.NODE_ENV !== 'production'

function monthIdFromDate(date: string, settings: Settings): string {
  const parsed = parseISO(date)
  const normalized = new Date(parsed.getFullYear(), parsed.getMonth(), 1)
  if (settings.financialMonthStartDay > 1 && parsed.getDate() < settings.financialMonthStartDay) {
    normalized.setMonth(normalized.getMonth() - 1)
  }
  return format(normalized, 'yyyy-MM')
}

function getCurrentMonth(settings: Settings): string {
  return monthIdFromDate(format(new Date(), 'yyyy-MM-dd'), settings)
}

const monthToDate = (month: string): Date => parseISO(`${month}-01`)

function monthRange(month: string, settings: Settings): { start: Date; end: Date } {
  const monthDate = monthToDate(month)
  const startDay = settings.financialMonthStartDay
  const start = new Date(monthDate.getFullYear(), monthDate.getMonth(), startDay)
  const end = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, startDay - 1)
  return { start, end }
}

function getBudgetMethod(plan: BudgetPlan | undefined, settings: Settings): BudgetMethod {
  return plan?.method ?? settings.defaultBudgetMethod
}

function buildMonthlySummaries(
  incomes: IncomeRecord[],
  expenses: ExpenseRecord[],
  categories: Category[],
  settings: Settings
): MonthlySummary[] {
  const months = new Set<string>()
  incomes.forEach((entry) => months.add(monthIdFromDate(entry.date, settings)))
  expenses.forEach((entry) => months.add(monthIdFromDate(entry.date, settings)))
  if (months.size === 0) {
    months.add(getCurrentMonth(settings))
  }

  let carryOver = 0
  const debtCategoryIds = new Set(categories.filter((entry) => entry.type === 'debt').map((entry) => entry.id))
  const savingsCategoryIds = new Set(categories.filter((entry) => entry.type === 'saving').map((entry) => entry.id))

  return [...months]
    .sort()
    .map((month) => {
      const monthIncome = incomes
        .filter((entry) => monthIdFromDate(entry.date, settings) === month)
        .reduce((sum, entry) => sum + entry.amount, 0)
      const monthExpensesList = expenses.filter((entry) => monthIdFromDate(entry.date, settings) === month)
      const monthExpenses = monthExpensesList.reduce((sum, entry) => sum + entry.amount, 0)
      const debtPayments = monthExpensesList
        .filter((entry) => debtCategoryIds.has(entry.categoryId) || Boolean(entry.debtId))
        .reduce((sum, entry) => sum + entry.amount, 0)
      const savings = monthExpensesList
        .filter((entry) => savingsCategoryIds.has(entry.categoryId) || entry.allocationKind === 'goal-contribution')
        .reduce((sum, entry) => sum + entry.amount, 0)

      const closingBalance = round2(carryOver + monthIncome - monthExpenses)
      carryOver = closingBalance

      return {
        month,
        income: round2(monthIncome),
        expenses: round2(monthExpenses),
        savings: round2(savings),
        debtPayments: round2(debtPayments),
        closingBalance
      }
    })
}

function buildCategoryBudgets(
  month: string,
  method: BudgetMethod,
  categories: Category[],
  expenses: ExpenseRecord[],
  debtObligations: DebtObligationSummary[],
  budgetPlan: BudgetPlan | undefined,
  totalIncome: number,
  obligations: number,
  settings: Settings
): CategoryBudgetInsight[] {
  const actualByCategory = new Map<string, number>()
  expenses
    .filter((entry) => monthIdFromDate(entry.date, settings) === month)
    .forEach((entry) => {
      actualByCategory.set(entry.categoryId, (actualByCategory.get(entry.categoryId) ?? 0) + entry.amount)
    })

  const percentagesByType: Record<BudgetMethod, Record<Category['type'], number>> = {
    'fifty-thirty-twenty': { essential: 50, lifestyle: 30, saving: 15, debt: 5, custom: 5 },
    'zero-based': { essential: 52, lifestyle: 18, saving: 18, debt: 12, custom: 5 },
    'custom-percentage': { essential: 45, lifestyle: 20, saving: 20, debt: 10, custom: 5 },
    'priority-based': { essential: 48, lifestyle: 17, saving: 20, debt: 15, custom: 5 },
    'goal-first': { essential: 45, lifestyle: 15, saving: 25, debt: 15, custom: 5 },
    'debt-focused': { essential: 44, lifestyle: 12, saving: 14, debt: 25, custom: 5 }
  }

  const availableForPlanning = Math.max(totalIncome, obligations)
  const typeBudgets = percentagesByType[method]

  return categories.map((category) => {
    const actual = round2(actualByCategory.get(category.id) ?? 0)
    const rule = budgetPlan?.rules.find((entry) => entry.categoryId === category.id)

    let recommended = 0
    if (budgetPlan && method === 'custom-percentage') {
      recommended = multiplyMoneyByBasisPoints(availableForPlanning, percentageToBasisPoints(rule?.percentage ?? 0))
    } else if (rule?.lockedAmount) {
      recommended = rule.lockedAmount
    } else if (budgetPlan && method === 'priority-based') {
      const totalWeight = budgetPlan.rules.reduce((sum, entry) => sum + decimalToHundredths(entry.priorityWeight, 1_000), 0) || 100
      recommended = allocateMoney(availableForPlanning, decimalToHundredths(rule?.priorityWeight ?? 1, 1_000), totalWeight)
    } else {
      const sameType = categories.filter((entry) => entry.type === category.type)
      recommended = divideMoney(multiplyMoneyByBasisPoints(availableForPlanning, typeBudgets[category.type] * 100), Math.max(sameType.length, 1))
    }

    if (category.type === 'debt') {
      const debtCommitment = debtObligations
        .filter((entry) => entry.categoryId === category.id)
        .reduce((sum, entry) => sum + entry.totalDueThisMonth, 0)
      recommended = Math.max(recommended, debtCommitment)
    }

    const limitAdjusted =
      category.type === 'debt'
        ? Math.max(recommended, multiplyMoneyByBasisPoints(actual, 8_000))
        : category.monthlyLimit
          ? Math.min(Math.max(recommended, multiplyMoneyByBasisPoints(actual, 8_000)), multiplyMoneyByBasisPoints(category.monthlyLimit, 11_500))
          : recommended
    const finalRecommended = Math.max(limitAdjusted, multiplyMoneyByBasisPoints(actual, 7_500))
    const percentUsed = finalRecommended <= 0 ? 0 : roundMetric2((actual / finalRecommended) * 100)
    const status = percentUsed > 110 ? 'danger' : percentUsed > 90 ? 'watch' : 'healthy'

    return {
      categoryId: category.id,
      categoryName: getCategoryDisplayName(category, settings.language),
      categoryType: category.type,
      color: category.color,
      recommended: finalRecommended,
      actual,
      difference: round2(finalRecommended - actual),
      percentUsed,
      status
    }
  })
}

function buildGoalInsights(
  goals: Goal[],
  contributions: GoalContribution[],
  month: string,
  monthExpenses: ExpenseRecord[]
): GoalInsight[] {
  const today = startOfDay(new Date())
  const currentMonthStart = parseISO(`${month}-01`)

  return goals.map((goal) => {
    const contributionTotal = contributions
      .filter((entry) => entry.goalId === goal.id)
      .reduce((sum, entry) => sum + entry.amount, 0)
    const contributedThisMonth = monthExpenses
      .filter((entry) => entry.goalId === goal.id && entry.allocationKind === 'goal-contribution')
      .reduce((sum, entry) => sum + entry.amount, 0)
    const currentAmount = round2(goal.currentAmount + contributionTotal)
    const remainingAmount = round2(Math.max(goal.targetAmount - currentAmount, 0))
    const targetDate = parseISO(goal.targetDate)
    const daysRemaining = remainingAmount <= 0 ? 0 : Math.max(differenceInCalendarDays(targetDate, today), 1)
    const weeksRemaining = remainingAmount <= 0 ? 0 : Math.max(Math.ceil(daysRemaining / 7), 1)
    const monthsRemaining = remainingAmount <= 0 ? 0 : Math.max(differenceInMonths(targetDate, currentMonthStart), 1)
    const monthlyRequiredContribution = remainingAmount <= 0 ? 0 : divideMoney(remainingAmount, monthsRemaining)
    const weeklyRequiredContribution = remainingAmount <= 0 ? 0 : divideMoney(remainingAmount, weeksRemaining)
    const dailyRequiredContribution = remainingAmount <= 0 ? 0 : divideMoney(remainingAmount, Math.max(daysRemaining, 1))

    const totalGoalMonths = Math.max(differenceInMonths(targetDate, parseISO(`${format(parseISO(goal.targetDate), 'yyyy')}-01-01`)), 1)
    const monthsElapsed = Math.max(differenceInMonths(today, parseISO(goal.targetDate)), 0)
    const expectedSavedByNow = round2(clamp(goal.targetAmount - monthlyRequiredContribution * monthsRemaining, 0, goal.targetAmount))
    const varianceAmount = round2(currentAmount - expectedSavedByNow)

    let status: GoalInsight['status'] = 'on-track'
    if (remainingAmount <= 0) {
      status = 'completed'
    } else if (varianceAmount < -Math.max(divideMoney(monthlyRequiredContribution, 2), 1)) {
      status = 'behind'
    } else if (varianceAmount > Math.max(divideMoney(monthlyRequiredContribution, 2), 1)) {
      status = 'ahead'
    }

    const effectiveMonthlyContribution = monthlyRequiredContribution > 0 ? monthlyRequiredContribution : currentAmount > 0 ? currentAmount : 0
    const estimatedMonths = remainingAmount <= 0 ? 0 : effectiveMonthlyContribution > 0 ? Math.ceil(remainingAmount / effectiveMonthlyContribution) : monthsElapsed + totalGoalMonths

    return {
      goalId: goal.id,
      name: goal.name,
      currentAmount,
      completionPercent: goal.targetAmount <= 0 ? 0 : roundMetric2((currentAmount / goal.targetAmount) * 100),
      remainingAmount,
      targetDate: goal.targetDate,
      monthsRemaining,
      weeksRemaining,
      daysRemaining,
      monthlyRequiredContribution,
      weeklyRequiredContribution,
      dailyRequiredContribution,
      contributedThisMonth: round2(contributedThisMonth),
      expectedSavedByNow,
      varianceAmount,
      status,
      estimatedCompletionDate: format(addMonths(today, estimatedMonths), 'yyyy-MM-dd')
    }
  })
}

function addFrequency(date: Date, frequency: DebtRecord['paymentFrequency'], count: number): Date {
  if (frequency === 'weekly') {
    return addDays(date, count * 7)
  }
  return addMonths(date, count)
}

function buildDebtInsights(debts: DebtRecord[], expenses: ExpenseRecord[]): DebtInsight[] {
  const today = startOfDay(new Date())

  return debts.map((debt) => {
    const payments = expenses
      .filter((entry) => entry.debtId === debt.id)
      .sort((left, right) => left.date.localeCompare(right.date))
    const paidSoFar = round2(payments.reduce((sum, entry) => sum + entry.amount, 0))
    const remainingBalance = round2(Math.max(debt.totalAmount - paidSoFar, 0))
    const desiredPayoffDate = debt.desiredPayoffDate ? parseISO(debt.desiredPayoffDate) : debt.endDate ? parseISO(debt.endDate) : null
    const periodsRemaining = desiredPayoffDate
      ? Math.max(
          debt.paymentFrequency === 'weekly'
            ? differenceInCalendarWeeks(desiredPayoffDate, today) + 1
            : differenceInMonths(desiredPayoffDate, today) + 1,
          1
        )
      : null
    const requiredInstallmentAmount =
      remainingBalance <= 0 ? 0 : divideMoney(remainingBalance, Math.max(periodsRemaining ?? Math.ceil(remainingBalance / Math.max(debt.installmentAmount, 1)), 1))
    const installmentAmount = round2(
      debt.installmentAmount > 0 ? debt.installmentAmount : requiredInstallmentAmount > 0 ? requiredInstallmentAmount : remainingBalance
    )
    const installmentsRemaining = remainingBalance <= 0 ? 0 : Math.ceil(remainingBalance / Math.max(installmentAmount, 1))
    const lastPayment = payments.length > 0 ? payments[payments.length - 1] : null
    const payoffDate =
      remainingBalance <= 0
        ? lastPayment?.date ?? debt.startDate
        : format(addFrequency(parseISO(debt.startDate), debt.paymentFrequency, payments.length + installmentsRemaining - 1), 'yyyy-MM-dd')
    const isInstallmentEnough = desiredPayoffDate ? installmentAmount >= requiredInstallmentAmount : true
    const nextPaymentDate =
      remainingBalance <= 0
        ? null
        : format(addFrequency(parseISO(debt.startDate), debt.paymentFrequency, payments.length), 'yyyy-MM-dd')

    return {
      debtId: debt.id,
      name: debt.name,
      totalAmount: round2(debt.totalAmount),
      installmentAmount,
      paidSoFar,
      remainingBalance,
      progressPercent: debt.totalAmount <= 0 ? 100 : roundMetric2((paidSoFar / debt.totalAmount) * 100),
      installmentsRemaining,
      payoffDate,
      desiredPayoffDate: debt.desiredPayoffDate ?? debt.endDate ?? null,
      requiredInstallmentAmount,
      isInstallmentEnough,
      nextPaymentDate,
      status: remainingBalance <= 0 ? 'completed' : 'active',
      recurringAutomatically: debt.recurringAutomatically
    }
  })
}

interface DebtObligationSummary {
  debtId: string
  categoryId: string
  totalDueThisMonth: number
  unpaidDueThisMonth: number
  paidThisMonth: number
  remainingBalance: number
  nextPaymentDate: string | null
}

function buildDebtObligationSummaries(
  month: string,
  debts: DebtRecord[],
  debtInsights: DebtInsight[],
  expenses: ExpenseRecord[],
  settings: Settings
): DebtObligationSummary[] {
  const { start, end } = monthRange(month, settings)
  const debtInsightsById = new Map(debtInsights.map((entry) => [entry.debtId, entry]))

  return debts.map((debt) => {
    const insight = debtInsightsById.get(debt.id)
    if (!insight || insight.status === 'completed' || parseISO(debt.startDate) > end) {
      return {
        debtId: debt.id,
        categoryId: debt.categoryId,
        totalDueThisMonth: 0,
        unpaidDueThisMonth: 0,
        paidThisMonth: 0,
        remainingBalance: insight?.remainingBalance ?? 0,
        nextPaymentDate: insight?.nextPaymentDate ?? null
      }
    }

    const payments = expenses
      .filter((entry) => entry.debtId === debt.id)
      .sort((left, right) => left.date.localeCompare(right.date))
    const paidBeforeMonth = payments
      .filter((entry) => parseISO(entry.date) < start)
      .reduce((sum, entry) => sum + entry.amount, 0)
    const paidThisMonth = round2(
      payments
        .filter((entry) => monthIdFromDate(entry.date, settings) === month)
        .reduce((sum, entry) => sum + entry.amount, 0)
    )

    let scheduledDate = parseISO(debt.startDate)
    let remainingTracker = round2(Math.max(debt.totalAmount - paidBeforeMonth, 0))
    let totalDueThisMonth = 0

    while (remainingTracker > 0 && isSameOrBefore(scheduledDate, end)) {
      const dueAmount = round2(Math.min(insight.installmentAmount, remainingTracker))
      if (scheduledDate >= start) {
        totalDueThisMonth = round2(totalDueThisMonth + dueAmount)
      }
      remainingTracker = round2(Math.max(remainingTracker - dueAmount, 0))
      scheduledDate = addFrequency(scheduledDate, debt.paymentFrequency, 1)
    }

    return {
      debtId: debt.id,
      categoryId: debt.categoryId,
      totalDueThisMonth,
      unpaidDueThisMonth: round2(Math.max(totalDueThisMonth - paidThisMonth, 0)),
      paidThisMonth,
      remainingBalance: insight.remainingBalance,
      nextPaymentDate: insight.nextPaymentDate
    }
  })
}

interface SpendingPlanMetrics {
  periodDailySafe: number
  periodWeeklySafe: number
  remainingDailySafe: number
  remainingWeeklySafe: number
  unpaidFixedCommitments: number
  pendingGoalFunding: number
  remainingDays: number
  remainingWeeks: number
}

function buildSpendingPlan(
  month: string,
  monthExpenses: ExpenseRecord[],
  categories: Category[],
  goals: GoalInsight[],
  debtObligations: DebtObligationSummary[],
  monthlySummaries: MonthlySummary[],
  settings: Settings
): SpendingPlanMetrics {
  const categoryById = new Map(categories.map((category) => [category.id, category]))
  const { start, end } = monthRange(month, settings)
  const today = startOfDay(new Date())
  const effectiveToday = today < start ? start : today > end ? end : today
  const monthLength = Math.max(differenceInCalendarDays(end, start) + 1, 1)
  const remainingDays = Math.max(differenceInCalendarDays(end, effectiveToday) + 1, 1)
  const remainingWeeks = Math.max(remainingDays / 7, 1)
  const previousSummary = [...monthlySummaries]
    .filter((entry) => entry.month < month)
    .sort((left, right) => right.month.localeCompare(left.month))[0]
  const carryOverBalance = previousSummary?.closingBalance ?? 0
  const monthIncome = monthlySummaries.find((entry) => entry.month === month)?.income ?? 0
  const spentToDate = monthExpenses
    .filter((entry) => parseISO(entry.date) <= effectiveToday)
    .reduce((sum, entry) => sum + entry.amount, 0)
  const remainingBalance = carryOverBalance + monthIncome - spentToDate

  const unpaidFixedCommitments = round2(
    monthExpenses
      .filter((entry) => entry.type === 'fixed' && parseISO(entry.date) > effectiveToday)
      .reduce((sum, entry) => sum + entry.amount, 0)
  )
  const unpaidDebtCommitments = round2(debtObligations.reduce((sum, entry) => sum + entry.unpaidDueThisMonth, 0))

  const pendingGoalFunding = round2(
    settings.includeOptionalGoalsInForecast
      ? goals.reduce((sum, goal) => {
          if (goal.status === 'completed') return sum
          return sum + Math.max(goal.monthlyRequiredContribution - goal.contributedThisMonth, 0)
        }, 0)
      : 0
  )

  const totalFixedCommitments = round2(
    monthExpenses.filter((entry) => entry.type === 'fixed').reduce((sum, entry) => sum + entry.amount, 0)
  )
  const totalDebtCommitments = round2(debtObligations.reduce((sum, entry) => sum + entry.totalDueThisMonth, 0))
  const debtExpensePayments = round2(monthExpenses.filter((entry) => Boolean(entry.debtId)).reduce((sum, entry) => sum + entry.amount, 0))
  const nonDebtFixedCommitments = round2(Math.max(totalFixedCommitments - debtExpensePayments, 0))
  const unpaidNonDebtFixedCommitments = round2(Math.max(unpaidFixedCommitments - unpaidDebtCommitments, 0))
  const fullMonthGoalFunding = round2(
    settings.includeOptionalGoalsInForecast ? goals.reduce((sum, goal) => sum + goal.monthlyRequiredContribution, 0) : 0
  )
  const periodSafePool = Math.max(carryOverBalance + monthIncome - nonDebtFixedCommitments - totalDebtCommitments - fullMonthGoalFunding, 0)
  const remainingSafePool = Math.max(remainingBalance - unpaidNonDebtFixedCommitments - unpaidDebtCommitments - pendingGoalFunding, 0)

  const spentFlexibleToDate = monthExpenses
    .filter((entry) => {
      const categoryType = categoryById.get(entry.categoryId)?.type
      return (
        parseISO(entry.date) <= effectiveToday &&
        entry.type !== 'fixed' &&
        categoryType !== 'saving' &&
        entry.allocationKind !== 'goal-contribution'
      )
    })
    .reduce((sum, entry) => sum + entry.amount, 0)
  const remainingSafeAfterFlexible = Math.max(remainingSafePool - Math.max(spentFlexibleToDate - periodSafePool, 0), 0)

  return {
    periodDailySafe: divideMoney(periodSafePool, monthLength),
    periodWeeklySafe: allocateMoney(periodSafePool, 7, monthLength),
    remainingDailySafe: divideMoney(remainingSafeAfterFlexible, remainingDays),
    remainingWeeklySafe: allocateMoney(remainingSafeAfterFlexible, 7, remainingDays),
    unpaidFixedCommitments: round2(unpaidNonDebtFixedCommitments + unpaidDebtCommitments),
    pendingGoalFunding,
    remainingDays,
    remainingWeeks: roundMetric2(remainingWeeks)
  }
}

function buildDashboardMetrics(
  month: string,
  categories: Category[],
  incomes: IncomeRecord[],
  expenses: ExpenseRecord[],
  categoryBudgets: CategoryBudgetInsight[],
  monthlySummaries: MonthlySummary[],
  goalInsights: GoalInsight[],
  debtObligations: DebtObligationSummary[],
  forecast: AnalyticsSnapshot['forecast'],
  settings: Settings
): DashboardMetrics {
  const monthIncomes = incomes.filter((entry) => monthIdFromDate(entry.date, settings) === month)
  const monthExpenses = expenses.filter((entry) => monthIdFromDate(entry.date, settings) === month)
  const totalIncome = monthIncomes.reduce((sum, entry) => sum + entry.amount, 0)
  const totalExpenses = monthExpenses.reduce((sum, entry) => sum + entry.amount, 0)
  const savingsCategoryIds = new Set(categories.filter((entry) => entry.type === 'saving').map((entry) => entry.id))
  const debtCategoryIds = new Set(categories.filter((entry) => entry.type === 'debt').map((entry) => entry.id))
  const essentialCategoryIds = new Set(categories.filter((entry) => entry.type === 'essential').map((entry) => entry.id))
  const savingsSpend = monthExpenses
    .filter((entry) => savingsCategoryIds.has(entry.categoryId) || entry.allocationKind === 'goal-contribution')
    .reduce((sum, entry) => sum + entry.amount, 0)
  const debtSpend = monthExpenses
    .filter((entry) => debtCategoryIds.has(entry.categoryId) || Boolean(entry.debtId))
    .reduce((sum, entry) => sum + entry.amount, 0)
  const debtExpensePayments = monthExpenses.filter((entry) => Boolean(entry.debtId)).reduce((sum, entry) => sum + entry.amount, 0)
  const debtCommitmentsThisMonth = round2(debtObligations.reduce((sum, entry) => sum + entry.totalDueThisMonth, 0))
  const debtLoad = Math.max(round2(debtSpend), debtCommitmentsThisMonth)
  const essentialSpend = monthExpenses
    .filter((entry) => essentialCategoryIds.has(entry.categoryId))
    .reduce((sum, entry) => sum + entry.amount, 0)
  const variableSpend = monthExpenses.filter((entry) => entry.type === 'variable').reduce((sum, entry) => sum + entry.amount, 0)
  const fixedExpenseSpend = round2(monthExpenses.filter((entry) => entry.type === 'fixed').reduce((sum, entry) => sum + entry.amount, 0))
  const fixedMonthlyExpenses = round2(Math.max(fixedExpenseSpend - debtExpensePayments, 0) + debtCommitmentsThisMonth)
  const remainingAfterFixedExpenses = round2(totalIncome - fixedMonthlyExpenses)
  const remainingAfterFixedAndVariableExpenses = round2(remainingAfterFixedExpenses - variableSpend)
  const previousSummary = [...monthlySummaries]
    .filter((entry) => entry.month < month)
    .sort((left, right) => right.month.localeCompare(left.month))[0]
  const carryOverBalance = previousSummary?.closingBalance ?? 0
  const remainingBalance = totalIncome - totalExpenses + carryOverBalance
  const adherencePenalty = categoryBudgets.reduce((sum, item) => sum + Math.max(item.percentUsed - 100, 0), 0)
  const goalPressure = goalInsights.filter((goal) => goal.status === 'behind').length * 4
  const spendingPlan = buildSpendingPlan(month, monthExpenses, categories, goalInsights, debtObligations, monthlySummaries, settings)

  const score = clamp(
    100
      - safeDivide(Math.max(-remainingBalance, 0), Math.max(totalIncome + Math.max(carryOverBalance, 0), 1)) * 60
      - safeDivide(debtLoad, Math.max(totalIncome, 1)) * 35
      - safeDivide(essentialSpend, Math.max(totalIncome, 1)) * 15
      - adherencePenalty * 0.15
      - goalPressure,
    15,
    98
  )
  const normalizedScore = forecast.affordabilityStatus === 'insufficient' ? Math.min(score, 45) : forecast.affordabilityStatus === 'tight' ? Math.min(score, 68) : score
  const riskLevel = forecast.affordabilityStatus === 'insufficient' ? 'high' : forecast.affordabilityStatus === 'tight' ? 'moderate' : normalizedScore >= 75 ? 'low' : normalizedScore >= 55 ? 'moderate' : 'high'

  return {
    month,
    totalIncome: round2(totalIncome),
    totalExpenses: round2(totalExpenses),
    remainingBalance: round2(remainingBalance),
    fixedMonthlyExpenses,
    variableExpensesThisMonth: round2(variableSpend),
    remainingAfterFixedExpenses,
    remainingAfterFixedAndVariableExpenses,
    savingsRate: roundMetric2(safeDivide(savingsSpend, totalIncome) * 100),
    debtRatio: roundMetric2(safeDivide(debtLoad, totalIncome) * 100),
    essentialRatio: roundMetric2(safeDivide(essentialSpend, totalIncome) * 100),
    variableRatio: roundMetric2(safeDivide(variableSpend, totalIncome) * 100),
    budgetHealthScore: roundMetric2(normalizedScore),
    riskLevel,
    disposableCash: round2(totalIncome - essentialSpend - debtLoad),
    goalContributionCapacity: round2(Math.max(remainingBalance - spendingPlan.unpaidFixedCommitments, 0)),
    unpaidFixedCommitments: spendingPlan.unpaidFixedCommitments,
    pendingGoalFunding: spendingPlan.pendingGoalFunding,
    remainingDays: spendingPlan.remainingDays,
    remainingWeeks: spendingPlan.remainingWeeks,
    safeDailySpending: spendingPlan.periodDailySafe,
    safeWeeklySpending: spendingPlan.periodWeeklySafe,
    remainingDailySpending: spendingPlan.remainingDailySafe,
    remainingWeeklySpending: spendingPlan.remainingWeeklySafe
  }
}

function buildForecast(
  month: string,
  incomes: IncomeRecord[],
  expenses: ExpenseRecord[],
  categories: Category[],
  goals: GoalInsight[],
  debtObligations: DebtObligationSummary[],
  monthlySummaries: MonthlySummary[],
  settings: Settings
): AnalyticsSnapshot['forecast'] {
  const monthExpenses = expenses.filter((entry) => monthIdFromDate(entry.date, settings) === month)
  const priorExpenses = expenses.filter((entry) => monthIdFromDate(entry.date, settings) < month)
  const { start, end } = monthRange(month, settings)
  const today = startOfDay(new Date())
  const effectiveToday = today < start ? start : today > end ? end : today
  const elapsedDays = Math.max(differenceInCalendarDays(effectiveToday, start) + 1, 1)
  const monthLength = Math.max(differenceInCalendarDays(end, start) + 1, 1)
  const remainingDaysUntilMonthEnd = Math.max(differenceInCalendarDays(end, effectiveToday) + 1, 1)
  const remainingWeeksUntilMonthEnd = Math.max(remainingDaysUntilMonthEnd / 7, 1)
  const previousSummary = [...monthlySummaries]
    .filter((entry) => entry.month < month)
    .sort((left, right) => right.month.localeCompare(left.month))[0]
  const carryOverBalance = previousSummary?.closingBalance ?? 0
  const monthIncome = incomes
    .filter((entry) => monthIdFromDate(entry.date, settings) === month)
    .reduce((sum, entry) => sum + entry.amount, 0)
  const spentToDate = monthExpenses
    .filter((entry) => parseISO(entry.date) <= effectiveToday)
    .reduce((sum, entry) => sum + entry.amount, 0)
  const remainingBalance = round2(carryOverBalance + monthIncome - spentToDate)

  const fixedSpend = monthExpenses.filter((entry) => entry.type === 'fixed').reduce((sum, entry) => sum + entry.amount, 0)
  const variableSpend = monthExpenses.filter((entry) => entry.type === 'variable').reduce((sum, entry) => sum + entry.amount, 0)
  const futureFixedExpenses = round2(
    monthExpenses
      .filter((entry) => entry.type === 'fixed' && parseISO(entry.date) > effectiveToday)
      .filter((entry) => !entry.debtId)
      .reduce((sum, entry) => sum + entry.amount, 0)
  )
  const installmentsDueThisMonth = round2(debtObligations.reduce((sum, entry) => sum + entry.unpaidDueThisMonth, 0))
  const optionalGoalContributionsThisMonth = round2(
    settings.includeOptionalGoalsInForecast
      ? goals.reduce((sum, goal) => {
          if (goal.status === 'completed') return sum
          return sum + Math.max(goal.monthlyRequiredContribution - goal.contributedThisMonth, 0)
        }, 0)
      : 0
  )
  const averageDailySpend = divideMoney(variableSpend, elapsedDays)

  const byCategoryAverage = new Map<string, number>()
  categories.forEach((category) => {
    const values = priorExpenses.filter((entry) => entry.categoryId === category.id).map((entry) => entry.amount)
    if (values.length > 0) {
      byCategoryAverage.set(category.id, divideMoney(values.reduce((sum, value) => sum + value, 0), values.length))
    }
  })

  const unusualExpenses = monthExpenses.filter((entry) => {
    const historicalAverage = byCategoryAverage.get(entry.categoryId)
    if (!historicalAverage) {
      return entry.amount > 500 && entry.type === 'variable'
    }
    return entry.amount > multiplyMoneyByBasisPoints(historicalAverage, 17_500)
  })

  const safeDailySpendingUntilMonthEnd = divideMoney(remainingBalance, remainingDaysUntilMonthEnd)
  const safeWeeklySpendingUntilMonthEnd = allocateMoney(remainingBalance, 7, remainingDaysUntilMonthEnd)
  const adjustedRemainingBalance = round2(
    remainingBalance - futureFixedExpenses - installmentsDueThisMonth - optionalGoalContributionsThisMonth
  )
  const adjustedSafeDailySpendingUntilMonthEnd = divideMoney(adjustedRemainingBalance, remainingDaysUntilMonthEnd)
  const adjustedSafeWeeklySpendingUntilMonthEnd = allocateMoney(adjustedRemainingBalance, 7, remainingDaysUntilMonthEnd)
  const projectedVariableMonthEndSpend = averageDailySpend * monthLength
  const projectedMonthEndSpend = round2(fixedSpend + projectedVariableMonthEndSpend)
  const projectedMonthEndBalance = round2(carryOverBalance + monthIncome - projectedMonthEndSpend)
  const affordabilityStatus =
    projectedMonthEndBalance < 0 ? 'insufficient' : adjustedRemainingBalance <= 0 || adjustedSafeDailySpendingUntilMonthEnd < averageDailySpend ? 'tight' : 'safe'

  return {
    monthEndDate: format(end, 'yyyy-MM-dd'),
    remainingBalance,
    remainingDaysUntilMonthEnd,
    remainingWeeksUntilMonthEnd: roundMetric2(remainingWeeksUntilMonthEnd),
    safeDailySpendingUntilMonthEnd,
    safeWeeklySpendingUntilMonthEnd,
    unpaidFixedExpensesDueThisMonth: futureFixedExpenses,
    installmentsDueThisMonth,
    optionalGoalContributionsThisMonth,
    goalsIncludedInForecast: settings.includeOptionalGoalsInForecast,
    balanceAfterCommitments: adjustedRemainingBalance,
    adjustedSafeDailySpendingUntilMonthEnd,
    adjustedSafeWeeklySpendingUntilMonthEnd,
    projectedMonthEndBalance,
    affordabilityStatus,
    willRunOutBeforeMonthEnd: projectedMonthEndBalance < 0,
    periodSpendToDate: round2(fixedSpend + variableSpend),
    projectedMonthEndSpend,
    averageDailySpend: divideMoney(fixedSpend + variableSpend, elapsedDays),
    averageWeeklySpend: allocateMoney(fixedSpend + variableSpend, 7, elapsedDays),
    unusualExpenses
  }
}

function buildSmartSpendingPlanner(
  forecast: AnalyticsSnapshot['forecast'],
  goals: GoalInsight[]
): SmartSpendingPlanner {
  const recommendedGoalContributionsThisMonth = round2(
    goals.reduce((sum, goal) => {
      if (goal.status === 'completed') return sum
      return sum + goal.monthlyRequiredContribution
    }, 0)
  )
  const remainingUsableBalance = round2(forecast.balanceAfterCommitments)
  const safeDailySpending = divideMoney(remainingUsableBalance, Math.max(forecast.remainingDaysUntilMonthEnd, 1))
  const safeWeeklySpending = allocateMoney(remainingUsableBalance, 7, Math.max(forecast.remainingDaysUntilMonthEnd, 1))
  const averageDailySpend = Math.max(forecast.averageDailySpend, 0)

  let status: SmartSpendingPlanner['status'] = 'comfortable'
  if (remainingUsableBalance < 0) {
    status = 'not-enough'
  } else if (safeDailySpending <= 0 || safeDailySpending < multiplyMoneyByBasisPoints(averageDailySpend, 7_500)) {
    status = 'risky'
  } else if (safeDailySpending < multiplyMoneyByBasisPoints(averageDailySpend, 10_500)) {
    status = 'tight'
  }

  return {
    currentRemainingBalance: forecast.remainingBalance,
    remainingUsableBalance,
    safeDailySpending,
    safeWeeklySpending,
    safeMonthlyFlexibleSpending: remainingUsableBalance,
    remainingDaysInMonth: forecast.remainingDaysUntilMonthEnd,
    remainingWeeksInMonth: forecast.remainingWeeksUntilMonthEnd,
    debtInstallmentsDueThisMonth: forecast.installmentsDueThisMonth,
    plannedGoalContributionsThisMonth: forecast.optionalGoalContributionsThisMonth,
    recommendedGoalContributionsThisMonth,
    fixedAndRecurringExpensesStillDueThisMonth: forecast.unpaidFixedExpensesDueThisMonth,
    goalsIncludedInPlanner: forecast.goalsIncludedInForecast,
    shortfallAmount: round2(Math.max(-remainingUsableBalance, 0)),
    status
  }
}

function buildAlerts(
  dashboard: DashboardMetrics,
  categoryBudgets: CategoryBudgetInsight[],
  forecast: AnalyticsSnapshot['forecast'],
  goals: GoalInsight[],
  debts: DebtInsight[],
  settings: Settings
): AlertItem[] {
  const alerts: AlertItem[] = []
  const now = new Date().toISOString()

  categoryBudgets
    .filter((item) => item.percentUsed > 100)
    .slice(0, 4)
    .forEach((item) => {
      alerts.push({
        id: `alert-budget-${item.categoryId}`,
        createdAt: now,
        severity: item.percentUsed > 115 ? 'critical' : 'warning',
        ...financeCopy.alertBudgetExceeded(settings.language, item.categoryName, roundMetric2(item.percentUsed - 100)),
        module: 'budget'
      })
    })

  if (dashboard.remainingBalance < multiplyMoneyByBasisPoints(dashboard.totalIncome, 800)) {
    alerts.push({
      id: 'alert-low-balance',
      createdAt: now,
      severity: dashboard.remainingBalance < 0 ? 'critical' : 'warning',
      ...financeCopy.alertLowBalance(settings.language),
      module: 'dashboard'
    })
  }

  if (dashboard.savingsRate < 10) {
    alerts.push({
      id: 'alert-savings-rate',
      createdAt: now,
      severity: 'warning',
      ...financeCopy.alertSavingsRate(settings.language),
      module: 'goals'
    })
  }

  if (forecast.unusualExpenses.length > 0) {
    alerts.push({
      id: 'alert-unusual-spending',
      createdAt: now,
      severity: 'info',
      ...financeCopy.alertUnusualSpending(settings.language, forecast.unusualExpenses.length),
      module: 'reports'
    })
  }

  if (goals.some((goal) => goal.status === 'behind')) {
    alerts.push({
      id: 'alert-goal-pressure',
      createdAt: now,
      severity: 'warning',
      ...financeCopy.alertGoalPressure(settings.language),
      module: 'goals'
    })
  }

  if (debts.some((debt) => debt.status === 'active' && !debt.isInstallmentEnough)) {
    alerts.push({
      id: 'alert-debt-payoff',
      createdAt: now,
      severity: 'warning',
      title: settings.language === 'ar' ? 'خطة سداد الدين غير كافية' : 'Debt payoff plan is not sufficient',
      message:
        settings.language === 'ar'
          ? 'قيمة القسط الحالية لا تكفي لإنهاء أحد الديون في الموعد المطلوب.'
          : 'One or more installment amounts will not finish the debt by the requested payoff date.',
      module: 'debts'
    })
  }

  if (!settings.notificationsEnabled) {
    alerts.push({
      id: 'alert-notifications-disabled',
      createdAt: now,
      severity: 'info',
      ...financeCopy.alertNotificationsDisabled(settings.language),
      module: 'settings'
    })
  }

  return alerts
}

export function calculateFinanceSnapshot(input: FinanceInput): {
  analytics: AnalyticsSnapshot
  alerts: AlertItem[]
  monthlySummaries: MonthlySummary[]
} {
  const settings = input.settings ?? defaultSettings
  const currentMonth = getCurrentMonth(settings)
  const budgetPlan = input.budgetPlans.find((entry) => entry.month === currentMonth) ?? input.budgetPlans[0]
  const contributionMap = new Map<string, GoalContribution>()
  input.goalContributions.forEach((entry) => contributionMap.set(entry.expenseId, entry))
  input.expenses
    .filter((entry) => entry.goalId && entry.allocationKind === 'goal-contribution')
    .forEach((entry) => {
      contributionMap.set(entry.id, {
        id: `gcon-${entry.id}`,
        goalId: entry.goalId as string,
        expenseId: entry.id,
        amount: entry.amount,
        date: entry.date,
        notes: entry.notes
      })
    })
  const normalizedGoalContributions = [...contributionMap.values()]
  const activeMonthExpenses = input.expenses.filter((entry) => monthIdFromDate(entry.date, settings) === currentMonth)
  const debtInsights = buildDebtInsights(input.debts, input.expenses)
  const debtObligations = buildDebtObligationSummaries(currentMonth, input.debts, debtInsights, input.expenses, settings)
  const debtDueThisMonth = round2(debtObligations.reduce((sum, entry) => sum + entry.totalDueThisMonth, 0))
  const debtExpensePaymentsThisMonth = round2(
    activeMonthExpenses.filter((entry) => Boolean(entry.debtId)).reduce((sum, entry) => sum + entry.amount, 0)
  )
  const fixedObligations = round2(activeMonthExpenses.filter((entry) => entry.type === 'fixed').reduce((sum, entry) => sum + entry.amount, 0))
  const obligations = round2(Math.max(fixedObligations - debtExpensePaymentsThisMonth, 0) + debtDueThisMonth)
  const totalIncome = input.incomes
    .filter((entry) => monthIdFromDate(entry.date, settings) === currentMonth)
    .reduce((sum, entry) => sum + entry.amount, 0)

  const categoryBudgets = buildCategoryBudgets(
    currentMonth,
    getBudgetMethod(budgetPlan, settings),
    input.categories,
    input.expenses,
    debtObligations,
    budgetPlan,
    totalIncome,
    obligations,
    settings
  )

  const monthlySummaries = buildMonthlySummaries(input.incomes, input.expenses, input.categories, settings)
  const goalInsights = buildGoalInsights(input.goals, normalizedGoalContributions, currentMonth, activeMonthExpenses)
  const forecast = buildForecast(
    currentMonth,
    input.incomes,
    input.expenses,
    input.categories,
    goalInsights,
    debtObligations,
    monthlySummaries,
    settings
  )
  const dashboard = buildDashboardMetrics(
    currentMonth,
    input.categories,
    input.incomes,
    input.expenses,
    categoryBudgets,
    monthlySummaries,
    goalInsights,
    debtObligations,
    forecast,
    settings
  )
  const smartPlanner = buildSmartSpendingPlanner(forecast, goalInsights)

  const highestSpendingCategories = [...categoryBudgets]
    .sort((left, right) => right.actual - left.actual)
    .slice(0, 5)
    .map((entry) => ({
      categoryId: entry.categoryId,
      categoryName: entry.categoryName,
      amount: entry.actual
    }))

  const recommendations: string[] = []
  const biggestOverspend = [...categoryBudgets]
    .filter((entry) => entry.difference < 0)
    .sort((left, right) => left.difference - right.difference)[0]

  if (dashboard.savingsRate < 15) {
    recommendations.push(financeCopy.recIncreaseSavings(settings.language))
  }
  if (dashboard.debtRatio > 20) {
    recommendations.push(financeCopy.recDebtPressure(settings.language))
  }
  if (goalInsights.some((entry) => entry.status === 'behind')) {
    recommendations.push(financeCopy.recGoalUnrealistic(settings.language))
  }
  if (debtInsights.some((entry) => entry.status === 'active' && !entry.isInstallmentEnough)) {
    recommendations.push(
      settings.language === 'ar'
        ? 'ارفع القسط الشهري لبعض الديون أو مدّد تاريخ السداد المطلوب حتى لا تتأخر الخطة.'
        : 'Increase the installment on at least one debt or extend its payoff date so the schedule remains achievable.'
    )
  }
  if (biggestOverspend) {
    recommendations.push(financeCopy.recOverspend(settings.language, biggestOverspend.categoryName, round2(Math.abs(biggestOverspend.difference))))
  }
  if (dashboard.totalIncome <= 0 && input.expenses.length > 0) {
    recommendations.push(financeCopy.recZeroIncome(settings.language))
  }
  if (recommendations.length === 0) {
    recommendations.push(financeCopy.recBalanced(settings.language))
  }

  const analytics: AnalyticsSnapshot = {
    dashboard,
    categoryBudgets,
    monthlyTrend: monthlySummaries.map((entry) => ({
      month: entry.month,
      income: entry.income,
      expenses: entry.expenses,
      savings: entry.savings
    })),
    forecast,
    smartPlanner,
    goalInsights,
    debtInsights,
    availableMonths: monthlySummaries.map((entry) => entry.month).sort((left, right) => right.localeCompare(left)),
    highestSpendingCategories,
    budgetMethodUsed: getBudgetMethod(budgetPlan, settings),
    recommendations
  }

  if (isDevLoggingEnabled()) {
    console.debug('[finance] Snapshot calculated', {
      month: analytics.dashboard.month,
      totalIncome: analytics.dashboard.totalIncome,
      totalExpenses: analytics.dashboard.totalExpenses,
      remainingBalance: analytics.dashboard.remainingBalance,
      balanceAfterCommitments: analytics.forecast.balanceAfterCommitments,
      projectedMonthEndBalance: analytics.forecast.projectedMonthEndBalance,
      affordabilityStatus: analytics.forecast.affordabilityStatus,
      goalCount: analytics.goalInsights.length,
      debtCount: analytics.debtInsights.length
    })
  }

  return {
    analytics,
    alerts: buildAlerts(dashboard, categoryBudgets, forecast, goalInsights, debtInsights, settings),
    monthlySummaries
  }
}
