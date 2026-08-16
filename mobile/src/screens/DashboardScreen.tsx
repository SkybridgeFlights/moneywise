import React, { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { MetricCard } from '../components/MetricCard'
import { Card, FadeIn, ProgressBar, Screen, SectionHeader, StateView, StatusPill } from '../components/ui'
import type { DashboardAnalytics } from '../models/types'
import { createMoneyFormatter } from '../theme/format'
import { palette, radius, spacing, statusPalette, typography, type StatusTone } from '../theme/tokens'

interface DashboardScreenProps {
  analytics: DashboardAnalytics
  currency: string
  locale: string
  /** True when the profile has no income, expenses, goals or debts at all. */
  isEmpty: boolean
  onOpenExpenses: () => void
  onOpenIncome: () => void
  onOpenBudget: () => void
}

const plannerTone: Record<DashboardAnalytics['smartPlanner']['status'], StatusTone> = {
  comfortable: 'positive',
  tight: 'warning',
  risky: 'warning',
  'not-enough': 'negative'
}

const plannerCopy: Record<DashboardAnalytics['smartPlanner']['status'], string> = {
  comfortable: 'On track',
  tight: 'Tight',
  risky: 'Watch spending',
  'not-enough': 'Over budget'
}

export function DashboardScreen({
  analytics,
  currency,
  locale,
  isEmpty,
  onOpenExpenses,
  onOpenIncome,
  onOpenBudget
}: DashboardScreenProps): React.JSX.Element {
  const formatMoney = useMemo(() => createMoneyFormatter(currency, locale), [currency, locale])
  const planner = analytics.smartPlanner

  // Month label from the analytics month id, not a second date calculation.
  const monthLabel = useMemo(() => {
    const [year, month] = analytics.currentMonth.split('-').map(Number)
    if (!year || !month) return analytics.currentMonth
    return new Date(year, month - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  }, [analytics.currentMonth, locale])

  const flowItems = useMemo(
    () => [
      { label: 'Income', value: analytics.totalIncome, tone: 'positive' as StatusTone },
      { label: 'Expenses', value: analytics.totalExpenses, tone: 'negative' as StatusTone },
      { label: 'Debt paid', value: analytics.monthlyDebtPayments, tone: 'warning' as StatusTone },
      { label: 'Goals remaining', value: analytics.remainingGoalAmount, tone: 'brand' as StatusTone }
    ],
    [analytics.monthlyDebtPayments, analytics.remainingGoalAmount, analytics.totalExpenses, analytics.totalIncome]
  )
  const flowMax = useMemo(() => Math.max(...flowItems.map((item) => item.value), 0), [flowItems])
  const spentRatio = analytics.totalIncome > 0 ? analytics.totalExpenses / analytics.totalIncome : 0

  if (isEmpty) {
    return (
      <Screen>
        <FadeIn>
          <StateView
            kind="empty"
            title="Start with this month"
            description="Add your income and expenses and MoneyWise will work out what is safe to spend each day and week."
            actionLabel="Add income"
            onAction={onOpenIncome}
          />
        </FadeIn>
      </Screen>
    )
  }

  return (
    <Screen>
      <FadeIn>
        <Card style={styles.hero}>
          <View style={styles.heroTop}>
            <Text style={styles.heroEyebrow}>{monthLabel.toUpperCase()}</Text>
            <StatusPill tone={plannerTone[planner.status]} label={plannerCopy[planner.status]} />
          </View>

          <Text style={styles.heroLabel}>Usable balance</Text>
          <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            {formatMoney(planner.remainingUsableBalance)}
          </Text>
          <Text style={styles.heroCaption}>
            After fixed bills, debt instalments and planned goal contributions
          </Text>

          <View style={styles.heroSplit}>
            <View style={styles.heroSplitItem}>
              <Text style={styles.heroSplitLabel}>Safe daily</Text>
              <Text style={styles.heroSplitValue}>{formatMoney(planner.safeDailySpending)}</Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroSplitItem}>
              <Text style={styles.heroSplitLabel}>Safe weekly</Text>
              <Text style={styles.heroSplitValue}>{formatMoney(planner.safeWeeklySpending)}</Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroSplitItem}>
              <Text style={styles.heroSplitLabel}>Days left</Text>
              <Text style={styles.heroSplitValue}>{analytics.remainingDaysInMonth}</Text>
            </View>
          </View>
        </Card>
      </FadeIn>

      <View style={styles.metricRow}>
        <MetricCard label="Income" value={formatMoney(analytics.totalIncome)} tone="positive" onPress={onOpenIncome} />
        <MetricCard label="Expenses" value={formatMoney(analytics.totalExpenses)} tone="negative" onPress={onOpenExpenses} />
      </View>

      <Card>
        <SectionHeader title="Budget status" subtitle={`${monthLabel} so far`} />
        <ProgressBar
          ratio={spentRatio}
          tone={spentRatio > 1 ? 'negative' : spentRatio > 0.85 ? 'warning' : 'positive'}
          label={`Spent ${Math.round(spentRatio * 100)} percent of income`}
        />
        <View style={styles.legendRow}>
          <Text style={styles.legendLabel}>
            {analytics.totalIncome > 0 ? `${Math.round(spentRatio * 100)}% of income spent` : 'No income recorded yet'}
          </Text>
          <Text style={styles.legendValue}>{formatMoney(analytics.remainingBalance)} left</Text>
        </View>
        <View style={styles.detailList}>
          <DetailRow label="Fixed expenses" value={formatMoney(analytics.fixedMonthlyExpenses)} />
          <DetailRow label="Variable expenses" value={formatMoney(analytics.variableExpensesThisMonth)} />
          <DetailRow label="Still due this month" value={formatMoney(planner.fixedAndRecurringExpensesStillDueThisMonth)} />
        </View>
      </Card>

      <Card>
        <SectionHeader title="Monthly flow" subtitle="What is driving the month right now" />
        {flowMax === 0 ? (
          <Text style={styles.flowEmpty}>Nothing recorded for this month yet.</Text>
        ) : (
          <View style={styles.flowList}>
            {flowItems.map((item) => (
              <View key={item.label} style={styles.flowRow}>
                <View style={styles.flowHeader}>
                  <Text style={styles.flowLabel}>{item.label}</Text>
                  <Text style={styles.flowValue}>{formatMoney(item.value)}</Text>
                </View>
                <ProgressBar ratio={item.value / flowMax} tone={item.tone} label={`${item.label} ${formatMoney(item.value)}`} />
              </View>
            ))}
          </View>
        )}
      </Card>

      <Card>
        <SectionHeader title="Commitments" subtitle="Debts and goals still to fund" />
        <View style={styles.detailList}>
          <DetailRow label="Debt balance" value={formatMoney(analytics.debtBalance)} />
          <DetailRow label="Instalments due" value={formatMoney(planner.debtInstallmentsDueThisMonth)} />
          <DetailRow label="Goals remaining" value={formatMoney(analytics.remainingGoalAmount)} />
          <DetailRow
            label="Planned goal contributions"
            value={planner.goalsIncludedInPlanner ? formatMoney(planner.plannedGoalContributionsThisMonth) : 'Not in forecast'}
          />
        </View>
      </Card>

      <MetricCard
        label="Budget planner"
        value={formatMoney(planner.safeMonthlyFlexibleSpending)}
        hint="Flexible spending left this month"
        tone="brand"
        onPress={onOpenBudget}
      />
    </Screen>
  )
}

function DetailRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  hero: {
    gap: spacing.xs,
    borderColor: statusPalette.brand.border
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs
  },
  heroEyebrow: {
    ...typography.eyebrow,
    color: palette.brandText,
    flexShrink: 1
  },
  heroLabel: {
    ...typography.caption,
    color: palette.textSecondary
  },
  heroValue: {
    ...typography.display,
    color: palette.textPrimary
  },
  heroCaption: {
    ...typography.caption,
    color: palette.textMuted,
    lineHeight: 17
  },
  heroSplit: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border
  },
  heroSplitItem: {
    flex: 1,
    gap: spacing.xs
  },
  heroDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: palette.border,
    marginHorizontal: spacing.md
  },
  heroSplitLabel: {
    ...typography.caption,
    color: palette.textMuted
  },
  heroSplitValue: {
    ...typography.bodyStrong,
    color: palette.textPrimary
  },
  metricRow: {
    flexDirection: 'row',
    gap: spacing.md
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm
  },
  legendLabel: {
    ...typography.caption,
    color: palette.textSecondary,
    flex: 1
  },
  legendValue: {
    ...typography.label,
    color: palette.textPrimary
  },
  detailList: {
    gap: spacing.sm,
    marginTop: spacing.xs
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md
  },
  detailLabel: {
    ...typography.body,
    color: palette.textSecondary,
    flex: 1
  },
  detailValue: {
    ...typography.bodyStrong,
    color: palette.textPrimary
  },
  flowList: {
    gap: spacing.md
  },
  flowRow: {
    gap: spacing.sm
  },
  flowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm
  },
  flowLabel: {
    ...typography.label,
    color: palette.textSecondary
  },
  flowValue: {
    ...typography.label,
    color: palette.textPrimary
  },
  flowEmpty: {
    ...typography.body,
    color: palette.textMuted
  },
  legendSpacer: {
    height: radius.sm
  }
})
