import type {
  AnalyticsSnapshot,
  BudgetPlan,
  Category,
  CategoryDeletionImpact,
  DebtRecord,
  ExpenseRecord,
  Goal,
  IncomeRecord,
  Settings
} from './types'
import type { FinanceDomainState } from './domain'

export interface AppSnapshot extends FinanceDomainState {
  analytics: AnalyticsSnapshot
}

export type SaveIncomeInput = Omit<IncomeRecord, 'id'> & { id?: string }
export type SaveExpenseInput = Omit<ExpenseRecord, 'id' | 'goalId' | 'debtId' | 'allocationKind'> & {
  id?: string
  goalId?: string | null
  debtId?: string | null
  allocationKind?: ExpenseRecord['allocationKind']
}
export type SaveGoalInput = Omit<Goal, 'id'> & { id?: string }
export type SaveDebtInput = Omit<DebtRecord, 'id'> & { id?: string }
export type SaveCategoryInput = Omit<Category, 'id' | 'builtIn'> & { id?: string; builtIn?: boolean }
export type SaveBudgetPlanInput = BudgetPlan
export type SaveGoalContributionInput = {
  goalId: string
  amount: number
  date: string
  notes: string
  categoryId?: string
  paymentMethod?: ExpenseRecord['paymentMethod']
}
export type DeleteCategoryInput = {
  categoryId: string
  mode: 'reassign' | 'fallback'
  targetCategoryId?: string
}

export interface SyncStatusSnapshot {
  enabled: boolean
  paused: boolean
  backendUrl: string | null
  deviceId: string | null
  userId: string | null
  accountEmail: string | null
  authMode: 'dev-session' | 'password' | null
  backendReachable: boolean
  bootstrapCompleted: boolean
  pendingChanges: number
  lastSyncAt: string | null
  lastError: string | null
  phase: 'disabled' | 'idle' | 'syncing' | 'error'
}

export interface MoneywiseApi {
  getSnapshot(): Promise<AppSnapshot>
  getSyncStatus(): Promise<SyncStatusSnapshot>
  syncNow(): Promise<SyncStatusSnapshot>
  setSyncPaused(paused: boolean): Promise<SyncStatusSnapshot>
  uploadAllLocalData(): Promise<SyncStatusSnapshot>
  saveIncome(input: SaveIncomeInput): Promise<AppSnapshot>
  deleteIncome(id: string): Promise<AppSnapshot>
  saveExpense(input: SaveExpenseInput): Promise<AppSnapshot>
  deleteExpense(id: string): Promise<AppSnapshot>
  saveGoal(input: SaveGoalInput): Promise<AppSnapshot>
  deleteGoal(id: string): Promise<AppSnapshot>
  saveGoalContribution(input: SaveGoalContributionInput): Promise<AppSnapshot>
  saveDebt(input: SaveDebtInput): Promise<AppSnapshot>
  deleteDebt(id: string): Promise<AppSnapshot>
  saveCategory(input: SaveCategoryInput): Promise<AppSnapshot>
  getCategoryDeletionImpact(id: string): Promise<CategoryDeletionImpact>
  deleteCategory(input: DeleteCategoryInput): Promise<AppSnapshot>
  saveBudgetPlan(input: SaveBudgetPlanInput): Promise<AppSnapshot>
  saveSettings(input: Settings): Promise<AppSnapshot>
  seedDemoData(): Promise<AppSnapshot>
  resetData(): Promise<AppSnapshot>
  exportData(format: 'json' | 'csv' | 'xlsx'): Promise<{ success: boolean; filePath?: string }>
  importData(format: 'json' | 'csv' | 'xlsx'): Promise<AppSnapshot>
  runMonthlyClose(month: string): Promise<AppSnapshot>
}
