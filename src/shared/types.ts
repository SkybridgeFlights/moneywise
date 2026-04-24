export type EntryKind = 'income' | 'expense'
export type AppLanguage = 'ar' | 'en'
export type ExpenseAllocationKind = 'spend' | 'saving' | 'goal-contribution'
export type DebtPaymentFrequency = 'monthly' | 'weekly'
export type GoalPlanStatus = 'behind' | 'on-track' | 'ahead' | 'completed'
export type DebtStatus = 'active' | 'completed'
export type ForecastAffordabilityStatus = 'safe' | 'tight' | 'insufficient'

export type IncomeType = 'fixed' | 'variable'
export type ExpenseType = 'fixed' | 'variable'
export type PaymentMethod = 'cash' | 'bank' | 'card' | 'wallet' | 'transfer'
export type GoalType =
  | 'emergency-fund'
  | 'device'
  | 'travel'
  | 'debt-payoff'
  | 'large-purchase'
  | 'general'
export type GoalPriority = 'high' | 'medium' | 'low'
export type BudgetMethod =
  | 'fifty-thirty-twenty'
  | 'zero-based'
  | 'custom-percentage'
  | 'priority-based'
  | 'goal-first'
  | 'debt-focused'

export interface IncomeRecord {
  id: string
  name: string
  groupName: string
  amount: number
  date: string
  type: IncomeType
  recurring: boolean
  notes: string
}

export interface ExpenseRecord {
  id: string
  title: string
  amount: number
  date: string
  categoryId: string
  paymentMethod: PaymentMethod
  type: ExpenseType
  recurring: boolean
  notes: string
  tags: string[]
  goalId: string | null
  debtId: string | null
  allocationKind: ExpenseAllocationKind
}

export interface Category {
  id: string
  name: string
  type: 'essential' | 'lifestyle' | 'saving' | 'debt' | 'custom'
  color: string
  icon: string
  monthlyLimit: number | null
  builtIn: boolean
}

export interface Goal {
  id: string
  name: string
  type: GoalType
  targetAmount: number
  currentAmount: number
  targetDate: string
  priority: GoalPriority
  notes: string
}

export interface GoalContribution {
  id: string
  goalId: string
  expenseId: string
  amount: number
  date: string
  notes: string
}

export interface DebtRecord {
  id: string
  name: string
  totalAmount: number
  installmentAmount: number
  startDate: string
  endDate: string | null
  desiredPayoffDate: string | null
  paymentFrequency: DebtPaymentFrequency
  recurringAutomatically: boolean
  categoryId: string
  notes: string
}

export interface CategoryDeletionImpact {
  categoryId: string
  categoryName: string
  expenseCount: number
  budgetRuleCount: number
  recurringCount: number
  affectedReportAmount: number
  availableTargetCategories: Array<{
    id: string
    name: string
    builtIn: boolean
  }>
  fallbackCategoryId: string
}

export interface BudgetRule {
  categoryId: string
  percentage: number
  priorityWeight: number
  lockedAmount: number | null
}

export interface BudgetPlan {
  id: string
  month: string
  method: BudgetMethod
  customSavingsTarget: number
  customEmergencyTarget: number
  debtAcceleration: number
  notes: string
  rules: BudgetRule[]
}

export interface RecurringTransaction {
  id: string
  title: string
  kind: EntryKind
  amount: number
  dayOfMonth: number
  categoryId: string | null
  groupName: string | null
  paymentMethod: PaymentMethod | null
  entryType: IncomeType | ExpenseType | null
  notes: string
  tags: string[]
  goalId: string | null
  debtId: string | null
  allocationKind: ExpenseAllocationKind | null
  sourceId: string | null
  active: boolean
}

export interface AlertItem {
  id: string
  createdAt: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  message: string
  module: string
}

export interface Settings {
  language: AppLanguage
  currency: string
  locale: string
  theme: 'light' | 'dark'
  financialMonthStartDay: number
  defaultBudgetMethod: BudgetMethod
  notificationsEnabled: boolean
  includeOptionalGoalsInForecast: boolean
  backupFrequency: 'manual' | 'weekly' | 'monthly'
  rtl: boolean
}

