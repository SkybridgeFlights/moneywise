import React, { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { LabeledInput } from '../components/LabeledInput'
import { NoticeCard } from '../components/NoticeCard'
import { RecordCard } from '../components/RecordCard'
import type { Category, DebtRecord, ExpenseRecord } from '../models/types'
import { parseDecimalInput } from '../services/repository'

type ExpenseFilter = 'today' | 'week' | 'month' | 'previousMonth' | 'previousYear' | 'nextMonth' | 'nextYear'

interface ExpensesScreenProps {
  records: ExpenseRecord[]
  categories: Category[]
  debts: DebtRecord[]
  currency: string
  locale: string
  language: 'en' | 'ar'
  onSave: (input: Partial<ExpenseRecord>) => void
  onDelete: (id: string) => void
}

interface DateInterval {
  start: Date
  end: Date
}

function formatMoney(value: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
}

function parseRecordDate(value: string): Date {
  const [year, month, day] = value.split('-').map((part) => Number(part))
  return new Date(year, Math.max((month ?? 1) - 1, 0), day ?? 1)
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function endOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999)
}

function startOfWeek(value: Date): Date {
  const day = value.getDay()
  const result = new Date(value)
  result.setDate(value.getDate() - day)
  return startOfDay(result)
}

function endOfWeek(value: Date): Date {
  const result = new Date(startOfWeek(value))
  result.setDate(result.getDate() + 6)
  return endOfDay(result)
}

function startOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1)
}

function endOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth() + 1, 0, 23, 59, 59, 999)
}

function startOfYear(value: Date): Date {
  return new Date(value.getFullYear(), 0, 1)
}

function endOfYear(value: Date): Date {
  return new Date(value.getFullYear(), 11, 31, 23, 59, 59, 999)
}

function addMonths(value: Date, amount: number): Date {
  return new Date(value.getFullYear(), value.getMonth() + amount, value.getDate())
}

function addYears(value: Date, amount: number): Date {
  return new Date(value.getFullYear() + amount, value.getMonth(), value.getDate())
}

function differenceInCalendarDays(end: Date, start: Date): number {
  const millisecondsPerDay = 24 * 60 * 60 * 1000
  const endTime = startOfDay(end).getTime()
  const startTime = startOfDay(start).getTime()
  return Math.round((endTime - startTime) / millisecondsPerDay)
}

function getExpensePeriodInterval(filter: ExpenseFilter, referenceDate = new Date()): DateInterval {
  const today = startOfDay(referenceDate)
  switch (filter) {
    case 'today':
      return { start: today, end: endOfDay(today) }
    case 'week':
      return { start: startOfWeek(today), end: endOfWeek(today) }
    case 'previousMonth': {
      const previousMonth = addMonths(today, -1)
      return { start: startOfMonth(previousMonth), end: endOfMonth(previousMonth) }
    }
    case 'previousYear': {
      const previousYear = addYears(today, -1)
      return { start: startOfYear(previousYear), end: endOfYear(previousYear) }
    }
    case 'nextMonth': {
      const nextMonth = addMonths(today, 1)
      return { start: startOfMonth(nextMonth), end: endOfMonth(nextMonth) }
    }
    case 'nextYear': {
      const nextYear = addYears(today, 1)
      return { start: startOfYear(nextYear), end: endOfYear(nextYear) }
    }
    case 'month':
    default:
      return { start: startOfMonth(today), end: endOfMonth(today) }
  }
}

function getExpensePeriodDayCount(filter: ExpenseFilter): number {
  if (filter === 'today') return 1
  if (filter === 'week') return 7
  if (filter === 'month') return Math.max(new Date().getDate(), 1)
  const interval = getExpensePeriodInterval(filter)
  return Math.max(differenceInCalendarDays(interval.end, interval.start) + 1, 1)
}

