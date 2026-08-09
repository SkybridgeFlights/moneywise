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
import type { FinanceRepository } from './finance-repository'

type MutationHook = (reason: string) => void

export class FinanceService {
  constructor(
    private readonly repository: FinanceRepository,
    private readonly onMutation?: MutationHook
  ) {}

  get capabilities(): RepositoryCapabilities {
    return this.repository.capabilities
  }

  getDomainState(): FinanceDomainState {
    return this.repository.getDomainState()
  }

  getSnapshot(): AppSnapshot {
    return this.repository.getSnapshot()
  }

  saveIncome(input: SaveIncomeInput): AppSnapshot {
    const snapshot = this.repository.saveIncome(input)
    this.onMutation?.('income.save')
    return snapshot
  }

  deleteIncome(id: string): AppSnapshot {
    const snapshot = this.repository.deleteIncome(id)
    this.onMutation?.('income.delete')
    return snapshot
  }

  saveExpense(input: SaveExpenseInput): AppSnapshot {
    const snapshot = this.repository.saveExpense(input)
    this.onMutation?.('expense.save')
    return snapshot
  }

  deleteExpense(id: string): AppSnapshot {
    const snapshot = this.repository.deleteExpense(id)
    this.onMutation?.('expense.delete')
    return snapshot
  }

  saveGoal(input: SaveGoalInput): AppSnapshot {
    const snapshot = this.repository.saveGoal(input)
    this.onMutation?.('goal.save')
    return snapshot
  }

  deleteGoal(id: string): AppSnapshot {
    const snapshot = this.repository.deleteGoal(id)
    this.onMutation?.('goal.delete')
    return snapshot
  }

  saveGoalContribution(input: SaveGoalContributionInput): AppSnapshot {
    const snapshot = this.repository.saveGoalContribution(input)
    this.onMutation?.('goalContribution.save')
    return snapshot
  }

  saveDebt(input: SaveDebtInput): AppSnapshot {
    const snapshot = this.repository.saveDebt(input)
    this.onMutation?.('debt.save')
    return snapshot
  }

  deleteDebt(id: string): AppSnapshot {
    const snapshot = this.repository.deleteDebt(id)
    this.onMutation?.('debt.delete')
    return snapshot
  }

  saveCategory(input: SaveCategoryInput): AppSnapshot {
    const snapshot = this.repository.saveCategory(input)
    this.onMutation?.('category.save')
    return snapshot
  }

  getCategoryDeletionImpact(id: string): CategoryDeletionImpact {
    return this.repository.getCategoryDeletionImpact(id)
  }

  deleteCategory(input: DeleteCategoryInput): AppSnapshot {
    const snapshot = this.repository.deleteCategory(input)
    this.onMutation?.('category.delete')
    return snapshot
  }

  saveBudgetPlan(input: SaveBudgetPlanInput): AppSnapshot {
    const snapshot = this.repository.saveBudgetPlan(input)
    this.onMutation?.('budget.save')
    return snapshot
  }

  saveSettings(input: Settings): AppSnapshot {
    const snapshot = this.repository.saveSettings(input)
    this.onMutation?.('settings.save')
    return snapshot
  }

  seedDemoData(): AppSnapshot {
    const snapshot = this.repository.seedDemoData()
    this.onMutation?.('data.seedDemo')
    return snapshot
  }

  resetData(): AppSnapshot {
    const snapshot = this.repository.resetData()
    this.onMutation?.('data.reset')
    return snapshot
  }

  exportData(format: 'json' | 'csv' | 'xlsx', targetPath: string): Promise<{ success: boolean; filePath: string }> {
    return this.repository.exportData(format, targetPath)
  }

  async importData(format: 'json' | 'csv' | 'xlsx', sourcePath: string): Promise<AppSnapshot> {
    const snapshot = await this.repository.importData(format, sourcePath)
    this.onMutation?.(`data.import.${format}`)
    return snapshot
  }

  runMonthlyClose(month: string): AppSnapshot {
    const snapshot = this.repository.runMonthlyClose(month)
    this.onMutation?.('month.close')
    return snapshot
  }
}
