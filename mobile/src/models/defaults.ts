import type { Category, FinanceState, Settings, SyncState } from './types'

export const defaultSettings: Settings = {
  language: 'en',
  currency: 'USD',
  locale: 'en-US',
  theme: 'dark',
  financialMonthStartDay: 1,
  defaultBudgetMethod: 'zero-based',
  notificationsEnabled: true,
  includeOptionalGoalsInForecast: false,
  backupFrequency: 'weekly',
  rtl: false,
  balanceCorrection: null
}

export const defaultCategories: Category[] = ([
  { id: 'housing', name: 'Housing', type: 'essential', color: '#2563eb', icon: 'home', monthlyLimit: 1500, builtIn: true },
  { id: 'food', name: 'Food', type: 'essential', color: '#16a34a', icon: 'utensils', monthlyLimit: 500, builtIn: true },
  { id: 'transportation', name: 'Transportation', type: 'essential', color: '#f59e0b', icon: 'car', monthlyLimit: 250, builtIn: true },
  { id: 'savings', name: 'Savings', type: 'saving', color: '#22c55e', icon: 'piggy-bank', monthlyLimit: 400, builtIn: true },
  { id: 'debt', name: 'Debt / Installments', type: 'debt', color: '#dc2626', icon: 'wallet', monthlyLimit: 450, builtIn: true },
  { id: 'misc', name: 'Miscellaneous', type: 'custom', color: '#64748b', icon: 'circle', monthlyLimit: 150, builtIn: true }
] satisfies Category[]).map((entry) => ({ ...entry, monthlyLimit: entry.monthlyLimit === null ? null : entry.monthlyLimit * 100 }))

export function createDefaultFinanceState(): FinanceState {
  return {
    incomes: [],
    expenses: [],
    categories: defaultCategories,
    goals: [],
    debts: [],
    budgetPlans: [],
    monthlySummaries: [],
    settings: defaultSettings
  }
}

export function createEmptySyncState(): SyncState {
  return {
    deviceId: null,
      authToken: null,
      refreshToken: null,
      accessTokenExpiresAt: null,
    userId: null,
    accountEmail: null,
    authMode: null,
    cursor: null,
    bootstrapCompleted: false,
    paused: false,
    lastSyncAt: null,
    lastError: null,
    manifest: {}
  }
}