function getCopy(language: 'en' | 'ar') {
  return language === 'ar'
    ? {
        sectionEyebrow: 'الفترة الحالية',
        totalRecords: (count: number) => `${count} عملية`,
        totalSpending: 'إجمالي الإنفاق',
        averagePerDay: 'المتوسط اليومي',
        dateFilters: 'فلاتر التاريخ',
        addExpense: 'إضافة مصروف',
        editExpense: 'تعديل المصروف',
        localFirstSave: 'يتم الحفظ محلياً أولاً مع مزامنة تلقائية في الخلفية.',
        title: 'العنوان',
        amount: 'المبلغ',
        date: 'التاريخ',
        category: 'الفئة',
        linkedDebt: 'ربط بدين (اختياري)',
        none: 'بدون',
        saveExpense: 'حفظ المصروف',
        updateExpense: 'تحديث المصروف',
        clear: 'مسح',
        titleError: 'أدخل عنوان المصروف قبل الحفظ.',
        amountError: 'أدخل مبلغاً صالحاً أكبر من صفر.',
        dateError: 'استخدم تاريخاً صالحاً بصيغة YYYY-MM-DD.',
        emptyFutureTitle: 'لا توجد مصروفات مستقبلية في هذه الفترة',
        emptyFutureDescription: 'ستظهر المصروفات المستقبلية هنا عند التخطيط لها.',
        emptyTitle: 'لا توجد مصروفات في هذه الفترة',
        emptyDescription: (label: string) => `بدّل الفلتر أو أضف مصروفات بتاريخ ضمن ${label}.`,
        filters: {
          today: 'اليوم',
          week: 'هذا الأسبوع',
          month: 'هذا الشهر',
          previousMonth: 'الشهر السابق',
          previousYear: 'السنة السابقة',
          nextMonth: 'الشهر القادم',
          nextYear: 'السنة القادمة'
        }
      }
    : {
        sectionEyebrow: 'Expense period',
        totalRecords: (count: number) => `${count} records`,
        totalSpending: 'Total spending',
        averagePerDay: 'Average per day',
        dateFilters: 'Date filters',
        addExpense: 'Add expense',
        editExpense: 'Edit expense',
        localFirstSave: 'Local-first save with automatic background sync.',
        title: 'Title',
        amount: 'Amount',
        date: 'Date',
        category: 'Category',
        linkedDebt: 'Linked debt (optional)',
        none: 'None',
        saveExpense: 'Save expense',
        updateExpense: 'Update expense',
        clear: 'Clear',
        titleError: 'Enter an expense title before saving.',
        amountError: 'Enter a valid amount greater than zero.',
        dateError: 'Use a valid date in YYYY-MM-DD format.',
        emptyFutureTitle: 'No future expenses in this period',
        emptyFutureDescription: 'Future-dated expenses will appear here when you plan them.',
        emptyTitle: 'No expenses in this period',
        emptyDescription: (label: string) => `Switch filters or add expenses dated in ${label.toLowerCase()}.`,
        filters: {
          today: 'Today',
          week: 'This Week',
          month: 'This Month',
          previousMonth: 'Previous Month',
          previousYear: 'Previous Year',
          nextMonth: 'Next Month',
          nextYear: 'Next Year'
        }
      }
}

