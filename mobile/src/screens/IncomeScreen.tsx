import React, { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { LabeledInput } from '../components/LabeledInput'
import { NoticeCard } from '../components/NoticeCard'
import { RecordCard } from '../components/RecordCard'
import type { IncomeRecord } from '../models/types'
import { parseDecimalInput } from '../services/repository'

interface IncomeScreenProps {
  records: IncomeRecord[]
  currency: string
  onSave: (input: Partial<IncomeRecord>) => void
  onDelete: (id: string) => void
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
}

const initialForm = {
  id: undefined as string | undefined,
  name: '',
  groupName: 'Primary',
  amount: '',
  date: new Date().toISOString().slice(0, 10)
}

export function IncomeScreen({ records, currency, onSave, onDelete }: IncomeScreenProps): React.JSX.Element {
  const [form, setForm] = useState(initialForm)
  const total = useMemo(() => records.reduce((sum, record) => sum + record.amount, 0), [records])

  function resetForm(): void {
    setForm(initialForm)
  }

  function handleSubmit(): void {
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
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.formCard}>
        <Text style={styles.heading}>{form.id ? 'Edit income' : 'Add income'}</Text>
        <LabeledInput label="Name" value={form.name} onChangeText={(value) => setForm((current) => ({ ...current, name: value }))} placeholder="Salary" />
        <LabeledInput label="Group" value={form.groupName} onChangeText={(value) => setForm((current) => ({ ...current, groupName: value }))} placeholder="Primary" />
        <LabeledInput label="Amount" value={form.amount} onChangeText={(value) => setForm((current) => ({ ...current, amount: value }))} placeholder="1200.50" keyboardType="numeric" />
        <LabeledInput label="Date" value={form.date} onChangeText={(value) => setForm((current) => ({ ...current, date: value }))} placeholder="YYYY-MM-DD" />
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
        <Text style={styles.summaryLabel}>Total income</Text>
        <Text style={styles.summaryValue}>{formatMoney(total, currency)}</Text>
      </View>

      {records.length === 0 ? <NoticeCard title="No income yet" description="Add your first income source to start tracking what is available this month." /> : null}

      {records.map((record) => (
        <RecordCard
          key={record.id}
          title={record.name}
          subtitle={`${record.groupName} - ${record.date}`}
          value={formatMoney(record.amount, currency)}
          onEdit={() =>
            setForm({
              id: record.id,
              name: record.name,
              groupName: record.groupName,
              amount: String(record.amount),
              date: record.date
            })
          }
          onDelete={() => onDelete(record.id)}
        />
      ))}
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
    backgroundColor: '#082f49',
    padding: 16,
    gap: 6
  },
  summaryLabel: {
    color: '#bae6fd',
    fontSize: 13
  },
  summaryValue: {
    color: '#f0f9ff',
    fontSize: 24,
    fontWeight: '700'
  }
})
