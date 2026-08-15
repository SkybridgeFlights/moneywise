import { z } from 'zod'

const id = z.string().trim().min(1).max(120)
const text = (max: number) => z.string().trim().min(1).max(max)
const note = z.string().max(1000)
const money = z.number().int().min(0).max(99999999999)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, 'Invalid calendar date')
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
const budgetMethod = z.enum(['fifty-thirty-twenty', 'zero-based', 'custom-percentage', 'priority-based', 'goal-first', 'debt-focused'])

export const incomeSchema = z.object({ id, name: text(120), groupName: text(80), amount: money, date, type: z.enum(['fixed', 'variable']), recurring: z.boolean(), notes: note })
export const expenseSchema = z.object({ id, title: text(140), amount: money, date, categoryId: id, paymentMethod: z.enum(['cash', 'bank', 'card', 'wallet', 'transfer']), type: z.enum(['fixed', 'variable']), recurring: z.boolean(), notes: note, tags: z.array(text(30)).max(12), goalId: id.nullable(), debtId: id.nullable(), allocationKind: z.enum(['spend', 'saving', 'goal-contribution']) })
export const categorySchema = z.object({ id, name: text(100), type: z.enum(['essential', 'lifestyle', 'saving', 'debt', 'custom']), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), icon: text(50), monthlyLimit: money.nullable(), builtIn: z.boolean() })
export const goalSchema = z.object({ id, name: text(120), type: z.enum(['emergency-fund', 'device', 'travel', 'debt-payoff', 'large-purchase', 'general']), targetAmount: money, currentAmount: money, targetDate: date, priority: z.enum(['high', 'medium', 'low']), notes: note })
export const debtSchema = z.object({ id, name: text(120), totalAmount: money, installmentAmount: money, startDate: date, endDate: date.nullable(), desiredPayoffDate: date.nullable(), paymentFrequency: z.enum(['monthly', 'weekly']), recurringAutomatically: z.boolean(), categoryId: id, notes: note }).refine((value) => !value.endDate || value.endDate >= value.startDate, { message: 'Debt end date cannot precede start date', path: ['endDate'] })
export const budgetSchema = z.object({ id, month, method: budgetMethod, customSavingsTarget: money, customEmergencyTarget: money, debtAcceleration: money, notes: note, rules: z.array(z.object({ categoryId: id, percentage: z.number().finite().min(0).max(100), priorityWeight: z.number().finite().min(0).max(1000), lockedAmount: money.nullable() })).max(100) })
export const monthlySummarySchema = z.object({ month, income: money, expenses: money, savings: z.number().int().min(-99999999999).max(99999999999), debtPayments: money, closingBalance: z.number().int().min(-99999999999).max(99999999999) })
export const settingsSchema = z.object({ language: z.enum(['en', 'ar']), currency: z.string().regex(/^[A-Z]{3}$/), locale: z.string().min(2).max(16), theme: z.enum(['light', 'dark']), financialMonthStartDay: z.number().int().min(1).max(28), defaultBudgetMethod: budgetMethod, notificationsEnabled: z.boolean(), includeOptionalGoalsInForecast: z.boolean(), backupFrequency: z.enum(['manual', 'weekly', 'monthly']), rtl: z.boolean(), balanceCorrection: z.unknown().nullable().optional() })

const moneyVersion = z.object({ moneyVersion: z.literal(2) })
export const syncPayloadSchemas = {
  income: incomeSchema.and(moneyVersion), expense: expenseSchema.and(moneyVersion), category: categorySchema.and(moneyVersion),
  budget: budgetSchema.and(moneyVersion), goal: goalSchema.and(moneyVersion), debt: debtSchema.and(moneyVersion),
  settings: settingsSchema.and(moneyVersion), 'monthly-summary': monthlySummarySchema.and(moneyVersion)
}