export function ExpensesScreen({ records, categories, debts, currency, locale, language, onSave, onDelete }: ExpensesScreenProps): React.JSX.Element {
  const copy = useMemo(() => getCopy(language), [language])
  const options: Array<{ label: string; value: ExpenseFilter }> = useMemo(
    () => [
      { label: copy.filters.today, value: 'today' },
      { label: copy.filters.week, value: 'week' },
      { label: copy.filters.month, value: 'month' },
      { label: copy.filters.previousMonth, value: 'previousMonth' },
      { label: copy.filters.previousYear, value: 'previousYear' },
      { label: copy.filters.nextMonth, value: 'nextMonth' },
      { label: copy.filters.nextYear, value: 'nextYear' }
    ],
    [copy]
  )
  const [activeFilter, setActiveFilter] = useState<ExpenseFilter>('month')
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState({
    id: undefined as string | undefined,
    title: '',
    amount: '',
    date: new Date().toISOString().slice(0, 10),
    categoryId: categories[0]?.id ?? 'misc',
    debtId: '',
    type: 'variable' as ExpenseRecord['type']
  })
  const summaryCopy =
    language === 'ar'
      ? {
          fixedSpending: 'المصاريف الثابتة',
          variableSpending: 'المصاريف المتغيرة',
          recurringCount: 'المتكررة',
          expenseType: 'نوع المصروف',
          fixed: 'ثابت',
          variable: 'متغير'
        }
      : {
          fixedSpending: 'Fixed spending',
          variableSpending: 'Variable spending',
          recurringCount: 'Recurring',
          expenseType: 'Expense type',
          fixed: 'Fixed',
          variable: 'Variable'
        }

  const filteredRecords = useMemo(() => {
    const interval = getExpensePeriodInterval(activeFilter)
    return records
      .filter((record) => {
        const recordDate = parseRecordDate(record.date)
        return recordDate >= interval.start && recordDate <= interval.end
      })
      .sort((left, right) => parseRecordDate(right.date).getTime() - parseRecordDate(left.date).getTime())
  }, [activeFilter, records])

  const totals = useMemo(() => {
    const total = filteredRecords.reduce((sum, record) => sum + record.amount, 0)
    const fixed = filteredRecords.filter((record) => record.type === 'fixed').reduce((sum, record) => sum + record.amount, 0)
    const variable = filteredRecords.filter((record) => record.type === 'variable').reduce((sum, record) => sum + record.amount, 0)
    const recurring = filteredRecords.filter((record) => record.recurring).length
    const count = filteredRecords.length
    const averageDaily = activeFilter === 'today' ? total : total / Math.max(getExpensePeriodDayCount(activeFilter), 1)
    return { total, fixed, variable, recurring, count, averageDaily }
  }, [activeFilter, filteredRecords])

  const isFutureFilter = activeFilter === 'nextMonth' || activeFilter === 'nextYear'
  const activeFilterLabel = options.find((option) => option.value === activeFilter)?.label ?? copy.filters.month

  function resetForm(): void {
    setForm({
      id: undefined,
      title: '',
      amount: '',
      date: new Date().toISOString().slice(0, 10),
      categoryId: categories[0]?.id ?? 'misc',
      debtId: '',
      type: 'variable'
    })
    setFormError('')
  }

  function handleSubmit(): void {
    const amount = parseDecimalInput(form.amount)
    if (!form.title.trim()) {
      setFormError(copy.titleError)
      return
    }
    if (amount <= 0) {
      setFormError(copy.amountError)
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) {
      setFormError(copy.dateError)
      return
    }

    setFormError('')
    onSave({
      id: form.id,
      title: form.title.trim(),
      amount,
      date: form.date,
      categoryId: form.categoryId,
      paymentMethod: 'card',
      type: form.type,
      recurring: false,
      notes: '',
      tags: [],
      goalId: null,
      debtId: form.debtId || null,
      allocationKind: 'spend'
    })
    resetForm()
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.summaryCard}>
        <View style={styles.summaryHeader}>
          <View>
            <Text style={styles.summaryEyebrow}>{copy.sectionEyebrow}</Text>
            <Text style={styles.summaryTitle}>{activeFilterLabel}</Text>
          </View>
          <View style={styles.summaryBadge}>
            <Text style={styles.summaryBadgeText}>{copy.totalRecords(totals.count)}</Text>
          </View>
        </View>
        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>{copy.totalSpending}</Text>
            <Text style={styles.metricValue}>{formatMoney(totals.total, currency, locale)}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>{summaryCopy.fixedSpending}</Text>
            <Text style={styles.metricValue}>{formatMoney(totals.fixed, currency, locale)}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>{summaryCopy.variableSpending}</Text>
            <Text style={styles.metricValue}>{formatMoney(totals.variable, currency, locale)}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>{copy.averagePerDay}</Text>
            <Text style={styles.metricValue}>{formatMoney(totals.averageDaily, currency, locale)}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>{summaryCopy.recurringCount}</Text>
            <Text style={styles.metricValue}>{String(totals.recurring)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.filterCard}>
        <Text style={styles.sectionTitle}>{copy.dateFilters}</Text>
        <View style={styles.filterChips}>
          {options.map((option) => (
            <Pressable
              key={option.value}
              onPress={() => setActiveFilter(option.value)}
              style={[styles.filterChip, activeFilter === option.value ? styles.filterChipActive : null]}
            >
              <Text style={[styles.filterChipText, activeFilter === option.value ? styles.filterChipTextActive : null]}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>{form.id ? copy.editExpense : copy.addExpense}</Text>
        <Text style={styles.sectionSubtitle}>{copy.localFirstSave}</Text>
        {formError ? <NoticeCard title={copy.addExpense} description={formError} tone="error" /> : null}
        <LabeledInput label={copy.title} value={form.title} onChangeText={(value) => setForm((current) => ({ ...current, title: value }))} placeholder={language === 'ar' ? 'بقالة' : 'Groceries'} />
        <LabeledInput label={copy.amount} value={form.amount} onChangeText={(value) => setForm((current) => ({ ...current, amount: value }))} placeholder="42.75" keyboardType="numeric" />
        <LabeledInput label={copy.date} value={form.date} onChangeText={(value) => setForm((current) => ({ ...current, date: value }))} placeholder="YYYY-MM-DD" />
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{copy.category}</Text>
          <View style={styles.chips}>
            {categories.map((category) => (
              <Pressable
                key={category.id}
                onPress={() => setForm((current) => ({ ...current, categoryId: category.id }))}
                style={[styles.chip, form.categoryId === category.id ? styles.chipActive : null]}
              >
                <Text style={[styles.chipText, form.categoryId === category.id ? styles.chipTextActive : null]}>{category.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{summaryCopy.expenseType}</Text>
          <View style={styles.chips}>
            {(['variable', 'fixed'] as const).map((type) => (
              <Pressable
                key={type}
                onPress={() => setForm((current) => ({ ...current, type }))}
                style={[styles.chip, form.type === type ? styles.chipActive : null]}
              >
                <Text style={[styles.chipText, form.type === type ? styles.chipTextActive : null]}>{type === 'fixed' ? summaryCopy.fixed : summaryCopy.variable}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{copy.linkedDebt}</Text>
          <View style={styles.chips}>
            <Pressable onPress={() => setForm((current) => ({ ...current, debtId: '' }))} style={[styles.chip, !form.debtId ? styles.chipActive : null]}>
              <Text style={[styles.chipText, !form.debtId ? styles.chipTextActive : null]}>{copy.none}</Text>
            </Pressable>
            {debts.map((debt) => (
              <Pressable
                key={debt.id}
                onPress={() => setForm((current) => ({ ...current, debtId: debt.id, categoryId: 'debt' }))}
                style={[styles.chip, form.debtId === debt.id ? styles.chipActive : null]}
              >
                <Text style={[styles.chipText, form.debtId === debt.id ? styles.chipTextActive : null]}>{debt.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.formActions}>
          <Pressable onPress={handleSubmit} style={[styles.actionButton, styles.primaryAction]}>
            <Text style={styles.actionText}>{form.id ? copy.updateExpense : copy.saveExpense}</Text>
          </Pressable>
          <Pressable onPress={resetForm} style={[styles.actionButton, styles.secondaryAction]}>
            <Text style={styles.actionText}>{copy.clear}</Text>
          </Pressable>
        </View>
      </View>

      {filteredRecords.length === 0 ? (
        <NoticeCard
          title={isFutureFilter ? copy.emptyFutureTitle : copy.emptyTitle}
          description={isFutureFilter ? copy.emptyFutureDescription : copy.emptyDescription(activeFilterLabel)}
        />
      ) : null}

      {filteredRecords.map((record) => (
        <RecordCard
          key={record.id}
          title={record.title}
          subtitle={`${record.date} - ${categories.find((entry) => entry.id === record.categoryId)?.name ?? record.categoryId}`}
          value={formatMoney(record.amount, currency, locale)}
          onEdit={() =>
            setForm({
              id: record.id,
              title: record.title,
              amount: String(record.amount),
              date: record.date,
              categoryId: record.categoryId,
              debtId: record.debtId ?? '',
              type: record.type
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
    paddingBottom: 28,
    gap: 16
  },
  summaryCard: {
    borderRadius: 22,
    backgroundColor: '#0c1527',
    borderWidth: 1,
    borderColor: '#1d2b42',
    padding: 18,
    gap: 14
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12
  },
  summaryEyebrow: {
    color: '#7dd3fc',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  summaryTitle: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '800',
    marginTop: 4
  },
  summaryBadge: {
    borderRadius: 999,
    backgroundColor: '#13233b',
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  summaryBadgeText: {
    color: '#dbeafe',
    fontSize: 12,
    fontWeight: '700'
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12
  },
  metricCard: {
    minWidth: '45%',
    flex: 1,
    borderRadius: 18,
    backgroundColor: '#09111f',
    borderWidth: 1,
    borderColor: '#1c2940',
    padding: 14,
    gap: 6
  },
  metricLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600'
  },
  metricValue: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '800'
  },
  filterCard: {
    borderRadius: 20,
    backgroundColor: '#0c1527',
    borderWidth: 1,
    borderColor: '#1d2b42',
    padding: 16,
    gap: 12
  },
  formCard: {
    borderRadius: 20,
    backgroundColor: '#0c1527',
    borderWidth: 1,
    borderColor: '#1d2b42',
    padding: 16,
    gap: 12
  },
  sectionTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700'
  },
  sectionSubtitle: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 18
  },
  filterChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  filterChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#111827'
  },
  filterChipActive: {
    backgroundColor: '#0f766e'
  },
  filterChipText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '700'
  },
  filterChipTextActive: {
    color: '#ecfeff'
  },
  section: {
    gap: 8
  },
  sectionLabel: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600'
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#111827'
  },
  chipActive: {
    backgroundColor: '#1d4ed8'
  },
  chipText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '600'
  },
  chipTextActive: {
    color: '#eff6ff'
  },
  formActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4
  },
  actionButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center'
  },
  primaryAction: {
    backgroundColor: '#0f766e'
  },
  secondaryAction: {
    backgroundColor: '#334155'
  },
  actionText: {
    color: '#f8fafc',
    fontWeight: '700'
  }
})
