import {
  AlertTriangle,
  BellRing,
  CircleDollarSign,
  HandCoins,
  PiggyBank,
  Banknote,
  Landmark,
  ShieldAlert,
  Plus,
  Target,
  Wallet
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { Badge, EmptyState, MetricLine, SectionCard, StatCard } from '../components/ui'
import type { DashboardScreenProps } from './types'
import { percentFormatter } from '../lib/format'
import { translateRiskLevel } from '../lib/i18n'

export default function DashboardScreen({
  snapshot,
  fmtMoney,
  actionsDisabled,
  setActiveTab,
  budgetMethodLabels,
  language,
  text
}: DashboardScreenProps) {
  const dashboard = snapshot.analytics.dashboard
  const forecast = snapshot.analytics.forecast
  const affordabilityLabel =
    forecast.affordabilityStatus === 'safe'
      ? text.dashboard.affordabilitySafe
      : forecast.affordabilityStatus === 'tight'
        ? text.dashboard.affordabilityTight
        : text.dashboard.affordabilityInsufficient

  return (
    <div className="screen-grid">
      <section className="hero-panel">
        <div>
          <span className="eyebrow">{text.dashboard.heroEyebrow}</span>
          <h2>{text.dashboard.heroTitle}</h2>
          <p>{text.dashboard.heroSummary(fmtMoney(dashboard.remainingBalance), `${dashboard.budgetHealthScore.toFixed(0)}/100`)}</p>
        </div>
        <div className="hero-actions">
          <button className="primary-button" onClick={() => setActiveTab('expenses')} disabled={actionsDisabled}>
            <Plus size={16} />
            {text.dashboard.quickExpense}
          </button>
          <button className="secondary-button" onClick={() => setActiveTab('debts')} disabled={actionsDisabled}>
            <Target size={16} />
            {text.dashboard.reviewDebts}
          </button>
          <button className="secondary-button" onClick={() => setActiveTab('budget')} disabled={actionsDisabled}>
            <Target size={16} />
            {text.dashboard.reviewPlan}
          </button>
        </div>
      </section>

      <section className="stats-grid">
        <StatCard title={text.dashboard.totalIncome} value={fmtMoney(dashboard.totalIncome)} icon={CircleDollarSign} tone="teal" subtext={text.dashboard.allSources} />
        <StatCard title={text.dashboard.totalExpenses} value={fmtMoney(dashboard.totalExpenses)} icon={Banknote} tone="amber" subtext={text.dashboard.includesFixedVariable} />
        <StatCard title={text.dashboard.remainingBalance} value={fmtMoney(dashboard.remainingBalance)} icon={Wallet} tone="blue" subtext={text.dashboard.liquidAfterSpending} />
        <StatCard title={text.dashboard.remainingAfterFixedExpenses} value={fmtMoney(dashboard.remainingAfterFixedExpenses)} icon={HandCoins} tone="slate" subtext={text.dashboard.fixedMonthlyExpenses} />
        <StatCard title={text.dashboard.remainingAfterFixedAndVariableExpenses} value={fmtMoney(dashboard.remainingAfterFixedAndVariableExpenses)} icon={Banknote} tone="amber" subtext={text.dashboard.variableExpensesThisMonth} />
        <StatCard title={text.dashboard.savingsRate} value={percentFormatter(dashboard.savingsRate)} icon={PiggyBank} tone="green" subtext={text.dashboard.fromNetIncome} />
        <StatCard title={text.dashboard.debtRatio} value={percentFormatter(dashboard.debtRatio)} icon={Landmark} tone="rose" subtext={text.dashboard.obligationsPressure} />
        <StatCard title={text.dashboard.riskLevel} value={translateRiskLevel(dashboard.riskLevel, language)} icon={ShieldAlert} tone="slate" subtext={text.dashboard.planSustainability} />
      </section>

      <div className="two-column-grid">
        <SectionCard title={text.dashboard.spendingLimitsTitle} subtitle={text.dashboard.spendingLimitsSubtitle}>
          <div className="forecast-list">
            <MetricLine label={text.dashboard.affordabilityStatus} value={affordabilityLabel} />
            <MetricLine label={text.dashboard.remainingDays} value={String(forecast.remainingDaysUntilMonthEnd)} />
            <MetricLine label={text.dashboard.remainingWeeks} value={String(forecast.remainingWeeksUntilMonthEnd)} />
            <MetricLine label={text.dashboard.remainingBalance} value={fmtMoney(forecast.remainingBalance)} />
            <MetricLine label={text.dashboard.dailySafeUntilMonthEnd} value={fmtMoney(forecast.safeDailySpendingUntilMonthEnd)} />
            <MetricLine label={text.dashboard.weeklySafeUntilMonthEnd} value={fmtMoney(forecast.safeWeeklySpendingUntilMonthEnd)} />
            <MetricLine label={text.dashboard.unpaidFixedCommitments} value={fmtMoney(dashboard.unpaidFixedCommitments)} />
            <MetricLine label={text.dashboard.installmentsDueThisMonth} value={fmtMoney(forecast.installmentsDueThisMonth)} />
            <MetricLine label={text.dashboard.pendingGoalFunding} value={fmtMoney(forecast.optionalGoalContributionsThisMonth)} />
            <MetricLine label={text.dashboard.goalsIncludedInForecast} value={forecast.goalsIncludedInForecast ? text.common.yes : text.common.no} />
            <MetricLine label={text.dashboard.balanceAfterCommitments} value={fmtMoney(forecast.balanceAfterCommitments)} />
            <MetricLine label={text.dashboard.adjustedDailySafeUntilMonthEnd} value={fmtMoney(forecast.adjustedSafeDailySpendingUntilMonthEnd)} />
            <MetricLine label={text.dashboard.adjustedWeeklySafeUntilMonthEnd} value={fmtMoney(forecast.adjustedSafeWeeklySpendingUntilMonthEnd)} />
          </div>
        </SectionCard>

        <SectionCard title={text.dashboard.forecastTitle} subtitle={text.dashboard.forecastSubtitle}>
          <div className="forecast-list">
            <MetricLine label={text.dashboard.monthEndDate} value={forecast.monthEndDate} />
            <MetricLine label={text.dashboard.spendToDate} value={fmtMoney(forecast.periodSpendToDate)} />
            <MetricLine label={text.dashboard.projectedSpend} value={fmtMoney(forecast.projectedMonthEndSpend)} />
            <MetricLine label={text.dashboard.projectedMonthEndBalance} value={fmtMoney(forecast.projectedMonthEndBalance)} />
            <MetricLine label={text.dashboard.averageDailySpend} value={fmtMoney(forecast.averageDailySpend)} />
            <MetricLine label={text.dashboard.averageWeeklySpend} value={fmtMoney(forecast.averageWeeklySpend)} />
            <MetricLine label={text.dashboard.goalCapacity} value={fmtMoney(dashboard.goalContributionCapacity)} />
            <MetricLine label={text.dashboard.runOutStatus} value={forecast.willRunOutBeforeMonthEnd ? text.common.no : text.common.yes} />
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title={text.dashboard.trendTitle}
        subtitle={text.dashboard.trendSubtitle}
        action={<Badge label={budgetMethodLabels[snapshot.analytics.budgetMethodUsed]} />}
      >
        <div className="chart-area">
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={snapshot.analytics.monthlyTrend}>
              <defs>
                <linearGradient id="incomeArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.7} />
                  <stop offset="95%" stopColor="#14b8a6" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="expenseArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.7} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(148,163,184,0.16)" vertical={false} />
              <XAxis dataKey="month" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip />
              <Area type="monotone" dataKey="income" stroke="#14b8a6" fill="url(#incomeArea)" strokeWidth={2.5} />
              <Area type="monotone" dataKey="expenses" stroke="#f97316" fill="url(#expenseArea)" strokeWidth={2.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      <div className="two-column-grid">
        <SectionCard title={text.dashboard.categoryDistributionTitle} subtitle={text.dashboard.categoryDistributionSubtitle}>
          <div className="chart-area">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={snapshot.analytics.categoryBudgets.filter((entry) => entry.actual > 0)}
                  dataKey="actual"
                  nameKey="categoryName"
                  innerRadius={68}
                  outerRadius={110}
                  paddingAngle={3}
                >
                  {snapshot.analytics.categoryBudgets
                    .filter((entry) => entry.actual > 0)
                    .map((entry) => (
                      <Cell key={entry.categoryId} fill={entry.color} />
                    ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title={text.dashboard.alertsTitle} subtitle={text.dashboard.alertsSubtitle}>
          <div className="alert-list">
            {snapshot.alerts.length === 0 ? (
              <EmptyState icon={BellRing} title={text.dashboard.noAlertsTitle} description={text.dashboard.noAlertsDescription} />
            ) : (
              snapshot.alerts.map((alert) => (
                <div key={alert.id} className={`alert-card alert-${alert.severity}`}>
                  <div className="alert-icon">
                    <AlertTriangle size={16} />
                  </div>
                  <div>
                    <strong>{alert.title}</strong>
                    <p>{alert.message}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </SectionCard>
      </div>

      <div className="two-column-grid">
        <SectionCard title={text.dashboard.recommendationsTitle} subtitle={text.dashboard.recommendationsSubtitle}>
          <div className="recommendation-list">
            {snapshot.analytics.recommendations.map((item) => (
              <div key={item} className="recommendation-item">
                <HandCoins size={18} />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
