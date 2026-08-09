export type IncomeType = 'fixed' | 'variable'
export type ExpenseType = 'fixed' | 'variable'
export type PaymentMethod = 'cash' | 'bank' | 'card' | 'wallet' | 'transfer'
export type GoalType = 'emergency-fund' | 'device' | 'travel' | 'debt-payoff' | 'large-purchase' | 'general'
export type GoalPriority = 'high' | 'medium' | 'low'
export type DebtPaymentFrequency = 'monthly' | 'weekly'
export type ExpenseAllocationKind = 'spend' | 'saving' | 'goal-contribution'
export type CategoryType = 'essential' | 'lifestyle' | 'saving' | 'debt' | 'custom'

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
  type: CategoryType
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

export interface BudgetRule {
  categoryId: string
  percentage: number
  priorityWeight: number
  lockedAmount: number | null
}

export interface BudgetPlan {
  id: string
  month: string
  method: 'fifty-thirty-twenty' | 'zero-based' | 'custom-percentage' | 'priority-based' | 'goal-first' | 'debt-focused'
  customSavingsTarget: number
  customEmergencyTarget: number
  debtAcceleration: number
  notes: string
  rules: BudgetRule[]
}

export interface MonthlySummary {
  month: string
  income: number
  expenses: number
  savings: number
  debtPayments: number
  closingBalance: number
}

export interface Settings {
  language: 'en' | 'ar'
  currency: string
  locale: string
  theme: 'light' | 'dark'
  financialMonthStartDay: number
  defaultBudgetMethod: BudgetPlan['method']
  notificationsEnabled: boolean
  includeOptionalGoalsInForecast: boolean
  backupFrequency: 'manual' | 'weekly' | 'monthly'
  rtl: boolean
  balanceCorrection?: BalanceCorrection | null
}

export interface BalanceCorrection {
  id: string
  effectiveDate: string
  calculatedBalanceBefore: number
  correctedBalance: number
  difference: number
  note: string
  createdAt: string
  updatedAt: string
}

export interface FinanceState {
  incomes: IncomeRecord[]
  expenses: ExpenseRecord[]
  categories: Category[]
  goals: Goal[]
  debts: DebtRecord[]
  budgetPlans: BudgetPlan[]
  monthlySummaries: MonthlySummary[]
  settings: Settings
}

export type SyncEntityType = 'income' | 'expense' | 'category' | 'budget' | 'goal' | 'debt' | 'settings' | 'monthly-summary'

export interface SyncManifestEntry {
  entityType: SyncEntityType
  recordId: string
  lastSyncedHash: string | null
  remoteVersion: number
  updatedAt: string | null
  deletedAt: string | null
}

export interface SyncState {
  deviceId: string | null
    authToken: string | null
    refreshToken: string | null
    accessTokenExpiresAt: string | null
  userId: string | null
  accountEmail: string | null
    authMode: 'password' | null
  cursor: string | null
  bootstrapCompleted: boolean
  paused: boolean
  lastSyncAt: string | null
  lastError: string | null
  manifest: Record<string, SyncManifestEntry>
}

export interface RemoteSyncRecord {
  entityType: SyncEntityType
  recordId: string
  payload: Record<string, unknown>
  createdAt: string | null
  updatedAt: string
  deletedAt: string | null
  version: number
  lastModifiedByDeviceId: string | null
}

export interface PendingSyncChange {
  entityType: SyncEntityType
  recordId: string
  payload: Record<string, unknown>
  deletedAt: string | null
  baseVersion?: number
}

export interface DashboardAnalytics {
  currentMonth: string
  totalIncome: number
  totalExpenses: number
  remainingBalance: number
  fixedMonthlyExpenses: number
  variableExpensesThisMonth: number
  remainingAfterFixedExpenses: number
  remainingAfterFixedAndVariableExpenses: number
  debtBalance: number
  monthlyDebtPayments: number
  remainingGoalAmount: number
  remainingDaysInMonth: number
  remainingWeeksInMonth: number
  safeDailySpending: number
  safeWeeklySpending: number
  smartPlanner: {
    currentRemainingBalance: number
    remainingUsableBalance: number
    safeDailySpending: number
    safeWeeklySpending: number
    safeMonthlyFlexibleSpending: number
    remainingDaysInMonth: number
    remainingWeeksInMonth: number
    debtInstallmentsDueThisMonth: number
    plannedGoalContributionsThisMonth: number
    recommendedGoalContributionsThisMonth: number
    fixedAndRecurringExpensesStillDueThisMonth: number
    goalsIncludedInPlanner: boolean
    shortfallAmount: number
    status: 'comfortable' | 'tight' | 'risky' | 'not-enough'
  }
}