export interface ActivityLogItem {
  id: string
  createdAt: string
  action: string
  detail: string
}

export interface MonthlySummary {
  month: string
  income: number
  expenses: number
  savings: number
  debtPayments: number
  closingBalance: number
  archivedAt?: string
}

export interface CategoryBudgetInsight {
  categoryId: string
  categoryName: string
  categoryType: Category['type']
  color: string
  recommended: number
  actual: number
  difference: number
  percentUsed: number
  status: 'healthy' | 'watch' | 'danger'
}

export interface DashboardMetrics {
  month: string
  totalIncome: number
  totalExpenses: number
  remainingBalance: number
  fixedMonthlyExpenses: number
  variableExpensesThisMonth: number
  remainingAfterFixedExpenses: number
  remainingAfterFixedAndVariableExpenses: number
  savingsRate: number
  debtRatio: number
  essentialRatio: number
  variableRatio: number
  budgetHealthScore: number
  riskLevel: 'low' | 'moderate' | 'high'
  disposableCash: number
  goalContributionCapacity: number
  unpaidFixedCommitments: number
  pendingGoalFunding: number
  remainingDays: number
  remainingWeeks: number
  safeDailySpending: number
  safeWeeklySpending: number
  remainingDailySpending: number
  remainingWeeklySpending: number
}

export interface SpendingTrendPoint {
  month: string
  income: number
  expenses: number
  savings: number
}

export interface ForecastMetrics {
  monthEndDate: string
  remainingBalance: number
  remainingDaysUntilMonthEnd: number
  remainingWeeksUntilMonthEnd: number
  safeDailySpendingUntilMonthEnd: number
  safeWeeklySpendingUntilMonthEnd: number
  unpaidFixedExpensesDueThisMonth: number
  installmentsDueThisMonth: number
  optionalGoalContributionsThisMonth: number
  goalsIncludedInForecast: boolean
  balanceAfterCommitments: number
  adjustedSafeDailySpendingUntilMonthEnd: number
  adjustedSafeWeeklySpendingUntilMonthEnd: number
  projectedMonthEndBalance: number
  affordabilityStatus: ForecastAffordabilityStatus
  willRunOutBeforeMonthEnd: boolean
  periodSpendToDate: number
  projectedMonthEndSpend: number
  averageDailySpend: number
  averageWeeklySpend: number
  unusualExpenses: ExpenseRecord[]
}

export interface GoalInsight {
  goalId: string
  name: string
  currentAmount: number
  completionPercent: number
  remainingAmount: number
  targetDate: string
  monthsRemaining: number
  weeksRemaining: number
  daysRemaining: number
  monthlyRequiredContribution: number
  weeklyRequiredContribution: number
  dailyRequiredContribution: number
  contributedThisMonth: number
  expectedSavedByNow: number
  varianceAmount: number
  status: GoalPlanStatus
  estimatedCompletionDate: string
}

export interface DebtInsight {
  debtId: string
  name: string
  totalAmount: number
  installmentAmount: number
  paidSoFar: number
  remainingBalance: number
  progressPercent: number
  installmentsRemaining: number
  payoffDate: string | null
  desiredPayoffDate: string | null
  requiredInstallmentAmount: number
  isInstallmentEnough: boolean
  nextPaymentDate: string | null
  status: DebtStatus
  recurringAutomatically: boolean
}

export interface MonthlyComparison {
  primaryMonth: string
  secondaryMonth: string
  incomeDifference: number
  expenseDifference: number
  savingsDifference: number
  debtPaymentDifference: number
  closingBalanceDifference: number
}

export interface AnalyticsSnapshot {
  dashboard: DashboardMetrics
  categoryBudgets: CategoryBudgetInsight[]
  monthlyTrend: SpendingTrendPoint[]
  forecast: ForecastMetrics
  goalInsights: GoalInsight[]
  debtInsights: DebtInsight[]
  availableMonths: string[]
  highestSpendingCategories: Array<{
    categoryId: string
    categoryName: string
    amount: number
  }>
  budgetMethodUsed: BudgetMethod
  recommendations: string[]
}
