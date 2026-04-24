import type {
  ActivityLogItem,
  AlertItem,
  BudgetPlan,
  Category,
  DebtRecord,
  ExpenseRecord,
  Goal,
  GoalContribution,
  IncomeRecord,
  MonthlySummary,
  RecurringTransaction,
  Settings
} from './types'

export type FinanceEntityName =
  | 'income'
  | 'expense'
  | 'category'
  | 'goal'
  | 'goalContribution'
  | 'debt'
  | 'budgetPlan'
  | 'recurringTransaction'
  | 'alert'
  | 'activityLog'
  | 'monthlySummary'
  | 'settings'

export interface SyncIdentity {
  id: string
}

export interface FinanceDomainState {
  incomes: IncomeRecord[]
  expenses: ExpenseRecord[]
  categories: Category[]
  goals: Goal[]
  goalContributions: GoalContribution[]
  debts: DebtRecord[]
  budgetPlans: BudgetPlan[]
  recurringTransactions: RecurringTransaction[]
  alerts: AlertItem[]
  settings: Settings
  activityLog: ActivityLogItem[]
  monthlySummaries: MonthlySummary[]
}

export interface RepositoryCapabilities {
  localPersistence: true
  remoteSync: boolean
  conflictDetection: boolean
}
