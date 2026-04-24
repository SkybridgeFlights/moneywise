import type { AppSnapshot, SaveBudgetPlanInput, SaveCategoryInput, SaveExpenseInput, SaveGoalInput, SaveIncomeInput } from '@shared/contracts'
import type { AppLanguage, BudgetMethod, Category, ExpenseRecord, Goal, Settings } from '@shared/types'
import type { getUiText } from '../lib/i18n'

export type UiText = ReturnType<typeof getUiText>

export interface ScreenBaseProps {
  snapshot: AppSnapshot
  fmtMoney: (value: number) => string
  actionsDisabled: boolean
  performAction: (label: string, action: () => Promise<AppSnapshot>) => Promise<boolean>
  language: AppLanguage
  text: UiText
}

export interface DashboardScreenProps extends ScreenBaseProps {
  setActiveTab: (tab: 'expenses' | 'budget' | 'debts') => void
  budgetMethodLabels: Record<BudgetMethod, string>
}

export interface IncomeScreenProps extends ScreenBaseProps {
  incomeForm: SaveIncomeInput
  setIncomeForm: (value: SaveIncomeInput) => void
  onSubmit: () => Promise<void>
}

export interface ExpensesScreenProps extends ScreenBaseProps {
  expenseForm: SaveExpenseInput
  setExpenseForm: (value: SaveExpenseInput) => void
  expenseSearch: string
  setExpenseSearch: (value: string) => void
  onSubmit: () => Promise<void>
}

export interface BudgetScreenProps extends ScreenBaseProps {
  currentBudgetPlan: SaveBudgetPlanInput
  updateBudgetMethod: (method: BudgetMethod) => Promise<void>
  budgetMethodLabels: Record<BudgetMethod, string>
}

export interface ReportsScreenProps extends ScreenBaseProps {
  filteredExpenses: ExpenseRecord[]
  expensePeriodLabel: string
  expensePeriodTotal: number
  expensePeriodAverageDaily: number
  expensePeriodChart: Array<{ categoryId: string; categoryName: string; amount: number; color: string }>
}

export interface GoalsScreenProps extends ScreenBaseProps {
  goalForm: SaveGoalInput
  setGoalForm: (value: SaveGoalInput) => void
  onSubmit: () => Promise<void>
}

export interface SettingsScreenProps extends ScreenBaseProps {
  settings: Settings
  updateSettings: (next: Settings) => Promise<void>
  categoryForm: SaveCategoryInput
  setCategoryForm: (value: SaveCategoryInput) => void
  onSubmitCategory: () => Promise<void>
}
