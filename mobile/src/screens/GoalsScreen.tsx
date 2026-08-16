import React, { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { FormScreen } from '../components/FormScreen'
import { LabeledInput } from '../components/LabeledInput'
import { Button, Card, ProgressBar, SectionHeader, StateView } from '../components/ui'
import { confirmRecordDeletion } from '../services/destructiveActions'
import type { Goal } from '../models/types'
import { parseDecimalInput } from '../services/repository'
import { formatMoneyDecimal } from '../models/money'
import { createMoneyFormatter } from '../theme/format'
import { palette, radius, sizing, spacing, statusPalette, typography } from '../theme/tokens'

interface GoalsScreenProps {
  records: Goal[]
  currency: string
  locale: string
  onSave: (input: Partial<Goal>) => void
  onDelete: (id: string) => void
  onOpenDebts: () => void
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function emptyForm() {
  return {
    id: undefined as string | undefined,
    name: '',
    targetAmount: '',
    currentAmount: '',
    targetDate: new Date().toISOString().slice(0, 10)
  }
}

export function GoalsScreen({ records, currency, locale, onSave, onDelete, onOpenDebts }: GoalsScreenProps): React.JSX.Element {
  const [form, setForm] = useState(emptyForm)
  const [touched, setTouched] = useState(false)
  const formatMoney = useMemo(() => createMoneyFormatter(currency, locale), [currency, locale])
  const remaining = useMemo(() => records.reduce((sum, goal) => sum + Math.max(goal.targetAmount - goal.currentAmount, 0), 0), [records])

  const nameError = touched && !form.name.trim() ? 'Give this goal a name.' : null
  const targetError = touched && !Number.isFinite(parseDecimalInput(form.targetAmount, Number.NaN)) ? 'Enter a target such as 5000.' : null
  const dateError = touched && !DATE_PATTERN.test(form.targetDate) ? 'Use the format YYYY-MM-DD.' : null
  const canSubmit =
    Boolean(form.name.trim()) && Number.isFinite(parseDecimalInput(form.targetAmount, Number.NaN)) && DATE_PATTERN.test(form.targetDate)

  function resetForm(): void {
    setForm(emptyForm())
    setTouched(false)
  }

  function handleSubmit(): void {
    setTouched(true)
    if (!canSubmit) return
    onSave({
      id: form.id,
      name: form.name,
      type: 'general',
      targetAmount: parseDecimalInput(form.targetAmount),
      currentAmount: parseDecimalInput(form.currentAmount),
      targetDate: form.targetDate,
      priority: 'medium',
      notes: ''
    })
    resetForm()
  }

  return (
    <FormScreen>
      <Card style={styles.summary}>
        <Text style={styles.summaryLabel}>Remaining to save</Text>
        <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          {formatMoney(remaining)}
        </Text>
        <Button label="Open debts" onPress={onOpenDebts} variant="secondary" />
      </Card>

      <Card>
        <SectionHeader title={form.id ? 'Edit goal' : 'Add goal'} subtitle="Track what you are saving towards." />
        <LabeledInput
          label="Goal name"
          value={form.name}
          onChangeText={(value) => setForm((current) => ({ ...current, name: value }))}
          placeholder="Emergency fund"
          error={nameError}
        />
        <LabeledInput
          label="Target amount"
          value={form.targetAmount}
          onChangeText={(value) => setForm((current) => ({ ...current, targetAmount: value }))}
          placeholder="5000"
          keyboardType="money"
          error={targetError}
        />
        <LabeledInput
          label="Current saved"
          value={form.currentAmount}
          onChangeText={(value) => setForm((current) => ({ ...current, currentAmount: value }))}
          placeholder="1200"
          keyboardType="money"
          hint="Leave blank if you have not started yet."
        />
        <LabeledInput
          label="Target date"
          value={form.targetDate}
          onChangeText={(value) => setForm((current) => ({ ...current, targetDate: value }))}
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
          title="No goals yet"
          description="Add a goal to see how much is left and how much to set aside each month."
        />
      ) : (
        records.map((goal) => {
          const remainingAmount = Math.max(goal.targetAmount - goal.currentAmount, 0)
          const ratio = goal.targetAmount > 0 ? goal.currentAmount / goal.targetAmount : 0
          const complete = remainingAmount === 0 && goal.targetAmount > 0
          return (
            <Card key={goal.id}>
              <View style={styles.goalHeader}>
                <View style={styles.goalCopy}>
                  <Text style={styles.goalTitle} numberOfLines={1}>
                    {goal.name}
                  </Text>
                  <Text style={styles.goalMeta}>Target {goal.targetDate}</Text>
                </View>
                <Text style={styles.goalValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                  {formatMoney(goal.currentAmount)}
                </Text>
              </View>

              <ProgressBar
                ratio={ratio}
                tone={complete ? 'positive' : 'brand'}
                label={`${goal.name} ${Math.round(ratio * 100)} percent funded`}
              />
              <View style={styles.goalFooter}>
                <Text style={styles.goalFooterText}>
                  {complete ? 'Fully funded' : `${formatMoney(remainingAmount)} to go`}
                </Text>
                <Text style={styles.goalFooterText}>
                  {Math.round(ratio * 100)}% of {formatMoney(goal.targetAmount)}
                </Text>
              </View>

              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${goal.name}`}
                  onPress={() => {
                    setTouched(false)
                    setForm({
                      id: goal.id,
                      name: goal.name,
                      targetAmount: formatMoneyDecimal(goal.targetAmount),
                      currentAmount: formatMoneyDecimal(goal.currentAmount),
                      targetDate: goal.targetDate
                    })
                  }}
                  style={({ pressed }) => [styles.rowAction, styles.editAction, pressed ? styles.pressed : null]}
                >
                  <Text style={styles.editLabel}>Edit</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${goal.name}`}
                  accessibilityHint="Opens a confirmation dialog"
                  onPress={() => confirmRecordDeletion(goal.name, () => onDelete(goal.id))}
                  style={({ pressed }) => [styles.rowAction, styles.deleteAction, pressed ? styles.pressed : null]}
                >
                  <Text style={styles.deleteLabel}>Delete</Text>
                </Pressable>
              </View>
            </Card>
          )
        })
      )}
    </FormScreen>
  )
}

