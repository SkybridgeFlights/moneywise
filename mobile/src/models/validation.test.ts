import { describe, expect, it } from 'vitest'
import { debtSchema, expenseSchema, incomeSchema } from './validation'

describe('financial domain validation', () => {
  it('rejects non-finite and negative money', () => {
    const base = { id: 'i1', name: 'Salary', groupName: 'Work', date: '2026-08-09', type: 'fixed', recurring: true, notes: '' }
    expect(incomeSchema.safeParse({ ...base, amount: Number.NaN }).success).toBe(false)
    expect(incomeSchema.safeParse({ ...base, amount: Number.POSITIVE_INFINITY }).success).toBe(false)
    expect(incomeSchema.safeParse({ ...base, amount: -1 }).success).toBe(false)
  })

  it('rejects impossible calendar dates and inconsistent debts', () => {
    const debt = { id: 'd1', name: 'Loan', totalAmount: 1000, installmentAmount: 100, startDate: '2026-03-01', endDate: '2026-02-01', desiredPayoffDate: null, paymentFrequency: 'monthly', recurringAutomatically: true, categoryId: 'debt', notes: '' }
    expect(debtSchema.safeParse(debt).success).toBe(false)
    expect(debtSchema.safeParse({ ...debt, startDate: '2026-02-30', endDate: null }).success).toBe(false)
  })

  it('accepts a valid expense without coercing its values', () => {
    const expense = { id: 'e1', title: 'Rent', amount: 900, date: '2026-08-01', categoryId: 'housing', paymentMethod: 'bank', type: 'fixed', recurring: true, notes: '', tags: [], goalId: null, debtId: null, allocationKind: 'spend' }
    expect(expenseSchema.parse(expense)).toEqual(expense)
  })
})
