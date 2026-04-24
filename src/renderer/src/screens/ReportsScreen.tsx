import { useMemo, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { InputField, MetricLine, SectionCard, SelectField } from '../components/ui'
import type { ReportsScreenProps } from './types'

interface ReportsScreenActions {
  onExport: (format: 'json' | 'csv' | 'xlsx') => void
  onImport: (format: 'json' | 'csv' | 'xlsx') => void
  onMonthlyClose: (month: string) => void
}

export default function ReportsScreen({
  snapshot,
  fmtMoney,
  onExport,
  onImport,
  onMonthlyClose,
  text,
  filteredExpenses,
  expensePeriodLabel,
  expensePeriodTotal,
  expensePeriodAverageDaily,
  expensePeriodChart
}: ReportsScreenProps & ReportsScreenActions) {
  const months = snapshot.analytics.availableMonths
  const [selectedMonth, setSelectedMonth] = useState(months[0] ?? snapshot.analytics.dashboard.month)
  const [compareMonth, setCompareMonth] = useState(months[1] ?? months[0] ?? snapshot.analytics.dashboard.month)

  const selectedSummary = useMemo(
    () => snapshot.monthlySummaries.find((entry) => entry.month === selectedMonth) ?? snapshot.monthlySummaries[0],
    [selectedMonth, snapshot.monthlySummaries]
  )
  const compareSummary = useMemo(
    () => snapshot.monthlySummaries.find((entry) => entry.month === compareMonth) ?? snapshot.monthlySummaries[1] ?? snapshot.monthlySummaries[0],
    [compareMonth, snapshot.monthlySummaries]
  )

  const comparison = useMemo(() => {
    if (!selectedSummary || !compareSummary) return null
    return {
      income: selectedSummary.income - compareSummary.income,
      expenses: selectedSummary.expenses - compareSummary.expenses,
      savings: selectedSummary.savings - compareSummary.savings,
      debtPayments: selectedSummary.debtPayments - compareSummary.debtPayments,
      closingBalance: selectedSummary.closingBalance - compareSummary.closingBalance
    }
  }, [compareSummary, selectedSummary])

  return (
    <div className="screen-grid">
      <div className="toolbar">
        <button className="secondary-button" onClick={() => onExport('json')}>
          <Download size={16} />
          {text.reports.exportJson}
        </button>
        <button className="secondary-button" onClick={() => onExport('csv')}>
          <Download size={16} />
          {text.reports.exportCsv}
        </button>
        <button className="secondary-button" onClick={() => onExport('xlsx')}>
          <Download size={16} />
          {text.reports.exportExcel}
        </button>
        <button className="secondary-button" onClick={() => onImport('json')}>
          <Upload size={16} />
          {text.reports.importJson}
        </button>
      </div>

      <div className="two-column-grid">
        <SectionCard title={text.reports.highestCategoriesTitle} subtitle={text.reports.highestCategoriesSubtitle}>
          <div className="chart-area">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={expensePeriodChart}>
                <CartesianGrid stroke="rgba(148,163,184,0.16)" vertical={false} />
                <XAxis dataKey="categoryName" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip />
                <Bar dataKey="amount" radius={[8, 8, 0, 0]}>
                  {expensePeriodChart.map((entry) => (
                    <Cell key={entry.categoryId} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title={text.reports.metricsTitle} subtitle={text.reports.metricsSubtitle}>
          <div className="forecast-list">
            <MetricLine label={text.reports.filteredPeriod} value={expensePeriodLabel} />
            <MetricLine label={text.reports.periodTransactions} value={String(filteredExpenses.length)} />
            <MetricLine label={text.reports.periodSpending} value={fmtMoney(expensePeriodTotal)} />
            <MetricLine label={text.reports.averageDailySpend} value={fmtMoney(expensePeriodAverageDaily)} />
            <MetricLine label={text.reports.remainingDays} value={String(snapshot.analytics.forecast.remainingDaysUntilMonthEnd)} />
            <MetricLine label={text.reports.remainingWeeks} value={String(snapshot.analytics.forecast.remainingWeeksUntilMonthEnd)} />
            <MetricLine label={text.dashboard.remainingBalance} value={fmtMoney(snapshot.analytics.forecast.remainingBalance)} />
            <MetricLine label={text.reports.dailyBudget} value={fmtMoney(snapshot.analytics.forecast.adjustedSafeDailySpendingUntilMonthEnd)} />
            <MetricLine label={text.reports.weeklyBudget} value={fmtMoney(snapshot.analytics.forecast.adjustedSafeWeeklySpendingUntilMonthEnd)} />
            <MetricLine label={text.reports.remainingDailyBudget} value={fmtMoney(snapshot.analytics.forecast.adjustedSafeDailySpendingUntilMonthEnd)} />
            <MetricLine label={text.reports.remainingWeeklyBudget} value={fmtMoney(snapshot.analytics.forecast.adjustedSafeWeeklySpendingUntilMonthEnd)} />
            <MetricLine label={text.reports.projectedMonthEndBalance} value={fmtMoney(snapshot.analytics.forecast.projectedMonthEndBalance)} />
            <MetricLine label={text.reports.averageWeeklySpend} value={fmtMoney(snapshot.analytics.forecast.averageWeeklySpend)} />
            <MetricLine label={text.reports.unusualExpenses} value={String(snapshot.analytics.forecast.unusualExpenses.length)} />
            <MetricLine label={text.reports.archivedMonths} value={String(snapshot.monthlySummaries.length)} />
          </div>
        </SectionCard>
      </div>

      <div className="two-column-grid">
        <SectionCard title={text.reports.monthlyCloseTitle} subtitle={text.reports.monthlyCloseSubtitle}>
          <div className="form-grid compact">
            <InputField label={text.reports.monthField} type="month" value={snapshot.analytics.dashboard.month} onChange={(value) => onMonthlyClose(value)} />
          </div>
          <div className="timeline-list">
            {snapshot.monthlySummaries.map((summary) => (
              <div key={summary.month} className="timeline-item">
                <strong>{summary.month}</strong>
                <span>{fmtMoney(summary.income)} {text.dashboard.totalIncome}</span>
                <span>{fmtMoney(summary.expenses)} {text.dashboard.totalExpenses}</span>
                <span>{fmtMoney(summary.closingBalance)} {text.reports.closingBalance}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title={text.reports.historyTitle} subtitle={text.reports.historySubtitle}>
          <div className="form-grid compact">
            <SelectField
              label={text.reports.monthField}
              value={selectedMonth}
              options={months.map((month) => ({ label: month, value: month }))}
              onChange={setSelectedMonth}
            />
          </div>
          {selectedSummary ? (
            <div className="forecast-list">
              <MetricLine label={text.dashboard.totalIncome} value={fmtMoney(selectedSummary.income)} />
              <MetricLine label={text.dashboard.totalExpenses} value={fmtMoney(selectedSummary.expenses)} />
              <MetricLine label={text.dashboard.savingsRate} value={fmtMoney(selectedSummary.savings)} />
              <MetricLine label={text.dashboard.debtRatio} value={fmtMoney(selectedSummary.debtPayments)} />
              <MetricLine label={text.reports.closingBalance} value={fmtMoney(selectedSummary.closingBalance)} />
            </div>
          ) : null}
        </SectionCard>
      </div>

      <div className="two-column-grid">
        <SectionCard title={text.reports.comparisonTitle} subtitle={text.reports.comparisonSubtitle}>
          <div className="form-grid compact">
            <SelectField
              label={text.reports.primaryMonth}
              value={selectedMonth}
              options={months.map((month) => ({ label: month, value: month }))}
              onChange={setSelectedMonth}
            />
            <SelectField
              label={text.reports.secondaryMonth}
              value={compareMonth}
              options={months.map((month) => ({ label: month, value: month }))}
              onChange={setCompareMonth}
            />
          </div>
          {comparison ? (
            <div className="forecast-list">
              <MetricLine label={text.dashboard.totalIncome} value={fmtMoney(comparison.income)} />
              <MetricLine label={text.dashboard.totalExpenses} value={fmtMoney(comparison.expenses)} />
              <MetricLine label={text.dashboard.savingsRate} value={fmtMoney(comparison.savings)} />
              <MetricLine label={text.debts.installmentAmount} value={fmtMoney(comparison.debtPayments)} />
              <MetricLine label={text.reports.closingBalance} value={fmtMoney(comparison.closingBalance)} />
            </div>
          ) : null}
        </SectionCard>

        <SectionCard title={text.reports.activityTitle} subtitle={text.reports.activitySubtitle}>
          <div className="timeline-list">
            {snapshot.activityLog.map((entry) => (
              <div key={entry.id} className="timeline-item">
                <strong>{entry.action}</strong>
                <span>{entry.detail}</span>
                <small>{entry.createdAt}</small>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
