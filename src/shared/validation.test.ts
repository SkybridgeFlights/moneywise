import { describe, expect, it } from 'vitest'
import { debtInputSchema, expenseInputSchema } from './validation'

const expense = { title: 'Groceries', amount: 10, date: '2026-08-09', categoryId: 'food', paymentMethod: 'card', type: 'variable', recurring: false, notes: '', tags: [], goalId: null, debtId: null, allocationKind: 'spend' }

describe('finance domain validation', () => {
  it('rejects non-finite and negative financial values', () => {
    expect(expenseInputSchema.safeParse({ ...expense, amount: Number.POSITIVE_INFINITY }).success).toBe(false)
    expect(expenseInputSchema.safeParse({ ...expense, amount: -0.01 }).success).toBe(false)
  })

  it('rejects impossible calendar dates', () => {
    expect(expenseInputSchema.safeParse({ ...expense, date: '2026-02-30' }).success).toBe(false)
  })

  it('rejects debt end dates before the start date', () => {
    expect(debtInputSchema.safeParse({ id: 'debt', name: 'Loan', totalAmount: 100, installmentAmount: 10, startDate: '2026-08-09', endDate: '2026-08-08', desiredPayoffDate: null, paymentFrequency: 'monthly', recurringAutomatically: true, categoryId: 'debt', notes: '' }).success).toBe(false)
  })
})
