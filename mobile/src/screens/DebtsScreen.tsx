import React, { useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { FormScreen } from '../components/FormScreen'
import { Button, StateView } from '../components/ui'
import { palette, statusPalette } from '../theme/tokens'
import { LabeledInput } from '../components/LabeledInput'
import { RecordCard } from '../components/RecordCard'
import type { DebtRecord, ExpenseRecord } from '../models/types'
import { parseDecimalInput } from '../services/repository'
import { formatMoneyDecimal, moneyDisplayNumber } from '../models/money'

interface DebtsScreenProps {
  records: DebtRecord[]
  expenses: ExpenseRecord[]
  currency: string
  onSave: (input: Partial<DebtRecord>) => void
  onDelete: (id: string) => void
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(moneyDisplayNumber(value))
}

export function DebtsScreen({ records, expenses, currency, onSave, onDelete }: DebtsScreenProps): React.JSX.Element {
  const [form, setForm] = useState({
    id: undefined as string | undefined,
    name: '',
    totalAmount: '',
    installmentAmount: '',
    startDate: new Date().toISOString().slice(0, 10)
  })

  const totalRemaining = useMemo(() => {
    const paidMap = new Map<string, number>()
    expenses.forEach((expense) => {
      if (!expense.debtId) {
        return
      }
      paidMap.set(expense.debtId, (paidMap.get(expense.debtId) ?? 0) + expense.amount)
    })
    return records.reduce((sum, debt) => sum + Math.max(debt.totalAmount - (paidMap.get(debt.id) ?? 0), 0), 0)
  }, [expenses, records])

  function resetForm(): void {
    setForm({
      id: undefined,
      name: '',
      totalAmount: '',
      installmentAmount: '',
      startDate: new Date().toISOString().slice(0, 10)
    })
  }

  function handleSubmit(): void {
    onSave({
      id: form.id,
      name: form.name,
      totalAmount: parseDecimalInput(form.totalAmount),
      installmentAmount: parseDecimalInput(form.installmentAmount),
      startDate: form.startDate,
      endDate: null,
      desiredPayoffDate: null,
      paymentFrequency: 'monthly',
      recurringAutomatically: true,
      notes: ''
    })
    resetForm()
  }

  return (
    <FormScreen>
      <View style={styles.formCard}>
        <Text style={styles.heading}>{form.id ? 'Edit debt' : 'Add debt'}</Text>
        <LabeledInput label="Debt name" value={form.name} onChangeText={(value) => setForm((current) => ({ ...current, name: value }))} placeholder="Car loan" />
        <LabeledInput label="Total debt amount" value={form.totalAmount} onChangeText={(value) => setForm((current) => ({ ...current, totalAmount: value }))} placeholder="5000" keyboardType="money" />
        <LabeledInput label="Installment amount" value={form.installmentAmount} onChangeText={(value) => setForm((current) => ({ ...current, installmentAmount: value }))} placeholder="250" keyboardType="money" />
        <LabeledInput label="Start date" value={form.startDate} onChangeText={(value) => setForm((current) => ({ ...current, startDate: value }))} placeholder="YYYY-MM-DD" />
        <View style={styles.formActions}>
          <Button label={form.id ? 'Update' : 'Save'} onPress={handleSubmit} style={styles.grow} />
          <Button label="Clear" onPress={resetForm} variant="secondary" style={styles.grow} />
        </View>
      </View>

      <View style={styles.summary}>
        <Text style={styles.summaryLabel}>Remaining debt balance</Text>
        <Text style={styles.summaryValue}>{formatMoney(totalRemaining, currency)}</Text>
      </View>

      {records.length === 0 ? (
        <StateView kind="empty" title="No debts yet" description="Add a debt or installment plan to keep monthly obligations and payoff progress visible." />
      ) : null}

      {records.map((record) => {
        const paid = expenses.filter((expense) => expense.debtId === record.id).reduce((sum, expense) => sum + expense.amount, 0)
        const remaining = Math.max(record.totalAmount - paid, 0)
        return (
          <RecordCard
            key={record.id}
            title={record.name}
            subtitle={`Installment ${formatMoney(record.installmentAmount, currency)} - Remaining ${formatMoney(remaining, currency)}`}
            value={formatMoney(record.totalAmount, currency)}
            onEdit={() =>
              setForm({
                id: record.id,
                name: record.name,
                totalAmount: formatMoneyDecimal(record.totalAmount),
                installmentAmount: formatMoneyDecimal(record.installmentAmount),
                startDate: record.startDate
              })
            }
            onDelete={() => onDelete(record.id)}
          />
        )
      })}
    </FormScreen>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 14
  },
  formCard: {
    borderRadius: 20,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 16,
    gap: 12
  },
  heading: {
    color: palette.textPrimary,
    fontSize: 18,
    fontWeight: '700'
  },
  grow: {
    flex: 1
  },
  formActions: {
    flexDirection: 'row',
    gap: 10
  },
  actionButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center'
  },
  primaryAction: {
    backgroundColor: palette.brand
  },
  secondaryAction: {
    backgroundColor: palette.surfaceRaised
  },
  actionText: {
    color: palette.textPrimary,
    fontWeight: '700'
  },
  summary: {
    borderRadius: 18,
    backgroundColor: statusPalette.negative.bg,
    padding: 16,
    gap: 6
  },
  summaryLabel: {
    color: palette.negative,
    fontSize: 13
  },
  summaryValue: {
    color: palette.textOnBrand,
    fontSize: 24,
    fontWeight: '700'
  }
})
