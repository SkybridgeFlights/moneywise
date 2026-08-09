import { useMemo, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { MetricLine, MetricTile, SectionCard, SelectField } from '../components/ui'
import type { ReportsScreenProps } from './types'

interface ReportsScreenActions {
  onExport: (format: 'json' | 'csv' | 'xlsx') => void
  onImport: (format: 'json' | 'csv' | 'xlsx') => void
  onMonthlyClose: (month: string) => void
}

const round2 = (value: number): number => Math.round(value * 100) / 100

export default function ReportsScreen({
  snapshot,
  fmtMoney,
  onExport,
  onImport,
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
    () => snapshot.monthlySummaries.find((entry) => entry.month === selectedMonth),
    [selectedMonth, snapshot.monthlySummaries]
  )
  const compareSummary = useMemo(
    () => snapshot.monthlySummaries.find((entry) => entry.month === compareMonth),
    [compareMonth, snapshot.monthlySummaries]
  )
  const periodIncome = selectedSummary?.income ?? snapshot.analytics.dashboard.totalIncome
  const periodExpenses = selectedSummary?.expenses ?? expensePeriodTotal
  const netSavings = round2(periodIncome - periodExpenses)
  const savingsRate = periodIncome > 0 ? round2((netSavings / periodIncome) * 100) : 0
  const biggestCategory = expensePeriodChart[0]
  const expenseDelta = compareSummary ? round2(periodExpenses - compareSummary.expenses) : 0
  const topTransactions = [...filteredExpenses].sort((left, right) => right.amount - left.amount).slice(0, 5)
  const recentTransactions = [...filteredExpenses].sort((left, right) => right.date.localeCompare(left.date)).slice(0, 5)
  const isArabic = snapshot.settings.language === 'ar'
  const reportCopy = isArabic
    ? {
        period: 'فترة التقرير',
        overview: 'نظرة عامة',
        overviewSubtitle: 'أرقام واضحة للفترة المحددة',
        netSavings: 'صافي الادخار',
        savingsRate: 'معدل الادخار',
        biggestCategory: 'أعلى فئة',
        categoryBreakdown: 'توزيع الفئات',
        trend: 'الدخل مقابل المصاريف',
        topTransactions: 'أكبر العمليات',
        recentTransactions: 'أحدث العمليات',
        insights: 'رؤى سريعة',
        incomeVsExpenses: 'الدخل والمصاريف',
        noCategory: 'لا توجد فئة',
        lowerThanPrevious: 'الإنفاق أقل من الفترة السابقة بـ',
        higherThanPrevious: 'الإنفاق أعلى من الفترة السابقة بـ',
        highestCategory: 'أعلى فئة إنفاق هي',
        averageDaily: 'متوسط الصرف اليومي هو',
        helpSavingsRate: 'معدل الادخار = صافي الادخار ÷ الدخل. مصادر البيانات: ملخص الشهر أو سجلات الفترة المحددة.',
        helpTotalExpenses: 'إجمالي الإنفاق = مجموع كل المصاريف المسجلة داخل الفترة المحددة.'
      }
    : {
        period: 'Report period',
        overview: 'Overview',
        overviewSubtitle: 'Clear numbers for the selected period',
        netSavings: 'Net savings',
        savingsRate: 'Savings rate',
        biggestCategory: 'Biggest category',
        categoryBreakdown: 'Category breakdown',
        trend: 'Income vs expenses',
        topTransactions: 'Top transactions',
        recentTransactions: 'Recent transactions',
        insights: 'Insights',
        incomeVsExpenses: 'Income and expenses',
        noCategory: 'No category',
        lowerThanPrevious: 'Spending is lower than the previous period by',
        higherThanPrevious: 'Spending is higher than the previous period by',
        highestCategory: 'Highest spending category is',
        averageDaily: 'Average daily spend is',
        helpSavingsRate: 'Savings rate = net savings / income. Data sources: monthly summary or selected period records.',
        helpTotalExpenses: 'Total expenses = sum of all expenses recorded inside the selected period.'
      }

  return (
    <div className="screen-grid">
      <div className="toolbar">
        <button className="secondary-button" onClick={() => onExport('json')}><Download size={16} />{text.reports.exportJson}</button>
        <button className="secondary-button" onClick={() => onExport('csv')}><Download size={16} />{text.reports.exportCsv}</button>
        <button className="secondary-button" onClick={() => onExport('xlsx')}><Download size={16} />{text.reports.exportExcel}</button>
        <button className="secondary-button" onClick={() => onImport('json')}><Upload size={16} />{text.reports.importJson}</button>
      </div>

      <SectionCard title={reportCopy.period} subtitle={expensePeriodLabel}>
        <div className="form-grid compact">
          <SelectField label={text.reports.monthField} value={selectedMonth} options={months.map((month) => ({ label: month, value: month }))} onChange={setSelectedMonth} />
          <SelectField label={text.reports.secondaryMonth} value={compareMonth} options={months.map((month) => ({ label: month, value: month }))} onChange={setCompareMonth} />
        </div>
      </SectionCard>

      <SectionCard title={reportCopy.overview} subtitle={reportCopy.overviewSubtitle}>
        <div className="metric-grid">
          <MetricTile label={text.dashboard.totalIncome} value={fmtMoney(periodIncome)} icon={Download} />
          <MetricTile label={text.dashboard.totalExpenses} value={fmtMoney(periodExpenses)} icon={Upload} />
          <MetricTile label={reportCopy.netSavings} value={fmtMoney(netSavings)} icon={Download} />
          <MetricTile label={reportCopy.savingsRate} value={`${savingsRate.toFixed(1)}%`} icon={Download} />
          <MetricTile label={reportCopy.biggestCategory} value={biggestCategory?.categoryName ?? reportCopy.noCategory} icon={Upload} />
          <MetricTile label={text.reports.averageDailySpend} value={fmtMoney(expensePeriodAverageDaily)} icon={Upload} />
        </div>
      </SectionCard>

      <div className="two-column-grid">
        <SectionCard title={reportCopy.categoryBreakdown} subtitle={reportCopy.helpTotalExpenses}>
          <div className="chart-area">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={expensePeriodChart}>
                <CartesianGrid stroke="rgba(148,163,184,0.16)" vertical={false} />
                <XAxis dataKey="categoryName" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip />
                <Bar dataKey="amount" radius={[8, 8, 0, 0]}>
                  {expensePeriodChart.map((entry) => <Cell key={entry.categoryId} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="forecast-list">
            {expensePeriodChart.map((entry) => (
              <MetricLine key={entry.categoryId} label={entry.categoryName} value={`${fmtMoney(entry.amount)} (${expensePeriodTotal > 0 ? round2((entry.amount / expensePeriodTotal) * 100) : 0}%)`} />
            ))}
          </div>
        </SectionCard>

        <SectionCard title={reportCopy.trend} subtitle={reportCopy.helpSavingsRate}>
          <div className="forecast-list">
            <MetricLine label={reportCopy.incomeVsExpenses} value={`${fmtMoney(periodIncome)} / ${fmtMoney(periodExpenses)}`} />
            <MetricLine label={reportCopy.netSavings} value={fmtMoney(netSavings)} />
            <MetricLine label={reportCopy.savingsRate} value={`${savingsRate.toFixed(1)}%`} />
            <MetricLine label={text.reports.comparisonTitle} value={fmtMoney(expenseDelta)} />
          </div>
        </SectionCard>
      </div>

      <div className="two-column-grid">
        <SectionCard title={reportCopy.topTransactions} subtitle={text.reports.periodSpending}>
          <div className="timeline-list">
            {topTransactions.map((entry) => <div key={entry.id} className="timeline-item"><strong>{entry.title}</strong><span>{fmtMoney(entry.amount)}</span><small>{entry.date}</small></div>)}
          </div>
        </SectionCard>
        <SectionCard title={reportCopy.recentTransactions} subtitle={expensePeriodLabel}>
          <div className="timeline-list">
            {recentTransactions.map((entry) => <div key={entry.id} className="timeline-item"><strong>{entry.title}</strong><span>{fmtMoney(entry.amount)}</span><small>{entry.date}</small></div>)}
          </div>
        </SectionCard>
      </div>

      <SectionCard title={reportCopy.insights} subtitle={expensePeriodLabel}>
        <div className="forecast-list">
          <MetricLine label={reportCopy.highestCategory} value={biggestCategory?.categoryName ?? reportCopy.noCategory} />
          <MetricLine label={expenseDelta <= 0 ? reportCopy.lowerThanPrevious : reportCopy.higherThanPrevious} value={fmtMoney(Math.abs(expenseDelta))} />
          <MetricLine label={reportCopy.averageDaily} value={fmtMoney(expensePeriodAverageDaily)} />
        </div>
      </SectionCard>
    </div>
  )
}
