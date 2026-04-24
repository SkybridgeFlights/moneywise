import type { BudgetPlan, Category, DebtRecord, Goal, IncomeRecord, ExpenseRecord, Settings } from './types'

export const defaultSettings: Settings = {
  language: 'ar',
  currency: 'USD',
  locale: 'ar-EG',
  theme: 'dark',
  financialMonthStartDay: 1,
  defaultBudgetMethod: 'goal-first',
  notificationsEnabled: true,
  includeOptionalGoalsInForecast: false,
  backupFrequency: 'weekly',
  rtl: true
}

export const defaultCategories: Category[] = [
  { id: 'housing', name: 'Housing / Rent', type: 'essential', color: '#3b82f6', icon: 'building', monthlyLimit: 1800, builtIn: true },
  { id: 'food', name: 'Food / Groceries', type: 'essential', color: '#10b981', icon: 'utensils', monthlyLimit: 650, builtIn: true },
  { id: 'transportation', name: 'Transportation', type: 'essential', color: '#f59e0b', icon: 'car', monthlyLimit: 350, builtIn: true },
  { id: 'utilities', name: 'Utilities', type: 'essential', color: '#06b6d4', icon: 'bolt', monthlyLimit: 280, builtIn: true },
  { id: 'internet-phone', name: 'Internet / Phone', type: 'essential', color: '#8b5cf6', icon: 'wifi', monthlyLimit: 160, builtIn: true },
  { id: 'health', name: 'Health', type: 'essential', color: '#ef4444', icon: 'heart-pulse', monthlyLimit: 220, builtIn: true },
  { id: 'education', name: 'Education', type: 'essential', color: '#0f766e', icon: 'graduation-cap', monthlyLimit: 200, builtIn: true },
  { id: 'entertainment', name: 'Entertainment', type: 'lifestyle', color: '#ec4899', icon: 'film', monthlyLimit: 180, builtIn: true },
  { id: 'shopping', name: 'Shopping', type: 'lifestyle', color: '#f97316', icon: 'shopping-bag', monthlyLimit: 240, builtIn: true },
  { id: 'debt', name: 'Debt / Installments', type: 'debt', color: '#dc2626', icon: 'wallet-cards', monthlyLimit: 420, builtIn: true },
  { id: 'savings', name: 'Savings', type: 'saving', color: '#22c55e', icon: 'piggy-bank', monthlyLimit: 600, builtIn: true },
  { id: 'investments', name: 'Investments', type: 'saving', color: '#14b8a6', icon: 'chart-column', monthlyLimit: 250, builtIn: true },
  { id: 'family', name: 'Family', type: 'essential', color: '#6366f1', icon: 'users', monthlyLimit: 300, builtIn: true },
  { id: 'emergency', name: 'Emergency', type: 'saving', color: '#84cc16', icon: 'shield-alert', monthlyLimit: 350, builtIn: true },
  { id: 'misc', name: 'Miscellaneous', type: 'custom', color: '#64748b', icon: 'ellipsis', monthlyLimit: 150, builtIn: true }
]

const now = new Date()
const yyyyMm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
const dateInCurrentMonth = (day: number): string =>
  `${yyyyMm}-${String(Math.min(day, 28)).padStart(2, '0')}`

export const demoIncomes: IncomeRecord[] = [
  {
    id: 'income-1',
    name: 'Primary Salary',
    groupName: 'Employment',
    amount: 4200,
    date: dateInCurrentMonth(1),
    type: 'fixed',
    recurring: true,
    notes: 'Main monthly salary'
  },
  {
    id: 'income-2',
    name: 'Freelance Design',
    groupName: 'Side Hustle',
    amount: 720,
    date: dateInCurrentMonth(14),
    type: 'variable',
    recurring: false,
    notes: 'Additional project income'
  }
]

