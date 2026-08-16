import React, { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { FormScreen } from '../components/FormScreen'
import { LabeledInput } from '../components/LabeledInput'
import { Button, Chip } from '../components/ui'
import { palette } from '../theme/tokens'
import { MetricCard } from '../components/MetricCard'
import { NoticeCard } from '../components/NoticeCard'
import { buildBudgetPlanner, getPlannerPeriodInterval, type PlannerPeriodFilter } from '../models/budgetPlanner'
import type { FinanceState } from '../models/types'
import { moneyDisplayNumber, multiplyMoneyByBasisPoints, parseMoneyDecimal } from '../models/money'

interface BudgetScreenProps {
  state: FinanceState
  onUpdateSettings: (patch: Partial<FinanceState['settings']>) => void
}

function formatMoney(value: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(moneyDisplayNumber(value))
}

function getCopy(language: 'en' | 'ar') {
  return language === 'ar'
    ? {
        title: 'مخطط الصرف الذكي',
        subtitle: 'اعرف الدخل المتاح والالتزامات والمبلغ المسموح صرفه خلال الفترة المحددة.',
        pastSubtitle: 'ملخص تاريخي للفترة المحددة بعد الدخل والالتزامات.',
        selectedPeriod: 'الفترة المحددة',
        thisYear: 'هذه السنة',
        totalIncomeAvailable: 'إجمالي الدخل المتاح',
        plannerStatus: 'حالة الخطة',
        remainingDays: 'الأيام المتبقية',
        incomeAvailableTitle: 'الدخل المتاح للفترة',
        incomeAvailableSubtitle: 'الرصيد الافتتاحي مضافًا إليه الدخل المتوقع داخل الفترة.',
        openingAvailableBalance: 'الرصيد المتاح',
        expectedIncome: 'الدخل المتوقع',
        commitmentsTitle: 'الالتزامات',
        commitmentsSubtitle: 'المصاريف الثابتة والأقساط والمصاريف المتكررة المطلوبة فقط.',
        fixedExpenses: 'المصاريف الثابتة',
        debtInstallments: 'أقساط الديون',
        recurringRequiredExpenses: 'المصاريف المتكررة المطلوبة',
        totalCommitments: 'إجمالي الالتزامات',
        afterCommitmentsTitle: 'بعد الالتزامات',
        afterCommitmentsSubtitle: 'ما يتبقى للإنفاق المرن بعد الالتزامات والإنفاق المتغير المسجل.',
        balanceAfterCommitments: 'الرصيد بعد الالتزامات',
        variableSpentToDate: 'المنصرف المتغير حتى الآن',
        remainingFlexibleBalance: 'الرصيد المرن المتبقي',
        allowedMonthly: 'المسموح شهريًا',
        allowedWeekly: 'المسموح أسبوعيًا',
        allowedDaily: 'المسموح يوميًا',
        goalsTitle: 'الأهداف',
        goalsSubtitle: 'يتم فصل الأهداف عن الالتزامات حتى تبقى القراءة واضحة.',
        plannedGoalContributions: 'مساهمات الأهداف المخططة',
        recommendedGoalContributions: 'مساهمات الأهداف المقترحة',
        goalsIncludedInPlanner: 'إدراج الأهداف في المخطط',
        goalsIncludedCount: 'عدد الأهداف المشمولة',
        goalsExcludedCount: 'عدد الأهداف غير المجدولة',
        goalsExcludedNote: 'ملاحظة الأهداف',
        goalsExcludedNoteValue: 'تم استبعاد بعض الأهداف لأنها بلا موعد صالح أو خارج الفترة المحددة.',
        balanceAfterGoals: 'الرصيد بعد الأهداف',
        afterGoalsTitle: 'بعد الأهداف',
        afterGoalsSubtitle: 'المبلغ المسموح صرفه مع الاستمرار في تحقيق الأهداف.',
        allowedMonthlyAfterGoals: 'المسموح شهريًا بعد الأهداف',
        allowedWeeklyAfterGoals: 'المسموح أسبوعيًا بعد الأهداف',
        allowedDailyAfterGoals: 'المسموح يوميًا بعد الأهداف',
        shortfallAmount: 'المبلغ الناقص',
        formulaTitle: 'صيغة الحساب',
        formulaSubtitle: 'قراءة مبسطة لطريقة احتساب مخطط الصرف.',
        extraSavingsAdviceTitle: 'نصائح زيادة الادخار',
        extraSavingsAdviceSubtitle: 'اقتراحات منفصلة لزيادة الادخار دون تغيير الميزانية تلقائيًا.',
        conservativeSaving: 'توفير محافظ',
        strongSaving: 'توفير قوي',
        dailyImpact: 'التأثير اليومي',
        weeklyImpact: 'التأثير الأسبوعي',
        categoriesToReduce: 'فئات يمكن تقليلها',
        adviceOnly: 'هذه نصائح فقط ولا تغير الميزانية تلقائيًا.',
        statusComfortable: 'الخطة مريحة',
        statusTight: 'الخطة ضيقة',
        statusRisky: 'الخطة خطرة',
        statusNotEnough: 'المبلغ غير كافٍ',
        yes: 'نعم',
        no: 'لا',
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
        title: 'Smart Spending Planner',
        subtitle: 'See income available, commitments, and the amount you can safely spend in the selected period.',
        pastSubtitle: 'Historical summary for the selected period after income and commitments.',
        selectedPeriod: 'Selected period',
        thisYear: 'This Year',
        totalIncomeAvailable: 'Total income available',
        plannerStatus: 'Plan status',
        remainingDays: 'Remaining days',
        incomeAvailableTitle: 'Income available for period',
        incomeAvailableSubtitle: 'Opening balance plus the income expected inside the selected period.',
        openingAvailableBalance: 'Available balance',
        expectedIncome: 'Expected income',
        commitmentsTitle: 'Commitments',
        commitmentsSubtitle: 'Fixed expenses, debt installments, and required recurring expenses only.',
        fixedExpenses: 'Fixed expenses',
        debtInstallments: 'Debt installments',
        recurringRequiredExpenses: 'Recurring required expenses',
        totalCommitments: 'Total commitments',
        afterCommitmentsTitle: 'After commitments',
        afterCommitmentsSubtitle: 'What remains for flexible spending after commitments and recorded variable spending.',
        balanceAfterCommitments: 'Balance after commitments',
        variableSpentToDate: 'Variable spending so far',
        remainingFlexibleBalance: 'Remaining flexible balance',
        allowedMonthly: 'Allowed monthly spending',
        allowedWeekly: 'Allowed weekly spending',
        allowedDaily: 'Allowed daily spending',
        goalsTitle: 'Goals',
        goalsSubtitle: 'Goals stay separate from required commitments for a clearer reading.',
        plannedGoalContributions: 'Planned goal contributions',
        recommendedGoalContributions: 'Recommended goal contributions',
        goalsIncludedInPlanner: 'Goals included in planner',
        goalsIncludedCount: 'Goals included count',
        goalsExcludedCount: 'Goals excluded count',
        goalsExcludedNote: 'Goal note',
        goalsExcludedNoteValue: 'Some goals were excluded because they have no usable schedule in this period.',
        balanceAfterGoals: 'Balance after goals',
        afterGoalsTitle: 'After goals',
        afterGoalsSubtitle: 'What you can still spend while staying on track for goals.',
        allowedMonthlyAfterGoals: 'Allowed monthly spending after goals',
        allowedWeeklyAfterGoals: 'Allowed weekly spending after goals',
        allowedDailyAfterGoals: 'Allowed daily spending after goals',
        shortfallAmount: 'Shortfall',
        formulaTitle: 'Formula',
        formulaSubtitle: 'A simplified reading of how the planner is calculated.',
        extraSavingsAdviceTitle: 'Extra Savings Advice',
        extraSavingsAdviceSubtitle: 'Separate suggestions to save more without changing your budget automatically.',
        conservativeSaving: 'Conservative saving',
        strongSaving: 'Strong saving',
        dailyImpact: 'Daily impact',
        weeklyImpact: 'Weekly impact',
        categoriesToReduce: 'Categories to reduce',
        adviceOnly: 'Advice only; this does not change your budget automatically.',
        statusComfortable: 'Comfortable',
        statusTight: 'Tight',
        statusRisky: 'Risky',
        statusNotEnough: 'Not enough',
        yes: 'Yes',
        no: 'No',
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

function PlannerLine({ label, value, help }: { label: string; value: string; help?: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <View>
      <View style={styles.metricLine}>
        <View style={styles.metricLabelRow}>
          <Text style={styles.metricLabel}>{label}</Text>
          {help ? (
            <Pressable onPress={() => setOpen((current) => !current)} style={styles.helpButton}>
              <Text style={styles.helpButtonText}>?</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.metricValue}>{value}</Text>
      </View>
      {open && help ? <Text style={styles.helpText}>{help}</Text> : null}
    </View>
  )
}

export function BudgetScreen({ state, onUpdateSettings }: BudgetScreenProps): React.JSX.Element {
  const [filter, setFilter] = useState<PlannerPeriodFilter>('month')
  const [balanceInput, setBalanceInput] = useState('')
  const [balanceNote, setBalanceNote] = useState('')
  const copy = useMemo(() => getCopy(state.settings.language), [state.settings.language])
  const planner = useMemo(() => buildBudgetPlanner(state, filter), [filter, state])
  const periodOptions: Array<{ label: string; value: PlannerPeriodFilter }> = useMemo(
    () => [
      { label: copy.filters.today, value: 'today' },
      { label: copy.filters.week, value: 'week' },
      { label: copy.filters.month, value: 'month' },
      { label: copy.thisYear, value: 'year' },
      { label: copy.filters.previousMonth, value: 'previousMonth' },
      { label: copy.filters.previousYear, value: 'previousYear' },
      { label: copy.filters.nextMonth, value: 'nextMonth' },
      { label: copy.filters.nextYear, value: 'nextYear' }
    ],
    [copy]
  )
  const periodLabel = periodOptions.find((option) => option.value === filter)?.label ?? copy.filters.month
  const interval = getPlannerPeriodInterval(filter)
  const periodDays = Math.max(planner.remainingDaysInPeriod || Math.round((interval.end.getTime() - interval.start.getTime()) / (1000 * 60 * 60 * 24)) + 1, 1)
  const periodWeeks = Math.max(planner.remainingWeeksInPeriod || periodDays / 7, 1)
  const extraSavingsBase = Math.max(planner.remainingFlexibleBalance, 0)
  const nonEssentialCategories = useMemo(() => {
    const totals = new Map<string, number>()
    state.expenses.forEach((expense) => {
      const date = new Date(expense.date)
      if (date < interval.start || date > interval.end) return
      const category = state.categories.find((entry) => entry.id === expense.categoryId)
      if (category?.type !== 'lifestyle' && category?.type !== 'custom') return
      totals.set(expense.categoryId, (totals.get(expense.categoryId) ?? 0) + expense.amount)
    })

    return [...totals.entries()]
      .map(([categoryId, amount]) => ({
        categoryId,
        categoryName: state.categories.find((entry) => entry.id === categoryId)?.name ?? categoryId,
        amount,
        reduction: multiplyMoneyByBasisPoints(amount, 1_000)
      }))
      .sort((left, right) => right.amount - left.amount)
      .slice(0, 3)
  }, [interval.end, interval.start, state.categories, state.expenses])
  const statusLabel =
    planner.status === 'comfortable'
      ? copy.statusComfortable
      : planner.status === 'tight'
        ? copy.statusTight
        : planner.status === 'risky'
          ? copy.statusRisky
          : copy.statusNotEnough
  const balanceCopy =
    state.settings.language === 'ar'
      ? {
          editCurrentBalance: 'تعديل الرصيد الحالي',
          newBalance: 'الرصيد الجديد',
          adjustmentReason: 'سبب التعديل',
          save: 'حفظ تعديل الرصيد',
          lastAdjustment: 'آخر تعديل يدوي',
          noAdjustment: 'لا يوجد تعديل يدوي محفوظ'
        }
      : {
          editCurrentBalance: 'Edit current balance',
          newBalance: 'New balance',
          adjustmentReason: 'Adjustment reason',
          save: 'Save balance adjustment',
          lastAdjustment: 'Last manual adjustment',
          noAdjustment: 'No manual adjustment saved'
        }
  const helpCopy =
    state.settings.language === 'ar'
      ? {
          available: `الرصيد المتاح = الرصيد المرحّل من الفترات السابقة + آخر تعديل يدوي إن وجد.\nمصادر البيانات: الدخل السابق، المصاريف السابقة، وتعديل الرصيد اليدوي.\nالفترة: ${periodLabel}.`,
          total: `إجمالي المال المتاح = الرصيد المرحّل + دخل الفترة.\nمصادر البيانات: الدخل، المصاريف السابقة، والدخل المتكرر المتوقع.\nالفترة: ${periodLabel}.`,
          commitments: `الالتزامات = المصاريف الثابتة + أقساط الديون + المصاريف المتكررة المطلوبة.\nلا تشمل الأهداف إلا إذا تم تسجيلها كمصروف فعلي.\nالفترة: ${periodLabel}.`,
          flexible: `الرصيد المرن المتبقي = إجمالي المال المتاح - الالتزامات - الإنفاق المتغير المسجل.\nالفترة: ${periodLabel}.`,
          allowed: `المسموح يوميًا = الرصيد المرن المتبقي ÷ الأيام المتبقية.\nالمسموح أسبوعيًا = الرصيد المرن المتبقي ÷ الأسابيع المتبقية.\nالفترة: ${periodLabel}.`
        }
      : {
          available: `Available balance = carried balance from previous periods + latest manual adjustment if one exists.\nData sources: prior income, prior expenses, and manual balance adjustment.\nPeriod: ${periodLabel}.`,
          total: `Total available money = carried balance + period income.\nData sources: income, prior expenses, and expected recurring income.\nPeriod: ${periodLabel}.`,
          commitments: `Commitments = fixed expenses + debt installments + required recurring expenses.\nGoals are excluded unless recorded as actual expenses.\nPeriod: ${periodLabel}.`,
          flexible: `Flexible remaining = total available money - commitments - recorded variable spending.\nPeriod: ${periodLabel}.`,
          allowed: `Allowed daily = flexible remaining / remaining days.\nAllowed weekly = flexible remaining / remaining weeks.\nPeriod: ${periodLabel}.`
        }
  function saveBalanceCorrection(): void {
    const newBalance = parseMoneyDecimal(balanceInput)
    if (!Number.isFinite(newBalance)) return
    const now = new Date().toISOString()
    onUpdateSettings({
      balanceCorrection: {
        id: `balance-adjustment-${Date.now()}`,
        effectiveDate: now,
        calculatedBalanceBefore: planner.openingAvailableBalance,
        correctedBalance: newBalance,
        difference: newBalance - planner.openingAvailableBalance,
        note: balanceNote.trim(),
        createdAt: now,
        updatedAt: now
      }
    })
    setBalanceInput('')
    setBalanceNote('')
  }

  return (
    <FormScreen>
      <NoticeCard
        title={copy.title}
        description={planner.isPastPeriod ? copy.pastSubtitle : copy.subtitle}
        tone={planner.status === 'not-enough' ? 'error' : planner.status === 'risky' ? 'warning' : 'neutral'}
      />

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{copy.selectedPeriod}</Text>
        <View style={styles.filterChips}>
          {periodOptions.map((option) => (
            <Chip key={option.value} label={option.label} selected={filter === option.value} onPress={() => setFilter(option.value)} />
          ))}
        </View>
        <View style={styles.metricGrid}>
          <MetricCard label={copy.selectedPeriod} value={periodLabel} tone="brand" />
          <MetricCard label={copy.totalIncomeAvailable} value={formatMoney(planner.totalIncomeAvailable, state.settings.currency, state.settings.locale)} tone="positive" />
          <MetricCard label={copy.plannerStatus} value={statusLabel} tone="warning" />
          <MetricCard label={copy.remainingDays} value={String(planner.remainingDaysInPeriod)} tone="neutral" />
        </View>
        <Text style={styles.intervalText}>
          {interval.start.toISOString().slice(0, 10)} → {interval.end.toISOString().slice(0, 10)}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{copy.incomeAvailableTitle}</Text>
        <Text style={styles.cardSubtitle}>{copy.incomeAvailableSubtitle}</Text>
        <PlannerLine label={copy.openingAvailableBalance} value={formatMoney(planner.openingAvailableBalance, state.settings.currency, state.settings.locale)} help={helpCopy.available} />
        <PlannerLine label={copy.expectedIncome} value={formatMoney(planner.expectedIncome, state.settings.currency, state.settings.locale)} />
        <PlannerLine label={copy.totalIncomeAvailable} value={formatMoney(planner.totalIncomeAvailable, state.settings.currency, state.settings.locale)} help={helpCopy.total} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{balanceCopy.editCurrentBalance}</Text>
        <PlannerLine label={copy.openingAvailableBalance} value={formatMoney(planner.openingAvailableBalance, state.settings.currency, state.settings.locale)} help={helpCopy.available} />
        <PlannerLine
          label={balanceCopy.lastAdjustment}
          value={state.settings.balanceCorrection ? `${formatMoney(state.settings.balanceCorrection.difference, state.settings.currency, state.settings.locale)} - ${state.settings.balanceCorrection.updatedAt.slice(0, 10)}` : balanceCopy.noAdjustment}
        />
        <LabeledInput label={balanceCopy.newBalance} value={balanceInput} onChangeText={setBalanceInput} placeholder="0.00" keyboardType="money" />
        <LabeledInput label={balanceCopy.adjustmentReason} value={balanceNote} onChangeText={setBalanceNote} placeholder="—" />
        <Button label={balanceCopy.save} onPress={saveBalanceCorrection} disabled={!balanceInput.trim()} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{copy.commitmentsTitle}</Text>
        <Text style={styles.cardSubtitle}>{copy.commitmentsSubtitle}</Text>
        <PlannerLine label={copy.fixedExpenses} value={formatMoney(planner.fixedExpenses, state.settings.currency, state.settings.locale)} help={helpCopy.commitments} />
        <PlannerLine label={copy.debtInstallments} value={formatMoney(planner.debtInstallments, state.settings.currency, state.settings.locale)} help={helpCopy.commitments} />
        <PlannerLine label={copy.recurringRequiredExpenses} value={formatMoney(planner.recurringRequiredExpenses, state.settings.currency, state.settings.locale)} help={helpCopy.commitments} />
        <PlannerLine label={copy.totalCommitments} value={formatMoney(planner.totalCommitments, state.settings.currency, state.settings.locale)} help={helpCopy.commitments} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{copy.afterCommitmentsTitle}</Text>
        <Text style={styles.cardSubtitle}>{copy.afterCommitmentsSubtitle}</Text>
        <PlannerLine label={copy.balanceAfterCommitments} value={formatMoney(planner.balanceAfterCommitments, state.settings.currency, state.settings.locale)} />
        <PlannerLine label={copy.variableSpentToDate} value={formatMoney(planner.variableSpentToDate, state.settings.currency, state.settings.locale)} />
        <PlannerLine label={copy.remainingFlexibleBalance} value={formatMoney(planner.remainingFlexibleBalance, state.settings.currency, state.settings.locale)} help={helpCopy.flexible} />
        <PlannerLine label={copy.allowedMonthly} value={formatMoney(planner.allowedMonthlySpending, state.settings.currency, state.settings.locale)} help={helpCopy.allowed} />
        <PlannerLine label={copy.allowedWeekly} value={formatMoney(planner.allowedWeeklySpending, state.settings.currency, state.settings.locale)} help={helpCopy.allowed} />
        <PlannerLine label={copy.allowedDaily} value={formatMoney(planner.allowedDailySpending, state.settings.currency, state.settings.locale)} help={helpCopy.allowed} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{copy.formulaTitle}</Text>
        <Text style={styles.cardSubtitle}>{copy.formulaSubtitle}</Text>
        <PlannerLine label={copy.totalIncomeAvailable} value={`${copy.openingAvailableBalance} + ${copy.expectedIncome}`} />
        <PlannerLine label={copy.balanceAfterCommitments} value={`${copy.totalIncomeAvailable} - ${copy.totalCommitments}`} />
        <PlannerLine label={copy.allowedMonthly} value={`${copy.balanceAfterCommitments} - ${copy.variableSpentToDate}`} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{copy.extraSavingsAdviceTitle}</Text>
        <Text style={styles.cardSubtitle}>{copy.extraSavingsAdviceSubtitle}</Text>
        <PlannerLine label={copy.conservativeSaving} value={formatMoney(extraSavingsBase * 0.1, state.settings.currency, state.settings.locale)} />
        <PlannerLine label={copy.dailyImpact} value={formatMoney((extraSavingsBase * 0.1) / periodDays, state.settings.currency, state.settings.locale)} />
        <PlannerLine label={copy.weeklyImpact} value={formatMoney((extraSavingsBase * 0.1) / periodWeeks, state.settings.currency, state.settings.locale)} />
        <PlannerLine label={copy.strongSaving} value={formatMoney(extraSavingsBase * 0.2, state.settings.currency, state.settings.locale)} />
        <PlannerLine label={copy.dailyImpact} value={formatMoney((extraSavingsBase * 0.2) / periodDays, state.settings.currency, state.settings.locale)} />
        <PlannerLine label={copy.weeklyImpact} value={formatMoney((extraSavingsBase * 0.2) / periodWeeks, state.settings.currency, state.settings.locale)} />
        {nonEssentialCategories.map((item) => (
          <PlannerLine
            key={item.categoryId}
            label={`${copy.categoriesToReduce}: ${item.categoryName}`}
            value={`${formatMoney(item.amount, state.settings.currency, state.settings.locale)} / ${formatMoney(item.reduction, state.settings.currency, state.settings.locale)}`}
          />
        ))}
        <Text style={styles.cardSubtitle}>{copy.adviceOnly}</Text>
      </View>
    </FormScreen>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 14
  },
  card: {
    borderRadius: 20,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 16,
    gap: 12
  },
  cardTitle: {
    color: palette.textPrimary,
    fontSize: 18,
    fontWeight: '700'
  },
  cardSubtitle: {
    color: palette.textSecondary,
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
    backgroundColor: palette.surfaceSunken
  },
  filterChipActive: {
    backgroundColor: palette.positive
  },
  filterChipText: {
    color: palette.textSecondary,
    fontSize: 12,
    fontWeight: '700'
  },
  filterChipTextActive: {
    color: palette.textPrimary
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12
  },
  intervalText: {
    color: palette.textMuted,
    fontSize: 12
  },
  metricLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12
  },
  metricLabelRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  metricLabel: {
    color: palette.textSecondary,
    fontSize: 13,
    flex: 1
  },
  metricValue: {
    color: palette.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
    textAlign: 'right'
  },
  helpButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.border
  },
  helpButtonText: {
    color: palette.brandText,
    fontSize: 12,
    fontWeight: '800'
  },
  helpText: {
    color: palette.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceSunken,
    color: palette.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: 11
  },
  actionButton: {
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: palette.positive
  },
  actionButtonDisabled: {
    opacity: 0.45
  },
  actionButtonText: {
    color: palette.textPrimary,
    fontWeight: '800'
  }
})
