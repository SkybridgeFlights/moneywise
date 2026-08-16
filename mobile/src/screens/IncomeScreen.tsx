import React, { useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { FormScreen } from '../components/FormScreen'
import { LabeledInput } from '../components/LabeledInput'
import { RecordCard } from '../components/RecordCard'
import { Button, Card, SectionHeader, StateView } from '../components/ui'
import type { IncomeRecord } from '../models/types'
import { parseDecimalInput } from '../services/repository'
import { formatMoneyDecimal } from '../models/money'
import { createMoneyFormatter } from '../theme/format'
import { palette, spacing, statusPalette, typography } from '../theme/tokens'

interface IncomeScreenProps {
  records: IncomeRecord[]
  currency: string
  locale: string
  onSave: (input: Partial<IncomeRecord>) => void
  onDelete: (id: string) => void
}

const initialForm = {
  id: undefined as string | undefined,
  name: '',
  groupName: 'Primary',
  amount: '',
  date: new Date().toISOString().slice(0, 10)
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function IncomeScreen({ records, currency, locale, onSave, onDelete }: IncomeScreenProps): React.JSX.Element {
  const [form, setForm] = useState(initialForm)
  const [touched, setTouched] = useState(false)
  const formatMoney = useMemo(() => createMoneyFormatter(currency, locale), [currency, locale])
  const total = useMemo(() => records.reduce((sum, record) => sum + record.amount, 0), [records])

  // Validation is presentational only; parsing stays in parseDecimalInput.
  const nameError = touched && !form.name.trim() ? 'Enter a name for this income.' : null
  const amountError = touched && !Number.isFinite(parseDecimalInput(form.amount, Number.NaN)) ? 'Enter an amount such as 1200.50.' : null
  const dateError = touched && !DATE_PATTERN.test(form.date) ? 'Use the format YYYY-MM-DD.' : null
  const canSubmit = Boolean(form.name.trim()) && Number.isFinite(parseDecimalInput(form.amount, Number.NaN)) && DATE_PATTERN.test(form.date)

  function resetForm(): void {
    setForm(initialForm)
    setTouched(false)
  }

  function handleSubmit(): void {
    setTouched(true)
    if (!canSubmit) return
    onSave({
      id: form.id,
      name: form.name,
      groupName: form.groupName,
      amount: parseDecimalInput(form.amount),
      date: form.date,
      type: 'fixed',
      recurring: false,
      notes: ''
    })
    resetForm()
  }

  return (
    <FormScreen>
      <Card style={styles.summary}>
        <Text style={styles.summaryLabel}>Total income</Text>
        <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          {formatMoney(total)}
        </Text>
        <Text style={styles.summaryHint}>
          {records.length} {records.length === 1 ? 'source' : 'sources'} recorded
        </Text>
      </Card>

      <Card>
        <SectionHeader title={form.id ? 'Edit income' : 'Add income'} subtitle="Amounts are stored to the exact cent." />
        <LabeledInput
          label="Name"
          value={form.name}
          onChangeText={(value) => setForm((current) => ({ ...current, name: value }))}
          placeholder="Salary"
          error={nameError}
        />
        <LabeledInput
          label="Group"
          value={form.groupName}
          onChangeText={(value) => setForm((current) => ({ ...current, groupName: value }))}
          placeholder="Primary"
          hint="Used to group related income together."
        />
        <LabeledInput
          label="Amount"
          value={form.amount}
          onChangeText={(value) => setForm((current) => ({ ...current, amount: value }))}
          placeholder="1200.50"
          keyboardType="money"
          error={amountError}
        />
        <LabeledInput
          label="Date"
          value={form.date}
          onChangeText={(value) => setForm((current) => ({ ...current, date: value }))}
          placeholder="YYYY-MM-DD"
          error={dateError}
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
        />
        <View style={styles.actions}>
          <Button label={form.id ? 'Update' : 'Save'} onPress={handleSubmit} style={styles.actionGrow} />
          <Button label="Clear" onPress={resetForm} variant="secondary" style={styles.actionGrow} />
        </View>
      </Card>

      {records.length === 0 ? (
        <StateView
          kind="empty"
          title="No income yet"
          description="Add your first income source so MoneyWise can work out what is available this month."
        />
      ) : (
        records.map((record) => (
          <RecordCard
            key={record.id}
            title={record.name}
            subtitle={`${record.groupName} · ${record.date}`}
            value={formatMoney(record.amount)}
            onEdit={() => {
              setTouched(false)
              setForm({
                id: record.id,
                name: record.name,
                groupName: record.groupName,
                amount: formatMoneyDecimal(record.amount),
                date: record.date
              })
            }}
            onDelete={() => onDelete(record.id)}
          />
        ))
      )}
    </FormScreen>
  )
}

const styles = StyleSheet.create({
  summary: {
    gap: spacing.xs,
    backgroundColor: statusPalette.positive.bg,
    borderColor: statusPalette.positive.border
  },
  summaryLabel: {
    ...typography.caption,
    color: palette.textSecondary
  },
  summaryValue: {
    ...typography.display,
    color: palette.textPrimary
  },
  summaryHint: {
    ...typography.caption,
    color: palette.textMuted
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm
  },
  actionGrow: {
    flex: 1
  }
})