const styles = StyleSheet.create({
  summary: {
    gap: spacing.sm,
    backgroundColor: statusPalette.brand.bg,
    borderColor: statusPalette.brand.border
  },
  summaryLabel: {
    ...typography.caption,
    color: palette.textSecondary
  },
  summaryValue: {
    ...typography.display,
    color: palette.textPrimary
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm
  },
  actionGrow: {
    flex: 1
  },
  goalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md
  },
  goalCopy: {
    flex: 1,
    gap: spacing.xs
  },
  goalTitle: {
    ...typography.bodyStrong,
    color: palette.textPrimary
  },
  goalMeta: {
    ...typography.caption,
    color: palette.textSecondary
  },
  goalValue: {
    ...typography.metric,
    color: palette.textPrimary,
    maxWidth: '45%',
    textAlign: 'right'
  },
  goalFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm
  },
  goalFooterText: {
    ...typography.caption,
    color: palette.textSecondary
  },
  rowAction: {
    flex: 1,
    minHeight: sizing.minTouchTarget,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1
  },
  pressed: {
    opacity: 0.7
  },
  editAction: {
    backgroundColor: palette.surfaceRaised,
    borderColor: palette.border
  },
  editLabel: {
    ...typography.label,
    color: palette.textPrimary
  },
  deleteAction: {
    backgroundColor: 'transparent',
    borderColor: palette.negative
  },
  deleteLabel: {
    ...typography.label,
    color: palette.negative
  }
})
