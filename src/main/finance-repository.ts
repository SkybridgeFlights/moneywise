import type {
  AppSnapshot,
  DeleteCategoryInput,
  SaveBudgetPlanInput,
  SaveCategoryInput,
  SaveDebtInput,
  SaveExpenseInput,
  SaveGoalContributionInput,
  SaveGoalInput,
  SaveIncomeInput
} from '@shared/contracts'
import type { FinanceDomainState, RepositoryCapabilities } from '@shared/domain'
import type { CategoryDeletionImpact, Settings } from '@shared/types'

export interface FinanceRepository {
  readonly capabilities: RepositoryCapabilities
  getDomainState(): FinanceDomainState
  getSnapshot(): AppSnapshot
  saveIncome(input: SaveIncomeInput): AppSnapshot
  deleteIncome(id: string): AppSnapshot
  saveExpense(input: SaveExpenseInput): AppSnapshot
  deleteExpense(id: string): AppSnapshot
  saveGoal(input: SaveGoalInput): AppSnapshot
  deleteGoal(id: string): AppSnapshot
  saveGoalContribution(input: SaveGoalContributionInput): AppSnapshot
  saveDebt(input: SaveDebtInput): AppSnapshot
  deleteDebt(id: string): AppSnapshot
  saveCategory(input: SaveCategoryInput): AppSnapshot
  getCategoryDeletionImpact(id: string): CategoryDeletionImpact
  deleteCategory(input: DeleteCategoryInput): AppSnapshot
  saveBudgetPlan(input: SaveBudgetPlanInput): AppSnapshot
  saveSettings(input: Settings): AppSnapshot
  seedDemoData(): AppSnapshot
  resetData(): AppSnapshot
  exportData(format: 'json' | 'csv' | 'xlsx', targetPath: string): { success: boolean; filePath: string }
  importData(format: 'json' | 'csv' | 'xlsx', sourcePath: string): AppSnapshot
  runMonthlyClose(month: string): AppSnapshot
}
