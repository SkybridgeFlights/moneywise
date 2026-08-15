import { defaultCategories, defaultSettings } from '../models/defaults'
import type {
  BudgetPlan,
  Category,
  DebtRecord,
  ExpenseRecord,
  FinanceState,
  Goal,
  IncomeRecord,
  MonthlySummary,
  RemoteSyncRecord,
  Settings,
  SyncEntityType
} from '../models/types'
import { budgetSchema, categorySchema, debtSchema, expenseSchema, goalSchema, incomeSchema, monthlySummarySchema, settingsSchema } from '../models/validation'
import { parseMoneyDecimal } from '../models/money'

const SYNC_ENTITY_ORDER: SyncEntityType[] = ['settings', 'category', 'budget', 'goal', 'debt', 'income', 'expense', 'monthly-summary']

function round2(value: number): number {
  return Math.round(value)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function monthId(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export function parseDecimalInput(value: string, fallback = 0): number {
  return parseMoneyDecimal(value, fallback)
}

export function ensureSeedState(state: FinanceState): FinanceState {
  return {
    ...state,
    categories: state.categories.length > 0 ? state.categories : defaultCategories,
    settings: {
      ...defaultSettings,
      ...state.settings
    }
  }
}

export function buildSyncRecordKey(entityType: SyncEntityType, recordId: string): string {
  return `${entityType}:${recordId}`
}

export function buildSyncableStateIndex(state: FinanceState): Map<string, { entityType: SyncEntityType; recordId: string; payload: Record<string, unknown> }> {
  const index = new Map<string, { entityType: SyncEntityType; recordId: string; payload: Record<string, unknown> }>()
  const pushEntry = (entityType: SyncEntityType, recordId: string, payload: Record<string, unknown>): void => {
    index.set(buildSyncRecordKey(entityType, recordId), { entityType, recordId, payload: { ...payload, moneyVersion: 2 } })
  }

  pushEntry('settings', 'settings', state.settings as unknown as Record<string, unknown>)
  state.categories.forEach((entry) => pushEntry('category', entry.id, entry as unknown as Record<string, unknown>))
  state.budgetPlans.forEach((entry) => pushEntry('budget', entry.id, entry as unknown as Record<string, unknown>))
  state.goals.forEach((entry) => pushEntry('goal', entry.id, entry as unknown as Record<string, unknown>))
  state.debts.forEach((entry) => pushEntry('debt', entry.id, entry as unknown as Record<string, unknown>))
  state.incomes.forEach((entry) => pushEntry('income', entry.id, entry as unknown as Record<string, unknown>))
  state.expenses.forEach((entry) => pushEntry('expense', entry.id, entry as unknown as Record<string, unknown>))
  state.monthlySummaries.forEach((entry) => pushEntry('monthly-summary', entry.month, entry as unknown as Record<string, unknown>))

  return index
}

function upsertById<T extends { id: string }>(collection: T[], record: T): T[] {
  const existingIndex = collection.findIndex((entry) => entry.id === record.id)
  if (existingIndex >= 0) {
    return collection.map((entry, index) => (index === existingIndex ? record : entry))
  }
  return [record, ...collection]
}

function upsertSummary(collection: MonthlySummary[], record: MonthlySummary): MonthlySummary[] {
  const existingIndex = collection.findIndex((entry) => entry.month === record.month)
  if (existingIndex >= 0) {
    return collection.map((entry, index) => (index === existingIndex ? record : entry))
  }
  return [record, ...collection]
}

export function upsertIncome(state: FinanceState, input: Partial<IncomeRecord>): FinanceState {
  const record = incomeSchema.parse({
    id: input.id ?? createId('income'),
    name: input.name?.trim() || 'New income',
    groupName: input.groupName?.trim() || 'Primary',
    amount: round2(Number(input.amount ?? 0)),
    date: input.date || today(),
    type: input.type ?? 'fixed',
    recurring: input.recurring ?? false,
    notes: input.notes ?? ''
  }) as IncomeRecord
  return {
    ...state,
    incomes: upsertById(state.incomes, record)
  }
}

export function upsertExpense(state: FinanceState, input: Partial<ExpenseRecord>): FinanceState {
  const fallbackCategoryId = state.categories[0]?.id ?? 'misc'
  const debtCategoryId = state.categories.find((entry) => entry.type === 'debt')?.id ?? fallbackCategoryId
  const categoryId = input.debtId ? debtCategoryId : input.categoryId ?? fallbackCategoryId
  const record = expenseSchema.parse({
    id: input.id ?? createId('expense'),
    title: input.title?.trim() || 'New expense',
    amount: round2(Number(input.amount ?? 0)),
    date: input.date || today(),
    categoryId,
    paymentMethod: input.paymentMethod ?? 'card',
    type: input.type ?? 'variable',
    recurring: input.recurring ?? false,
    notes: input.notes ?? '',
    tags: input.tags ?? [],
    goalId: input.goalId ?? null,
    debtId: input.debtId ?? null,
    allocationKind: input.goalId ? 'goal-contribution' : input.allocationKind ?? 'spend'
  }) as ExpenseRecord
  return {
    ...state,
    expenses: upsertById(state.expenses, record)
  }
}

export function upsertGoal(state: FinanceState, input: Partial<Goal>): FinanceState {
  const record = goalSchema.parse({
    id: input.id ?? createId('goal'),
    name: input.name?.trim() || 'New goal',
    type: input.type ?? 'general',
    targetAmount: round2(Number(input.targetAmount ?? 0)),
    currentAmount: round2(Number(input.currentAmount ?? 0)),
    targetDate: input.targetDate || today(),
    priority: input.priority ?? 'medium',
    notes: input.notes ?? ''
  }) as Goal
  return {
    ...state,
    goals: upsertById(state.goals, record)
  }
}

export function upsertDebt(state: FinanceState, input: Partial<DebtRecord>): FinanceState {
  const debtCategoryId = state.categories.find((entry) => entry.type === 'debt')?.id ?? 'debt'
  const record = debtSchema.parse({
    id: input.id ?? createId('debt'),
    name: input.name?.trim() || 'New debt',
    totalAmount: round2(Number(input.totalAmount ?? 0)),
    installmentAmount: round2(Number(input.installmentAmount ?? 0)),
    startDate: input.startDate || today(),
    endDate: input.endDate ?? null,
    desiredPayoffDate: input.desiredPayoffDate ?? null,
    paymentFrequency: input.paymentFrequency ?? 'monthly',
    recurringAutomatically: input.recurringAutomatically ?? true,
    categoryId: input.categoryId ?? debtCategoryId,
    notes: input.notes ?? ''
  }) as DebtRecord
  return {
    ...state,
    debts: upsertById(state.debts, record)
  }
}

export function updateSettings(state: FinanceState, input: Partial<Settings>): FinanceState {
  return {
    ...state,
    settings: settingsSchema.parse({
      ...state.settings,
      ...input
    }) as Settings
  }
}

export function deleteEntity(state: FinanceState, entityType: 'income' | 'expense' | 'goal' | 'debt', id: string): FinanceState {
  switch (entityType) {
    case 'income':
      return { ...state, incomes: state.incomes.filter((entry) => entry.id !== id) }
    case 'expense':
      return { ...state, expenses: state.expenses.filter((entry) => entry.id !== id) }
    case 'goal':
      return {
        ...state,
        goals: state.goals.filter((entry) => entry.id !== id),
        expenses: state.expenses.map((entry) =>
          entry.goalId === id ? { ...entry, goalId: null, allocationKind: 'spend' } : entry
        )
      }
    case 'debt':
      return {
        ...state,
        debts: state.debts.filter((entry) => entry.id !== id),
        expenses: state.expenses.map((entry) => (entry.debtId === id ? { ...entry, debtId: null } : entry))
      }
    default:
      return state
  }
}

function fallbackCategoryId(state: FinanceState, preferredType: Category['type'] | 'any' = 'any'): string {
  const preferred = preferredType === 'debt' ? state.categories.find((entry) => entry.type === 'debt')?.id : null
  if (preferred) {
    return preferred
  }
  return state.categories.find((entry) => entry.id === 'misc')?.id ?? state.categories[0]?.id ?? 'misc'
}

function applyRemoteDelete(state: FinanceState, entityType: SyncEntityType, recordId: string): FinanceState {
  switch (entityType) {
    case 'income':
      return { ...state, incomes: state.incomes.filter((entry) => entry.id !== recordId) }
    case 'expense':
      return { ...state, expenses: state.expenses.filter((entry) => entry.id !== recordId) }
    case 'goal':
      return deleteEntity(state, 'goal', recordId)
    case 'debt':
      return deleteEntity(state, 'debt', recordId)
    case 'budget':
      return { ...state, budgetPlans: state.budgetPlans.filter((entry) => entry.id !== recordId) }
    case 'monthly-summary':
      return { ...state, monthlySummaries: state.monthlySummaries.filter((entry) => entry.month !== recordId) }
    case 'settings':
      return { ...state, settings: defaultSettings }
    case 'category': {
      const nextFallback = fallbackCategoryId(state)
      return {
        ...state,
        categories: state.categories.filter((entry) => entry.id !== recordId),
        expenses: state.expenses.map((entry) => (entry.categoryId === recordId ? { ...entry, categoryId: nextFallback } : entry)),
        debts: state.debts.map((entry) => (entry.categoryId === recordId ? { ...entry, categoryId: fallbackCategoryId(state, 'debt') } : entry))
      }
    }
    default:
      return state
  }
}

function sortRemoteChanges(changes: RemoteSyncRecord[]): RemoteSyncRecord[] {
  return [...changes].sort((left, right) => {
    if (Boolean(left.deletedAt) !== Boolean(right.deletedAt)) {
      return left.deletedAt ? 1 : -1
    }
    const leftIndex = SYNC_ENTITY_ORDER.indexOf(left.entityType)
    const rightIndex = SYNC_ENTITY_ORDER.indexOf(right.entityType)
    return left.deletedAt ? rightIndex - leftIndex : leftIndex - rightIndex
  })
}

export function applyRemoteSyncChanges(state: FinanceState, changes: RemoteSyncRecord[]): FinanceState {
  return sortRemoteChanges(changes).reduce((current, change) => {
    if (change.deletedAt) {
      return applyRemoteDelete(current, change.entityType, change.recordId)
    }

    switch (change.entityType) {
      case 'income':
        return upsertIncome(current, incomeSchema.parse({ ...change.payload, id: change.recordId }))
      case 'expense':
        return upsertExpense(current, expenseSchema.parse({ ...change.payload, id: change.recordId }))
      case 'goal':
        return upsertGoal(current, goalSchema.parse({ ...change.payload, id: change.recordId }))
      case 'debt':
        return upsertDebt(current, debtSchema.parse({ ...change.payload, id: change.recordId }))
      case 'category': {
        const category = categorySchema.parse({ ...change.payload, id: change.recordId }) as Category
        return { ...current, categories: upsertById(current.categories, category) }
      }
      case 'budget': {
        const budget = budgetSchema.parse({ ...change.payload, id: change.recordId }) as BudgetPlan
        return { ...current, budgetPlans: upsertById(current.budgetPlans, budget) }
      }
      case 'monthly-summary': {
        const summary = monthlySummarySchema.parse({ ...change.payload, month: change.recordId }) as MonthlySummary
        return { ...current, monthlySummaries: upsertSummary(current.monthlySummaries, summary) }
      }
      case 'settings': {
        return {
          ...current,
          settings: settingsSchema.parse(change.payload) as Settings
        }
      }
      default:
        return current
    }
  }, state)
}
