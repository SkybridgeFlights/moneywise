import { z } from 'zod'
import { defaultSettings } from './defaults'

const trimmedString = (min = 0, max = 120) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(min).max(max))

const noteString = z
  .string()
  .transform((value) => value.replace(/\r\n/g, '\n').trim())
  .pipe(z.string().max(1000))

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const monthId = z.string().regex(/^\d{4}-\d{2}$/)
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const moneyNumber = z.number().finite().min(0).max(999999999)
const percentageNumber = z.number().finite().min(0).max(100)
const priorityWeight = z.number().finite().min(0).max(1000)

export const budgetMethodSchema = z.enum([
  'fifty-thirty-twenty',
  'zero-based',
  'custom-percentage',
  'priority-based',
  'goal-first',
  'debt-focused'
])

export const incomeInputSchema = z.object({
  id: trimmedString(1, 80).optional(),
  name: trimmedString(1, 120),
  groupName: trimmedString(1, 80),
  amount: moneyNumber,
  date: isoDate,
  type: z.enum(['fixed', 'variable']),
  recurring: z.boolean(),
  notes: noteString
})

export const expenseInputSchema = z.object({
  id: trimmedString(1, 80).optional(),
  title: trimmedString(1, 140),
  amount: moneyNumber,
  date: isoDate,
  categoryId: trimmedString(1, 80),
  paymentMethod: z.enum(['cash', 'bank', 'card', 'wallet', 'transfer']),
  type: z.enum(['fixed', 'variable']),
  recurring: z.boolean(),
  notes: noteString,
  tags: z.array(trimmedString(1, 30)).max(12),
  goalId: trimmedString(1, 80).nullable().optional().default(null),
  debtId: trimmedString(1, 80).nullable().optional().default(null),
  allocationKind: z.enum(['spend', 'saving', 'goal-contribution']).optional().default('spend')
})

export const goalInputSchema = z.object({
  id: trimmedString(1, 80).optional(),
  name: trimmedString(1, 120),
  type: z.enum(['emergency-fund', 'device', 'travel', 'debt-payoff', 'large-purchase', 'general']),
  targetAmount: moneyNumber,
  currentAmount: moneyNumber,
  targetDate: isoDate,
  priority: z.enum(['high', 'medium', 'low']),
  notes: noteString
})

export const goalContributionInputSchema = z.object({
  goalId: trimmedString(1, 80),
  amount: moneyNumber,
  date: isoDate,
  notes: noteString,
  categoryId: trimmedString(1, 80).optional(),
  paymentMethod: z.enum(['cash', 'bank', 'card', 'wallet', 'transfer']).optional()
})

export const goalContributionRecordSchema = z.object({
  id: trimmedString(1, 80).optional(),
  goalId: trimmedString(1, 80),
  expenseId: trimmedString(1, 80).optional(),
  amount: moneyNumber,
  date: isoDate,
  notes: noteString
})

export const debtInputSchema = z.object({
  id: trimmedString(1, 80).optional(),
  name: trimmedString(1, 120),
  totalAmount: moneyNumber,
  installmentAmount: moneyNumber,
  startDate: isoDate,
  endDate: isoDate.nullable(),
  desiredPayoffDate: isoDate.nullable(),
  paymentFrequency: z.enum(['monthly', 'weekly']),
  recurringAutomatically: z.boolean(),
  categoryId: trimmedString(1, 80),
  notes: noteString
})

export const categoryInputSchema = z.object({
  id: trimmedString(1, 80).optional(),
  name: trimmedString(1, 100),
  type: z.enum(['essential', 'lifestyle', 'saving', 'debt', 'custom']),
  color: hexColor,
  icon: trimmedString(1, 50),
  monthlyLimit: moneyNumber.nullable(),
  builtIn: z.boolean().optional()
})

export const budgetRuleSchema = z.object({
  categoryId: trimmedString(1, 80),
  percentage: percentageNumber,
  priorityWeight,
  lockedAmount: moneyNumber.nullable()
})

export const budgetPlanInputSchema = z.object({
  id: trimmedString(1, 80),
  month: monthId,
  method: budgetMethodSchema,
  customSavingsTarget: moneyNumber,
  customEmergencyTarget: moneyNumber,
  debtAcceleration: moneyNumber,
  notes: noteString,
  rules: z.array(budgetRuleSchema).max(100)
})

const balanceCorrectionSchema = z
  .object({
    id: trimmedString(1, 80),
    effectiveDate: z.string().datetime(),
    calculatedBalanceBefore: z.number().finite(),
    correctedBalance: z.number().finite(),
    difference: z.number().finite(),
    note: noteString,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .nullable()

export const settingsInputSchema = z.object({
  language: z.enum(['ar', 'en']),
  currency: z.string().regex(/^[A-Z]{3}$/),
  locale: trimmedString(2, 16),
  theme: z.enum(['light', 'dark']),
  financialMonthStartDay: z.number().int().min(1).max(28),
  defaultBudgetMethod: budgetMethodSchema,
  notificationsEnabled: z.boolean(),
  includeOptionalGoalsInForecast: z.boolean(),
  backupFrequency: z.enum(['manual', 'weekly', 'monthly']),
  rtl: z.boolean(),
  balanceCorrection: balanceCorrectionSchema.optional().default(null)
})

export const exportFormatSchema = z.enum(['json', 'csv', 'xlsx'])
export const importFormatSchema = exportFormatSchema
export const idSchema = trimmedString(1, 80)
export const monthSchema = monthId
export const booleanSchema = z.boolean()
export const deleteCategoryInputSchema = z.object({
  categoryId: trimmedString(1, 80),
  mode: z.enum(['reassign', 'fallback']),
  targetCategoryId: trimmedString(1, 80).optional()
})

export const snapshotImportSchema = z.object({
  incomes: z.array(incomeInputSchema).optional().default([]),
  expenses: z.array(expenseInputSchema).optional().default([]),
  goals: z.array(goalInputSchema).optional().default([]),
  goalContributions: z.array(goalContributionRecordSchema).optional().default([]),
  debts: z.array(debtInputSchema).optional().default([]),
  categories: z.array(categoryInputSchema).optional().default([]),
  budgetPlans: z.array(budgetPlanInputSchema).optional().default([]),
  settings: settingsInputSchema.optional().default(defaultSettings)
})
