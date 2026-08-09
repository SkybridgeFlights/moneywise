import React, { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { LabeledInput } from '../components/LabeledInput'
import { NoticeCard } from '../components/NoticeCard'
import { RecordCard } from '../components/RecordCard'
import type { Goal } from '../models/types'
import { parseDecimalInput } from '../services/repository'

interface GoalsScreenProps {
  records: Goal[]
  currency: string
  onSave: (input: Partial<Goal>) => void
  onDelete: (id: string) => void
  onOpenDebts: () => void
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
}

export function GoalsScreen({ records, currency, onSave, onDelete, onOpenDebts }: GoalsScreenProps): React.JSX.Element {
  const [form, setForm] = useState({
    id: undefined as string | undefined,
    name: '',
    targetAmount: '',
    currentAmount: '',
    targetDate: new Date().toISOString().slice(0, 10)
  })
  const remaining = useMemo(() => records.reduce((sum, goal) => sum + Math.max(goal.targetAmount - goal.currentAmount, 0), 0), [records])

  function resetForm(): void {
    setForm({
      id: undefined,
      name: '',
      targetAmount: '',
      currentAmount: '',
      targetDate: new Date().toISOString().slice(0, 10)
    })
  }

  function handleSubmit(): void {
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
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.formCard}>
        <Text style={styles.heading}>{form.id ? 'Edit goal' : 'Add goal'}</Text>
        <LabeledInput label="Goal name" value={form.name} onChangeText={(value) => setForm((current) => ({ ...current, name: value }))} placeholder="Emergency fund" />
        <LabeledInput label="Target amount" value={form.targetAmount} onChangeText={(value) => setForm((current) => ({ ...current, targetAmount: value }))} placeholder="5000" keyboardType="numeric" />
        <LabeledInput label="Current saved" value={form.currentAmount} onChangeText={(value) => setForm((current) => ({ ...current, currentAmount: value }))} placeholder="1200" keyboardType="numeric" />
        <LabeledInput label="Target date" value={form.targetDate} onChangeText={(value) => setForm((current) => ({ ...current, targetDate: value }))} placeholder="YYYY-MM-DD" />
        <View style={styles.formActions}>
          <Pressable onPress={handleSubmit} style={[styles.actionButton, styles.primaryAction]}>
            <Text style={styles.actionText}>{form.id ? 'Update' : 'Save'}</Text>
          </Pressable>
          <Pressable onPress={resetForm} style={[styles.actionButton, styles.secondaryAction]}>
            <Text style={styles.actionText}>Clear</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.summary}>
        <Text style={styles.summaryLabel}>Remaining target amount</Text>
        <Text style={styles.summaryValue}>{formatMoney(remaining, currency)}</Text>
        <Pressable onPress={onOpenDebts} style={styles.linkButton}>
          <Text style={styles.linkButtonText}>Open debts</Text>
        </Pressable>
      </View>

      {records.length === 0 ? <NoticeCard title="No goals yet" description="Add a goal to track how much is left and how much should be saved over time." /> : null}

      {records.map((record) => {
        const remainingAmount = Math.max(record.targetAmount - record.currentAmount, 0)
        return (
          <RecordCard
            key={record.id}
            title={record.name}
            subtitle={`Target ${record.targetDate} - Remaining ${formatMoney(remainingAmount, currency)}`}
            value={formatMoney(record.currentAmount, currency)}
            onEdit={() =>
              setForm({
                id: record.id,
                name: record.name,
                targetAmount: String(record.targetAmount),
                currentAmount: String(record.currentAmount),
                targetDate: record.targetDate
              })
            }
            onDelete={() => onDelete(record.id)}
          />
        )
      })}
    </ScrollView>
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
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 16,
    gap: 12
  },
  heading: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700'
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
    backgroundColor: '#1d4ed8'
  },
  secondaryAction: {
    backgroundColor: '#334155'
  },
  actionText: {
    color: '#f8fafc',
    fontWeight: '700'
  },
  summary: {
    borderRadius: 18,
    backgroundColor: '#052e16',
    padding: 16,
    gap: 6
  },
  summaryLabel: {
    color: '#86efac',
    fontSize: 13
  },
  summaryValue: {
    color: '#f0fdf4',
    fontSize: 24,
    fontWeight: '700'
  },
  linkButton: {
    alignSelf: 'flex-start',
    marginTop: 4,
    borderRadius: 999,
    backgroundColor: '#14532d',
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  linkButtonText: {
    color: '#dcfce7',
    fontSize: 12,
    fontWeight: '700'
  }
})