export const demoExpenses: ExpenseRecord[] = [
  { id: 'expense-1', title: 'Apartment Rent', amount: 1350, date: dateInCurrentMonth(2), categoryId: 'housing', paymentMethod: 'bank', type: 'fixed', recurring: true, notes: 'Monthly rent', tags: ['home'], goalId: null, debtId: null, allocationKind: 'spend' },
  { id: 'expense-2', title: 'Groceries', amount: 420, date: dateInCurrentMonth(5), categoryId: 'food', paymentMethod: 'card', type: 'variable', recurring: true, notes: 'Weekly family groceries', tags: ['family', 'essentials'], goalId: null, debtId: null, allocationKind: 'spend' },
  { id: 'expense-3', title: 'Fuel and transit', amount: 180, date: dateInCurrentMonth(7), categoryId: 'transportation', paymentMethod: 'card', type: 'variable', recurring: true, notes: 'Fuel + metro card', tags: ['commute'], goalId: null, debtId: null, allocationKind: 'spend' },
  { id: 'expense-4', title: 'Electricity and water', amount: 155, date: dateInCurrentMonth(8), categoryId: 'utilities', paymentMethod: 'bank', type: 'fixed', recurring: true, notes: 'Utility bundle', tags: ['home'], goalId: null, debtId: null, allocationKind: 'spend' },
  { id: 'expense-5', title: 'Internet and mobile', amount: 92, date: dateInCurrentMonth(9), categoryId: 'internet-phone', paymentMethod: 'bank', type: 'fixed', recurring: true, notes: 'Fiber and mobile plans', tags: ['connectivity'], goalId: null, debtId: null, allocationKind: 'spend' },
  { id: 'expense-6', title: 'Debt installment', amount: 380, date: dateInCurrentMonth(10), categoryId: 'debt', paymentMethod: 'bank', type: 'fixed', recurring: true, notes: 'Laptop financing', tags: ['debt'], goalId: null, debtId: 'debt-1', allocationKind: 'spend' },
  { id: 'expense-7', title: 'Emergency fund transfer', amount: 250, date: dateInCurrentMonth(12), categoryId: 'emergency', paymentMethod: 'transfer', type: 'fixed', recurring: true, notes: 'Emergency reserve', tags: ['savings'], goalId: 'goal-1', debtId: null, allocationKind: 'goal-contribution' },
  { id: 'expense-8', title: 'Travel savings', amount: 180, date: dateInCurrentMonth(13), categoryId: 'savings', paymentMethod: 'transfer', type: 'fixed', recurring: true, notes: 'Vacation fund', tags: ['goal'], goalId: 'goal-2', debtId: null, allocationKind: 'goal-contribution' },
  { id: 'expense-9', title: 'Streaming and cinema', amount: 95, date: dateInCurrentMonth(16), categoryId: 'entertainment', paymentMethod: 'card', type: 'variable', recurring: false, notes: 'Weekend entertainment', tags: ['lifestyle'], goalId: null, debtId: null, allocationKind: 'spend' },
  { id: 'expense-10', title: 'Family support', amount: 210, date: dateInCurrentMonth(18), categoryId: 'family', paymentMethod: 'transfer', type: 'fixed', recurring: true, notes: 'Monthly family support', tags: ['family'], goalId: null, debtId: null, allocationKind: 'spend' },
  { id: 'expense-11', title: 'New clothes', amount: 140, date: dateInCurrentMonth(20), categoryId: 'shopping', paymentMethod: 'card', type: 'variable', recurring: false, notes: 'Seasonal clothes', tags: ['shopping'], goalId: null, debtId: null, allocationKind: 'spend' },
  { id: 'expense-12', title: 'Pharmacy', amount: 68, date: dateInCurrentMonth(21), categoryId: 'health', paymentMethod: 'cash', type: 'variable', recurring: false, notes: 'Medication', tags: ['health'], goalId: null, debtId: null, allocationKind: 'spend' }
]

export const demoDebts: DebtRecord[] = [
  {
    id: 'debt-1',
    name: 'Laptop financing',
    totalAmount: 2280,
    installmentAmount: 380,
    startDate: dateInCurrentMonth(10),
    endDate: null,
    desiredPayoffDate: null,
    paymentFrequency: 'monthly',
    recurringAutomatically: true,
    categoryId: 'debt',
    notes: 'Stops automatically after full payoff.'
  }
]

export const demoGoals: Goal[] = [
  {
    id: 'goal-1',
    name: 'Emergency Fund',
    type: 'emergency-fund',
    targetAmount: 8000,
    currentAmount: 2450,
    targetDate: `${now.getFullYear() + 1}-06-30`,
    priority: 'high',
    notes: 'Target six months of core expenses'
  },
  {
    id: 'goal-2',
    name: 'Travel to Istanbul',
    type: 'travel',
    targetAmount: 2200,
    currentAmount: 640,
    targetDate: `${now.getFullYear()}-12-01`,
    priority: 'medium',
    notes: 'Short trip fund'
  }
]

export const demoBudgetPlan: BudgetPlan = {
  id: 'budget-main',
  month: yyyyMm,
  method: 'goal-first',
  customSavingsTarget: 550,
  customEmergencyTarget: 300,
  debtAcceleration: 80,
  notes: 'Default monthly plan with strong goal funding.',
  rules: defaultCategories.map((category, index) => ({
    categoryId: category.id,
    percentage: category.type === 'essential' ? 8 : category.type === 'saving' ? 6 : category.type === 'debt' ? 10 : 4,
    priorityWeight: category.type === 'essential' ? 10 : category.type === 'saving' ? 9 : category.type === 'debt' ? 8 : 5,
    lockedAmount: index < 6 ? category.monthlyLimit : null
  }))
}
