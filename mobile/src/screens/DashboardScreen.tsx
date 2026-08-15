import React from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { MetricCard } from '../components/MetricCard'
import type { DashboardAnalytics } from '../models/types'
import { moneyDisplayNumber } from '../models/money'

interface DashboardScreenProps {
  analytics: DashboardAnalytics
  currency: string
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2
  }).format(moneyDisplayNumber(value))
}

export function DashboardScreen({ analytics, currency }: DashboardScreenProps): React.JSX.Element {
  const chartItems = [
    { label: 'Income', value: analytics.totalIncome, color: '#22c55e' },
    { label: 'Expenses', value: analytics.totalExpenses, color: '#ef4444' },
    { label: 'Debt', value: analytics.monthlyDebtPayments, color: '#f97316' },
    { label: 'Goals', value: analytics.remainingGoalAmount, color: '#06b6d4' }
  ]
  const chartMax = Math.max(...chartItems.map((item) => item.value), 1)

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <Text style={styles.heroEyebrow}>This month</Text>
        <Text style={styles.heroValue}>{formatMoney(analytics.remainingBalance, currency)}</Text>
        <Text style={styles.heroSubtitle}>
          {analytics.remainingDaysInMonth} days left. Safe daily spending: {formatMoney(analytics.safeDailySpending, currency)}
        </Text>
      </View>

      <View style={styles.metricGrid}>
        <MetricCard label="Balance" value={formatMoney(analytics.remainingBalance, currency)} accent="#38bdf8" />
        <MetricCard label="Expenses" value={formatMoney(analytics.totalExpenses, currency)} accent="#ef4444" />
        <MetricCard label="Income" value={formatMoney(analytics.totalIncome, currency)} accent="#22c55e" />
      </View>

      <View style={styles.metricGrid}>
        <MetricCard label="After fixed" value={formatMoney(analytics.remainingAfterFixedExpenses, currency)} accent="#8b5cf6" />
        <MetricCard label="Daily safe" value={formatMoney(analytics.safeDailySpending, currency)} accent="#0f766e" />
      </View>

      <View style={styles.chartCard}>
        <Text style={styles.sectionTitle}>Monthly flow</Text>
        <Text style={styles.sectionSubtitle}>A quick visual view of what is driving the month right now.</Text>
        <View style={styles.chartList}>
          {chartItems.map((item) => (
            <View key={item.label} style={styles.chartRow}>
              <Text style={styles.chartLabel}>{item.label}</Text>
              <View style={styles.chartTrack}>
                <View style={[styles.chartBar, { width: `${Math.max((item.value / chartMax) * 100, 6)}%`, backgroundColor: item.color }]} />
              </View>
              <Text style={styles.chartValue}>{formatMoney(item.value, currency)}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Planning</Text>
        <View style={styles.metricLine}>
          <Text style={styles.metricLabel}>Fixed expenses</Text>
          <Text style={styles.metricValue}>{formatMoney(analytics.fixedMonthlyExpenses, currency)}</Text>
        </View>
        <View style={styles.metricLine}>
          <Text style={styles.metricLabel}>Variable expenses</Text>
          <Text style={styles.metricValue}>{formatMoney(analytics.variableExpensesThisMonth, currency)}</Text>
        </View>
        <View style={styles.metricLine}>
          <Text style={styles.metricLabel}>Debt paid this month</Text>
          <Text style={styles.metricValue}>{formatMoney(analytics.monthlyDebtPayments, currency)}</Text>
        </View>
        <View style={styles.metricLine}>
          <Text style={styles.metricLabel}>Weeks left</Text>
          <Text style={styles.metricValue}>{analytics.remainingWeeksInMonth.toFixed(1)}</Text>
        </View>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 18,
    paddingBottom: 28,
    gap: 16
  },
  heroCard: {
    borderRadius: 24,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e3a5f',
    padding: 20,
    gap: 8
  },
  heroEyebrow: {
    color: '#7dd3fc',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  heroValue: {
    color: '#f8fafc',
    fontSize: 32,
    fontWeight: '800'
  },
  heroSubtitle: {
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 20
  },
  metricGrid: {
    flexDirection: 'row',
    gap: 12
  },
  chartCard: {
    borderRadius: 22,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 18,
    gap: 14
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
  chartList: {
    gap: 10
  },
  chartRow: {
    gap: 8
  },
  chartLabel: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600'
  },
  chartTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: '#0b1220',
    overflow: 'hidden'
  },
  chartBar: {
    height: '100%',
    borderRadius: 999
  },
  chartValue: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '700'
  },
  panel: {
    borderRadius: 22,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 18,
    gap: 12
  },
  metricLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12
  },
  metricLabel: {
    color: '#94a3b8',
    fontSize: 14
  },
  metricValue: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700'
  }
})
