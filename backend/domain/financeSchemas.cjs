const { z } = require('zod')

const id = z.string().trim().min(1).max(120)
const text = (max) => z.string().trim().min(1).max(max)
const note = z.string().max(1000)
const money = z.number().finite().min(0).max(999999999)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, 'Invalid calendar date')
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
const budgetMethod = z.enum(['fifty-thirty-twenty', 'zero-based', 'custom-percentage', 'priority-based', 'goal-first', 'debt-focused'])

const income = z.object({ id, name: text(120), groupName: text(80), amount: money, date, type: z.enum(['fixed', 'variable']), recurring: z.boolean(), notes: note })
const expense = z.object({ id, title: text(140), amount: money, date, categoryId: id, paymentMethod: z.enum(['cash', 'bank', 'card', 'wallet', 'transfer']), type: z.enum(['fixed', 'variable']), recurring: z.boolean(), notes: note, tags: z.array(text(30)).max(12), goalId: id.nullable(), debtId: id.nullable(), allocationKind: z.enum(['spend', 'saving', 'goal-contribution']) })
const category = z.object({ id, name: text(100), type: z.enum(['essential', 'lifestyle', 'saving', 'debt', 'custom']), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), icon: text(50), monthlyLimit: money.nullable(), builtIn: z.boolean() })
const goal = z.object({ id, name: text(120), type: z.enum(['emergency-fund', 'device', 'travel', 'debt-payoff', 'large-purchase', 'general']), targetAmount: money, currentAmount: money, targetDate: date, priority: z.enum(['high', 'medium', 'low']), notes: note })
const debt = z.object({ id, name: text(120), totalAmount: money, installmentAmount: money, startDate: date, endDate: date.nullable(), desiredPayoffDate: date.nullable(), paymentFrequency: z.enum(['monthly', 'weekly']), recurringAutomatically: z.boolean(), categoryId: id, notes: note }).refine((value) => !value.endDate || value.endDate >= value.startDate, { message: 'Debt end date cannot precede start date', path: ['endDate'] })
const budget = z.object({ id, month, method: budgetMethod, customSavingsTarget: money, customEmergencyTarget: money, debtAcceleration: money, notes: note, rules: z.array(z.object({ categoryId: id, percentage: z.number().finite().min(0).max(100), priorityWeight: z.number().finite().min(0).max(1000), lockedAmount: money.nullable() })).max(100) })
const settings = z.object({ language: z.enum(['ar', 'en']), currency: z.string().regex(/^[A-Z]{3}$/), locale: z.string().min(2).max(16), theme: z.enum(['light', 'dark']), financialMonthStartDay: z.number().int().min(1).max(28), defaultBudgetMethod: budgetMethod, notificationsEnabled: z.boolean(), includeOptionalGoalsInForecast: z.boolean(), backupFrequency: z.enum(['manual', 'weekly', 'monthly']), rtl: z.boolean(), balanceCorrection: z.unknown().nullable().optional() })
const monthlySummary = z.object({ month, income: money, expenses: money, savings: z.number().finite(), debtPayments: money, closingBalance: z.number().finite() })

const financePayloadSchemas = { income, expense, category, budget, goal, debt, settings, 'monthly-summary': monthlySummary }
module.exports = { financePayloadSchemas, date, money }
