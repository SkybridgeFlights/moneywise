import { Suspense, lazy, startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { addMonths, addYears, differenceInCalendarDays, endOfDay, endOfMonth, endOfWeek, endOfYear, isWithinInterval, parseISO, startOfDay, startOfMonth, startOfWeek, startOfYear } from 'date-fns'
import {
  ArrowDownCircle,
  ArrowUpCircle,
  BriefcaseBusiness,
  CalendarRange,
  ChartNoAxesCombined,
  Gauge,
  Goal,
  Landmark,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  TrendingDown,
  TrendingUp,
  Wallet
} from 'lucide-react'
import type { AppSnapshot, DeleteCategoryInput, SaveBudgetPlanInput, SaveCategoryInput, SaveDebtInput, SaveExpenseInput, SaveGoalContributionInput, SaveGoalInput, SaveIncomeInput, SyncStatusSnapshot } from '@shared/contracts'
import type { BudgetMethod, Category, CategoryDeletionImpact, Settings } from '@shared/types'
import {
  Badge,
  EmptyState,
  InputField,
  MetricLine,
  MetricTile,
  RiskChip,
  ScreenSkeleton,
  SectionCard,
  SelectField,
  TextAreaField,
  ToggleField
} from './components/ui'
import { currencyFormatter, parseDecimalInput, todayString } from './lib/format'
import {
  applyLanguageToSettings,
  currencyOptions,
  getUiText,
  iconOptions,
  translateBudgetMethod,
  translateCategoryName,
  translateCategoryType,
  translateExpenseAllocation,
  translateGoalType,
  translatePaymentMethod,
  translatePriority,
  translateRiskLevel,
  translateStatus
} from './lib/i18n'

const DashboardScreen = lazy(() => import('./screens/DashboardScreen'))
const ReportsScreen = lazy(() => import('./screens/ReportsScreen'))

type TabKey = 'dashboard' | 'income' | 'expenses' | 'budget' | 'reports' | 'goals' | 'debts' | 'settings'
type AsyncAction = () => Promise<AppSnapshot>
type ExpensePeriodFilter = 'today' | 'week' | 'month' | 'previousMonth' | 'previousYear' | 'nextMonth' | 'nextYear'

const getExpensePeriodInterval = (filter: ExpensePeriodFilter, referenceDate = new Date()): { start: Date; end: Date } => {
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

const getExpensePeriodDayCount = (filter: ExpensePeriodFilter): number => {
  if (filter === 'today') return 1
  if (filter === 'week') return 7
  if (filter === 'month') return Math.max(new Date().getDate(), 1)
  const interval = getExpensePeriodInterval(filter)
  return Math.max(differenceInCalendarDays(interval.end, interval.start) + 1, 1)
}

const navItems = (text: ReturnType<typeof getUiText>): Array<{ key: TabKey; label: string; icon: typeof Gauge }> => [
  { key: 'dashboard', label: text.nav.dashboard, icon: Gauge },
  { key: 'income', label: text.nav.income, icon: ArrowUpCircle },
  { key: 'expenses', label: text.nav.expenses, icon: ArrowDownCircle },
  { key: 'budget', label: text.nav.budget, icon: Wallet },
  { key: 'reports', label: text.nav.reports, icon: ChartNoAxesCombined },
  { key: 'goals', label: text.nav.goals, icon: Goal },
  { key: 'debts', label: text.nav.debts, icon: Landmark },
  { key: 'settings', label: text.nav.settings, icon: SettingsIcon }
]

function createCategoryForm(category?: Category): SaveCategoryInput {
  if (!category) {
    return {
      name: '',
      type: 'custom',
      color: '#64748b',
      icon: 'folder',
      monthlyLimit: 0
    }
  }

  return {
    id: category.id,
    name: category.name,
    type: category.type,
    color: category.color,
    icon: category.icon,
    monthlyLimit: category.monthlyLimit ?? 0,
    builtIn: category.builtIn
  }
}

function createIncomeForm(input?: Partial<SaveIncomeInput>): SaveIncomeInput {
  return {
    id: input?.id,
    name: input?.name ?? '',
    groupName: input?.groupName ?? 'Primary',
    amount: input?.amount ?? 0,
    date: input?.date ?? todayString(),
    type: input?.type ?? 'fixed',
    recurring: input?.recurring ?? false,
    notes: input?.notes ?? ''
  }
}

function createExpenseForm(input?: Partial<SaveExpenseInput>): SaveExpenseInput {
  return {
    id: input?.id,
    title: input?.title ?? '',
    amount: input?.amount ?? 0,
    date: input?.date ?? todayString(),
    categoryId: input?.categoryId ?? 'misc',
    paymentMethod: input?.paymentMethod ?? 'card',
    type: input?.type ?? 'variable',
    recurring: input?.recurring ?? false,
    notes: input?.notes ?? '',
    tags: input?.tags ?? [],
    goalId: input?.goalId ?? null,
    debtId: input?.debtId ?? null,
    allocationKind: input?.allocationKind ?? 'spend'
  }
}

function createGoalForm(input?: Partial<SaveGoalInput>): SaveGoalInput {
  return {
    id: input?.id,
    name: input?.name ?? '',
    type: input?.type ?? 'general',
    targetAmount: input?.targetAmount ?? 0,
    currentAmount: input?.currentAmount ?? 0,
    targetDate: input?.targetDate ?? todayString(),
    priority: input?.priority ?? 'medium',
    notes: input?.notes ?? ''
  }
}

function createDebtForm(input?: Partial<SaveDebtInput>): SaveDebtInput {
  return {
    id: input?.id,
    name: input?.name ?? '',
    totalAmount: input?.totalAmount ?? 0,
    installmentAmount: input?.installmentAmount ?? 0,
    startDate: input?.startDate ?? todayString(),
    endDate: input?.endDate ?? null,
    desiredPayoffDate: input?.desiredPayoffDate ?? null,
    paymentFrequency: input?.paymentFrequency ?? 'monthly',
    recurringAutomatically: input?.recurringAutomatically ?? true,
    categoryId: input?.categoryId ?? 'debt',
    notes: input?.notes ?? ''
  }
}

export function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard')
  const [busyLabel, setBusyLabel] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [actionError, setActionError] = useState('')
  const [startupError, setStartupError] = useState<Error | null>(null)
  const [expenseSearch, setExpenseSearch] = useState('')
  const [expensePeriodFilter, setExpensePeriodFilter] = useState<ExpensePeriodFilter>('month')
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [pendingGoalLinkExpense, setPendingGoalLinkExpense] = useState<SaveExpenseInput | null>(null)
  const [goalLinkPromptGoalId, setGoalLinkPromptGoalId] = useState('')
  const [categoryDeletionImpact, setCategoryDeletionImpact] = useState<CategoryDeletionImpact | null>(null)
  const [categoryDeletionMode, setCategoryDeletionMode] = useState<DeleteCategoryInput['mode']>('fallback')
  const [categoryDeletionTargetId, setCategoryDeletionTargetId] = useState('')
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatusSnapshot | null>(null)

  const [incomeForm, setIncomeForm] = useState<SaveIncomeInput>(createIncomeForm())
  const [expenseForm, setExpenseForm] = useState<SaveExpenseInput>(createExpenseForm())
  const [goalForm, setGoalForm] = useState<SaveGoalInput>(createGoalForm())
  const [goalContributionForm, setGoalContributionForm] = useState<SaveGoalContributionInput>({
    goalId: '',
    amount: 0,
    date: todayString(),
    notes: '',
    categoryId: 'savings',
    paymentMethod: 'transfer'
  })
  const [debtForm, setDebtForm] = useState<SaveDebtInput>(createDebtForm())
  const [categoryForm, setCategoryForm] = useState<SaveCategoryInput>(createCategoryForm())

  useEffect(() => {
    const bridge = window.moneywise
    if (!bridge) {
      const error = new Error('Preload bridge is unavailable in renderer. Check preload loading and contextBridge exposure.')
      console.error('[renderer] Missing preload bridge', error)
      setStartupError(error)
      return
    }

    console.info('[renderer] Loading initial snapshot')
    setStatusMessage(getUiText('ar').startingApp)
    void bridge
      .getSnapshot()
      .then((data) => {
        setSnapshot(data)
        setStatusMessage('')
      })
      .catch((error: unknown) => {
        const nextError = error instanceof Error ? error : new Error(String(error))
        console.error('[renderer] Initial snapshot load failed', nextError)
        setStartupError(nextError)
      })
  }, [])

  const bridge = window.moneywise
  const settings = snapshot?.settings
  const language = settings?.language ?? 'ar'
  const text = useMemo(() => getUiText(language), [language])
  const deferredSearch = useDeferredValue(expenseSearch)
  const currentBudgetPlan = useMemo(() => {
    if (!snapshot) return null
    return snapshot.budgetPlans.find((entry) => entry.month === snapshot.analytics.dashboard.month) ?? snapshot.budgetPlans[0] ?? null
  }, [snapshot])

  useEffect(() => {
    if (!bridge) {
      return
    }
    let disposed = false
    const loadSyncStatus = async (): Promise<void> => {
      try {
        const status = await bridge.getSyncStatus()
        if (!disposed) {
          setSyncStatus(status)
        }
      } catch (error) {
        if (!disposed) {
          const nextError = error instanceof Error ? error : new Error(String(error))
          setActionError(nextError.message || getUiText('ar').common.genericError)
        }
      }
    }
    void loadSyncStatus()
    const timer = window.setInterval(() => {
      void loadSyncStatus()
    }, 15000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [bridge])

  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.dir = settings?.rtl ? 'rtl' : 'ltr'
  }, [language, settings?.rtl])

  const periodFilteredExpenses = useMemo(() => {
    if (!snapshot) return []
    const interval = getExpensePeriodInterval(expensePeriodFilter)
    return snapshot.expenses.filter((expense) => isWithinInterval(parseISO(expense.date), interval))
  }, [expensePeriodFilter, snapshot])

  const filteredExpenses = useMemo(() => {
    if (!snapshot) return []
    const query = deferredSearch.trim().toLowerCase()
    if (!query) return periodFilteredExpenses

    return periodFilteredExpenses.filter((expense) => {
      const category = snapshot.categories.find((entry) => entry.id === expense.categoryId)
      const categoryName = category ? translateCategoryName(category, language) : expense.categoryId
      return [expense.title, expense.notes, expense.amount.toString(), expense.date, categoryName, expense.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
  }, [deferredSearch, language, periodFilteredExpenses, snapshot])

  useEffect(() => {
    if (!snapshot) return
    const fallbackCategory = snapshot.categories[0]?.id ?? 'misc'
    const defaultSavingCategory = snapshot.categories.find((entry) => entry.type === 'saving')?.id ?? 'savings'
    const defaultDebtCategory = snapshot.categories.find((entry) => entry.type === 'debt')?.id ?? 'debt'
    setExpenseForm((current) => ({ ...current, categoryId: current.categoryId || fallbackCategory }))
    setGoalContributionForm((current) => ({
      ...current,
      goalId: current.goalId || snapshot.goals[0]?.id || '',
      categoryId: current.categoryId || defaultSavingCategory
    }))
    setDebtForm((current) => ({
      ...current,
      categoryId: current.categoryId || defaultDebtCategory
    }))

    if (editingCategoryId && !snapshot.categories.some((category) => category.id === editingCategoryId)) {
      setEditingCategoryId(null)
      setCategoryForm(createCategoryForm())
    }
  }, [editingCategoryId, snapshot])

  const expensePeriodOptions: Array<{ label: string; value: ExpensePeriodFilter }> = [
    { label: text.expenses.todayFilter, value: 'today' },
    { label: text.expenses.weekFilter, value: 'week' },
    { label: text.expenses.monthFilter, value: 'month' },
    { label: text.expenses.previousMonthFilter, value: 'previousMonth' },
    { label: text.expenses.previousYearFilter, value: 'previousYear' },
    { label: text.expenses.nextMonthFilter, value: 'nextMonth' },
    { label: text.expenses.nextYearFilter, value: 'nextYear' }
  ]
  const expensePeriodDays = getExpensePeriodDayCount(expensePeriodFilter)
  const expensePeriodTotal = filteredExpenses.reduce((sum, entry) => sum + entry.amount, 0)
  const expensePeriodAverageDaily = expensePeriodFilter === 'today' ? expensePeriodTotal : expensePeriodTotal / Math.max(expensePeriodDays, 1)
  const isFutureExpensePeriod = expensePeriodFilter === 'nextMonth' || expensePeriodFilter === 'nextYear'
  const expensePeriodChart = useMemo(() => {
    const totals = new Map<string, number>()
    filteredExpenses.forEach((expense) => {
      totals.set(expense.categoryId, (totals.get(expense.categoryId) ?? 0) + expense.amount)
    })
    return [...totals.entries()]
      .map(([categoryId, amount]) => {
        const category = snapshot?.categories.find((entry) => entry.id === categoryId)
        return {
          categoryId,
          categoryName: category ? translateCategoryName(category, language) : categoryId,
          amount,
          color: category?.color ?? '#5b7fff'
        }
      })
      .sort((left, right) => right.amount - left.amount)
      .slice(0, 6)
  }, [filteredExpenses, language, snapshot?.categories])
  const expensePeriodLabel = expensePeriodOptions.find((entry) => entry.value === expensePeriodFilter)?.label ?? text.expenses.monthFilter

  const performAction = async (label: string, action: AsyncAction): Promise<boolean> => {
    setBusyLabel(label)
    setActionError('')
    try {
      const next = await action()
      startTransition(() => {
        setSnapshot(next)
        setStatusMessage(text.completedAction(label))
      })
      window.setTimeout(() => setStatusMessage(''), 2200)
      return true
    } catch (error) {
      const nextError = error instanceof Error ? error : new Error(String(error))
      console.error(`[renderer] Action failed: ${label}`, nextError)
      setActionError(nextError.message || text.common.genericError)
      return false
    } finally {
      setBusyLabel('')
    }
  }

  const refreshSyncStatus = async (): Promise<void> => {
    if (!bridge) return
    try {
      const nextStatus = await bridge.getSyncStatus()
      setSyncStatus(nextStatus)
    } catch (error) {
      const nextError = error instanceof Error ? error : new Error(String(error))
      setActionError(nextError.message || text.common.genericError)
    }
  }

  const runManualSync = async (): Promise<void> => {
    if (!bridge) return
    setBusyLabel(text.settings.syncNow)
    setActionError('')
    try {
      const nextStatus = await bridge.syncNow()
      setSyncStatus(nextStatus)
      if (nextStatus.phase === 'error' && nextStatus.lastError) {
        setActionError(nextStatus.lastError)
      } else {
        setStatusMessage(text.completedAction(text.settings.syncNow))
        window.setTimeout(() => setStatusMessage(''), 2200)
      }
    } catch (error) {
      const nextError = error instanceof Error ? error : new Error(String(error))
      setActionError(nextError.message || text.common.genericError)
    } finally {
      setBusyLabel('')
    }
  }

  const updateSyncPaused = async (paused: boolean): Promise<void> => {
    if (!bridge) return
    setBusyLabel(paused ? text.settings.pauseSync : text.settings.resumeSync)
    setActionError('')
    try {
      const nextStatus = await bridge.setSyncPaused(paused)
      setSyncStatus(nextStatus)
      setStatusMessage(text.completedAction(paused ? text.settings.pauseSync : text.settings.resumeSync))
      window.setTimeout(() => setStatusMessage(''), 2200)
    } catch (error) {
      const nextError = error instanceof Error ? error : new Error(String(error))
      setActionError(nextError.message || text.common.genericError)
    } finally {
      setBusyLabel('')
    }
  }

  if (startupError) {
    return (
      <div className="boot-error-screen">
        <div className="boot-error-card">
          <h1>{text.startupTitle}</h1>
          <p>{text.startupPhaseData}</p>
          <pre>{`${startupError.message}\n\n${startupError.stack ?? ''}`}</pre>
        </div>
      </div>
    )
  }

  if (!bridge) {
    return (
      <div className="boot-error-screen">
        <div className="boot-error-card">
          <h1>{text.startupTitle}</h1>
          <p>{text.startupPhaseBridge}</p>
          <pre>{text.startupBridgeMissing}</pre>
        </div>
      </div>
    )
  }

  if (!snapshot || !settings || !currentBudgetPlan) {
    return <div className="loading-state">{text.preparingApp}</div>
  }

  const fmtMoney = (value: number): string => currencyFormatter(value, settings.currency, settings.locale)
  const dashboard = snapshot.analytics.dashboard
  const actionsDisabled = busyLabel.length > 0
  const syncConnectionLabel = !syncStatus?.enabled
    ? text.settings.syncDisabled
    : syncStatus.paused
      ? text.settings.syncPausedStatus
      : syncStatus.backendReachable
        ? text.settings.syncConnected
        : text.settings.syncOffline
  const syncPhaseLabel =
    syncStatus?.phase === 'syncing'
      ? text.settings.syncInProgress
      : syncStatus?.phase === 'error'
        ? text.settings.syncNeedsAttention
        : syncStatus?.pendingChanges
          ? text.settings.syncPending
          : text.settings.syncReady
  const syncTopbarLabel = syncStatus
    ? `${text.settings.syncTitle}: ${syncPhaseLabel}`
    : `${text.settings.syncTitle}: ${text.settings.syncLoading}`
  const defaultExpenseCategoryId = snapshot.categories.find((entry) => entry.id === 'misc')?.id ?? snapshot.categories[0]?.id ?? 'misc'
  const defaultDebtCategoryId = snapshot.categories.find((entry) => entry.type === 'debt')?.id ?? snapshot.categories[0]?.id ?? 'debt'
  const budgetMethodLabels = Object.fromEntries(
    (Object.keys({
      'fifty-thirty-twenty': true,
      'zero-based': true,
      'custom-percentage': true,
      'priority-based': true,
      'goal-first': true,
      'debt-focused': true
    }) as BudgetMethod[]).map((method) => [method, translateBudgetMethod(method, language)])
  ) as Record<BudgetMethod, string>
  const nav = navItems(text)

  const resetIncomeForm = (): void => setIncomeForm(createIncomeForm())
  const resetExpenseForm = (): void => setExpenseForm(createExpenseForm({ categoryId: defaultExpenseCategoryId }))
  const resetGoalForm = (): void => setGoalForm(createGoalForm())
  const resetDebtForm = (): void => setDebtForm(createDebtForm({ categoryId: defaultDebtCategoryId }))

  const incomeErrors = {
    name: incomeForm.name.trim() ? '' : text.income.errors.name,
    amount: incomeForm.amount > 0 ? '' : text.income.errors.amount
  }
  const expenseErrors = {
    title: expenseForm.title.trim() ? '' : text.expenses.errors.title,
    amount: expenseForm.amount > 0 ? '' : text.expenses.errors.amount
  }
  const goalErrors = {
    name: goalForm.name.trim() ? '' : text.goals.errors.name,
    targetAmount: goalForm.targetAmount > 0 ? '' : text.goals.errors.targetAmount
  }
  const debtErrors = {
    name: debtForm.name.trim() ? '' : text.debts.errors.name,
    totalAmount: debtForm.totalAmount > 0 ? '' : text.debts.errors.totalAmount
  }

  const handleIncomeSubmit = async (): Promise<void> => {
    if (incomeErrors.name || incomeErrors.amount) return
    const saved = await performAction(incomeForm.id ? text.common.edit : text.income.saveAction, () => bridge.saveIncome(incomeForm))
    if (saved) {
      resetIncomeForm()
    }
  }

  const handleExpenseSubmit = async (): Promise<void> => {
    if (expenseErrors.title || expenseErrors.amount) return
    const category = snapshot.categories.find((entry) => entry.id === expenseForm.categoryId)
    const linkedDebt = expenseForm.debtId ? snapshot.debts.find((entry) => entry.id === expenseForm.debtId) ?? null : null
    const normalizedExpense: SaveExpenseInput = {
      ...expenseForm,
      categoryId: linkedDebt?.categoryId ?? expenseForm.categoryId,
      goalId: linkedDebt ? null : expenseForm.goalId ?? null,
      debtId: linkedDebt?.id ?? null,
      allocationKind: linkedDebt ? 'spend' : expenseForm.goalId ? 'goal-contribution' : category?.type === 'saving' ? 'saving' : 'spend'
    }

    if (normalizedExpense.goalId && category?.type !== 'saving') {
      setPendingGoalLinkExpense(normalizedExpense)
      setGoalLinkPromptGoalId(normalizedExpense.goalId)
      return
    }

    const saved = await performAction(expenseForm.id ? text.common.edit : text.expenses.saveAction, () => bridge.saveExpense(normalizedExpense))
    if (saved) {
      resetExpenseForm()
    }
  }

  const handleGoalSubmit = async (): Promise<void> => {
    if (goalErrors.name || goalErrors.targetAmount) return
    const saved = await performAction(goalForm.id ? text.common.edit : text.goals.saveAction, () => bridge.saveGoal(goalForm))
    if (saved) {
      resetGoalForm()
    }
  }

  const handleGoalContributionSubmit = async (): Promise<void> => {
    if (!goalContributionForm.goalId || goalContributionForm.amount <= 0) return
    const saved = await performAction(text.goals.addContribution, () => bridge.saveGoalContribution(goalContributionForm))
    if (saved) {
      setGoalContributionForm((current) => ({ ...current, amount: 0, notes: '', date: todayString() }))
    }
  }

  const handleDebtSubmit = async (): Promise<void> => {
    if (debtErrors.name || debtErrors.totalAmount) return
    const saved = await performAction(text.nav.debts, () =>
      bridge.saveDebt({
        ...debtForm,
        endDate: debtForm.endDate || null,
        desiredPayoffDate: debtForm.desiredPayoffDate || null
      })
    )
    if (saved) {
      resetDebtForm()
    }
  }

  const confirmGoalExpenseLink = async (mode: 'convert' | 'keep'): Promise<void> => {
    if (!pendingGoalLinkExpense) return
    const savingCategoryId = snapshot.categories.find((entry) => entry.type === 'saving')?.id ?? pendingGoalLinkExpense.categoryId
    const payload: SaveExpenseInput =
      mode === 'convert'
        ? {
            ...pendingGoalLinkExpense,
            categoryId: savingCategoryId,
            goalId: goalLinkPromptGoalId || snapshot.goals[0]?.id || null,
            allocationKind: 'goal-contribution'
          }
        : {
            ...pendingGoalLinkExpense,
            goalId: goalLinkPromptGoalId || snapshot.goals[0]?.id || null,
            allocationKind: 'goal-contribution'
          }

    const saved = await performAction(text.expenses.saveAction, () => bridge.saveExpense(payload))
    if (saved) {
      setPendingGoalLinkExpense(null)
      setGoalLinkPromptGoalId('')
      resetExpenseForm()
    }
  }

  const beginEditIncome = (income: AppSnapshot['incomes'][number]): void => {
    setIncomeForm(createIncomeForm(income))
    setActiveTab('income')
  }

  const beginEditExpense = (expense: AppSnapshot['expenses'][number]): void => {
    setExpenseForm(createExpenseForm(expense))
    setActiveTab('expenses')
  }

  const beginEditGoal = (goal: AppSnapshot['goals'][number]): void => {
    setGoalForm(createGoalForm(goal))
    setActiveTab('goals')
  }

  const beginEditDebt = (debt: AppSnapshot['debts'][number]): void => {
    setDebtForm(createDebtForm(debt))
    setActiveTab('debts')
  }

  const confirmResetData = async (): Promise<void> => {
    const reset = await performAction(text.settings.reset, () => bridge.resetData())
    if (reset) {
      setResetDialogOpen(false)
      resetIncomeForm()
      resetExpenseForm()
      resetGoalForm()
      resetDebtForm()
      setCategoryForm(createCategoryForm())
      setEditingCategoryId(null)
    }
  }

  const openCategoryDeletionDialog = async (category: Category): Promise<void> => {
    try {
      const impact = await bridge.getCategoryDeletionImpact(category.id)
      setCategoryDeletionImpact(impact)
      setCategoryDeletionMode('fallback')
      setCategoryDeletionTargetId(impact.availableTargetCategories[0]?.id ?? '')
    } catch (error) {
      const nextError = error instanceof Error ? error : new Error(String(error))
      setActionError(nextError.message || text.common.genericError)
    }
  }

  const confirmCategoryDeletion = async (): Promise<void> => {
    if (!categoryDeletionImpact) return
    const payload: DeleteCategoryInput = {
      categoryId: categoryDeletionImpact.categoryId,
      mode: categoryDeletionMode,
      targetCategoryId: categoryDeletionMode === 'reassign' ? categoryDeletionTargetId : undefined
    }
    const deleted = await performAction(text.settings.confirmDeleteCategory, () => bridge.deleteCategory(payload))
    if (deleted) {
      setCategoryDeletionImpact(null)
    }
  }

  const handleCategorySubmit = async (): Promise<void> => {
    if (!categoryForm.name.trim()) return
    const saved = await performAction(editingCategoryId ? text.settings.updateCategory : text.settings.saveCategory, () =>
      bridge.saveCategory({
        ...categoryForm,
        monthlyLimit: categoryForm.monthlyLimit && categoryForm.monthlyLimit > 0 ? categoryForm.monthlyLimit : null
      })
    )
    if (saved) {
      setEditingCategoryId(null)
      setCategoryForm(createCategoryForm())
    }
  }

  const beginEditCategory = (category: Category): void => {
    setEditingCategoryId(category.id)
    setCategoryForm(createCategoryForm(category))
  }

  const updateBudgetMethod = async (method: BudgetMethod): Promise<void> => {
    const payload: SaveBudgetPlanInput = { ...currentBudgetPlan, method }
    await performAction(text.budget.method, () => bridge.saveBudgetPlan(payload))
  }

  const updateSettings = async (next: Settings): Promise<void> => {
    await performAction(text.nav.settings, () => bridge.saveSettings(next))
  }

  const renderIncome = () => (
    <div className="screen-grid">
      <div className="two-column-grid">
        <SectionCard title={text.income.addTitle} subtitle={text.income.addSubtitle}>
          <div className="form-grid">
            <InputField label={text.income.sourceName} value={incomeForm.name} onChange={(value) => setIncomeForm({ ...incomeForm, name: value })} error={incomeErrors.name} />
            <InputField label={text.income.group} value={incomeForm.groupName} onChange={(value) => setIncomeForm({ ...incomeForm, groupName: value })} hint={text.income.groupHint} />
            <InputField label={text.income.amount} type="number" value={incomeForm.amount} onChange={(value) => setIncomeForm({ ...incomeForm, amount: parseDecimalInput(value) })} error={incomeErrors.amount} />
            <InputField label={text.income.date} type="date" value={incomeForm.date} onChange={(value) => setIncomeForm({ ...incomeForm, date: value })} />
            <SelectField label={text.income.type} value={incomeForm.type} options={[{ label: text.income.fixed, value: 'fixed' }, { label: text.income.variable, value: 'variable' }]} onChange={(value) => setIncomeForm({ ...incomeForm, type: value as SaveIncomeInput['type'] })} />
            <ToggleField label={text.income.recurringMonthly} checked={incomeForm.recurring} onChange={(checked) => setIncomeForm({ ...incomeForm, recurring: checked })} />
            <TextAreaField label={text.income.notes} value={incomeForm.notes} onChange={(value) => setIncomeForm({ ...incomeForm, notes: value })} />
            <button className="primary-button" onClick={() => void handleIncomeSubmit()} disabled={actionsDisabled || Boolean(incomeErrors.name || incomeErrors.amount)}>
              <Plus size={16} />
              {incomeForm.id ? text.common.edit : text.income.saveAction}
            </button>
            {incomeForm.id ? <button className="ghost-button" onClick={resetIncomeForm}>{text.common.cancel}</button> : null}
          </div>
        </SectionCard>

        <SectionCard title={text.income.summaryTitle} subtitle={text.income.summarySubtitle}>
          <div className="metric-grid">
            <MetricTile label={text.income.sources} value={String(snapshot.incomes.length)} icon={BriefcaseBusiness} />
            <MetricTile label={text.common.recurring} value={String(snapshot.incomes.filter((entry) => entry.recurring).length)} icon={RefreshCw} />
            <MetricTile label={text.income.fixed} value={fmtMoney(snapshot.incomes.filter((entry) => entry.type === 'fixed').reduce((sum, entry) => sum + entry.amount, 0))} icon={TrendingUp} />
            <MetricTile label={text.income.variable} value={fmtMoney(snapshot.incomes.filter((entry) => entry.type === 'variable').reduce((sum, entry) => sum + entry.amount, 0))} icon={TrendingDown} />
          </div>
        </SectionCard>
      </div>

      <SectionCard title={text.income.recordsTitle} subtitle={text.income.recordsSubtitle}>
        <table className="data-table">
          <thead>
            <tr>
              <th>{text.income.source}</th>
              <th>{text.income.group}</th>
              <th>{text.income.type}</th>
              <th>{text.income.date}</th>
              <th>{text.income.amount}</th>
              <th>{text.common.recurring}</th>
              <th>{text.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.incomes.map((income) => (
              <tr key={income.id}>
                <td>{income.name}</td>
                <td>{income.groupName}</td>
                <td>{income.type === 'fixed' ? text.income.fixed : text.income.variable}</td>
                <td>{income.date}</td>
                <td>{fmtMoney(income.amount)}</td>
                <td>{income.recurring ? text.common.yes : text.common.no}</td>
                <td>
                  <div className="toolbar">
                    <button className="ghost-button" onClick={() => beginEditIncome(income)}><Pencil size={14} />{text.common.edit}</button>
                    <button className="ghost-button" onClick={() => void performAction(text.common.delete, () => bridge.deleteIncome(income.id))}>{text.common.delete}</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>
    </div>
  )

  const renderExpenses = () => (
    <div className="screen-grid">
      <div className="two-column-grid">
        <SectionCard title={text.expenses.addTitle} subtitle={text.expenses.addSubtitle}>
          <div className="form-grid">
            <InputField label={text.expenses.title} value={expenseForm.title} onChange={(value) => setExpenseForm({ ...expenseForm, title: value })} error={expenseErrors.title} />
            <InputField label={text.income.amount} type="number" value={expenseForm.amount} onChange={(value) => setExpenseForm({ ...expenseForm, amount: parseDecimalInput(value) })} error={expenseErrors.amount} />
            <InputField label={text.expenses.date} type="date" value={expenseForm.date} onChange={(value) => setExpenseForm({ ...expenseForm, date: value })} />
            <SelectField
              label={text.expenses.category}
              value={expenseForm.categoryId}
              options={snapshot.categories.map((category) => ({ label: translateCategoryName(category, language), value: category.id }))}
              onChange={(value) => setExpenseForm({ ...expenseForm, categoryId: value })}
            />
            <SelectField
              label={text.expenses.goalLink}
              value={expenseForm.goalId ?? ''}
              options={[{ label: text.common.keepUnlinked, value: '' }, ...snapshot.goals.map((goal) => ({ label: goal.name, value: goal.id }))]}
              onChange={(value) => setExpenseForm({ ...expenseForm, goalId: value || null, debtId: value ? null : expenseForm.debtId })}
            />
            <SelectField
              label={text.expenses.debtLink}
              value={expenseForm.debtId ?? ''}
              options={[{ label: text.common.keepUnlinked, value: '' }, ...snapshot.debts.map((debt) => ({ label: debt.name, value: debt.id }))]}
              onChange={(value) => {
                const linkedDebt = snapshot.debts.find((debt) => debt.id === value)
                setExpenseForm({
                  ...expenseForm,
                  debtId: value || null,
                  goalId: value ? null : expenseForm.goalId,
                  categoryId: linkedDebt?.categoryId ?? expenseForm.categoryId
                })
              }}
            />
            <SelectField
              label={text.expenses.paymentMethod}
              value={expenseForm.paymentMethod}
              options={(['card', 'bank', 'cash', 'wallet', 'transfer'] as const).map((value) => ({ label: translatePaymentMethod(value, language), value }))}
              onChange={(value) => setExpenseForm({ ...expenseForm, paymentMethod: value as SaveExpenseInput['paymentMethod'] })}
            />
            <SelectField
              label={text.expenses.expenseType}
              value={expenseForm.type}
              options={[{ label: text.income.variable, value: 'variable' }, { label: text.income.fixed, value: 'fixed' }]}
              onChange={(value) => setExpenseForm({ ...expenseForm, type: value as SaveExpenseInput['type'] })}
            />
            <ToggleField label={text.income.recurringMonthly} checked={expenseForm.recurring} onChange={(checked) => setExpenseForm({ ...expenseForm, recurring: checked })} />
            <InputField label={text.expenses.tags} value={expenseForm.tags.join(', ')} onChange={(value) => setExpenseForm({ ...expenseForm, tags: value.split(',').map((item) => item.trim()).filter(Boolean) })} hint={text.expenses.tagsHint} />
            <TextAreaField label={text.expenses.notes} value={expenseForm.notes} onChange={(value) => setExpenseForm({ ...expenseForm, notes: value })} />
            <button className="primary-button" onClick={() => void handleExpenseSubmit()} disabled={actionsDisabled || Boolean(expenseErrors.title || expenseErrors.amount)}>
              <Plus size={16} />
              {expenseForm.id ? text.common.edit : text.expenses.saveAction}
            </button>
            {expenseForm.id ? <button className="ghost-button" onClick={resetExpenseForm}>{text.common.cancel}</button> : null}
          </div>
        </SectionCard>

        <SectionCard title={text.expenses.filtersTitle} subtitle={text.expenses.filtersSubtitle}>
          <div className="form-grid compact">
            <SelectField
              label={text.expenses.periodFilter}
              value={expensePeriodFilter}
              options={expensePeriodOptions}
              onChange={(value) => setExpensePeriodFilter(value as ExpensePeriodFilter)}
            />
          </div>
          <div className="search-box">
            <Search size={16} />
            <input value={expenseSearch} onChange={(event) => setExpenseSearch(event.target.value)} placeholder={text.expenses.searchPlaceholder} />
          </div>
          <div className="metric-grid">
            <MetricTile label={text.expenses.periodSpending} value={fmtMoney(expensePeriodTotal)} icon={CalendarRange} />
            <MetricTile label={text.expenses.transactionsCount} value={String(filteredExpenses.length)} icon={Search} />
            <MetricTile label={text.expenses.averageDailySpending} value={fmtMoney(expensePeriodAverageDaily)} icon={ChartNoAxesCombined} />
            <MetricTile label={text.common.recurring} value={String(filteredExpenses.filter((entry) => entry.recurring).length)} icon={RefreshCw} />
          </div>
          <div className="forecast-list">
            <MetricLine label={text.dashboard.totalIncome} value={fmtMoney(dashboard.totalIncome)} />
            <MetricLine label={text.dashboard.fixedMonthlyExpenses} value={fmtMoney(dashboard.fixedMonthlyExpenses)} />
            <MetricLine label={text.dashboard.remainingAfterFixedExpenses} value={fmtMoney(dashboard.remainingAfterFixedExpenses)} />
            <MetricLine label={text.dashboard.variableExpensesThisMonth} value={fmtMoney(dashboard.variableExpensesThisMonth)} />
            <MetricLine label={text.dashboard.remainingAfterFixedAndVariableExpenses} value={fmtMoney(dashboard.remainingAfterFixedAndVariableExpenses)} />
            <MetricLine label={text.dashboard.dailySafeUntilMonthEnd} value={fmtMoney(snapshot.analytics.forecast.adjustedSafeDailySpendingUntilMonthEnd)} />
          </div>
        </SectionCard>
      </div>

      <SectionCard title={text.expenses.recordsTitle} subtitle={text.expenses.recordsSubtitle}>
        {filteredExpenses.length === 0 ? (
          <EmptyState icon={Search} title={text.expenses.noResultsTitle} description={isFutureExpensePeriod ? text.expenses.noFutureResultsDescription : text.expenses.noResultsDescription} />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{text.expenses.title}</th>
                <th>{text.expenses.category}</th>
                <th>{text.expenses.date}</th>
                <th>{text.expenses.paymentMethod}</th>
                <th>{text.expenses.expenseType}</th>
                <th>{text.expenses.allocation}</th>
                <th>{text.income.amount}</th>
                <th>{text.common.actions}</th>
              </tr>
            </thead>
            <tbody>
              {filteredExpenses.map((expense) => {
                const category = snapshot.categories.find((entry) => entry.id === expense.categoryId)
                return (
                  <tr key={expense.id}>
                    <td>
                      <div className="stacked-cell">
                        <strong>{expense.title}</strong>
                        <span>{expense.notes || expense.tags.join(', ') || '-'}</span>
                      </div>
                    </td>
                    <td><Badge label={category ? translateCategoryName(category, language) : expense.categoryId} color={category?.color} /></td>
                    <td>{expense.date}</td>
                    <td>{translatePaymentMethod(expense.paymentMethod, language)}</td>
                    <td>{expense.type === 'fixed' ? text.income.fixed : text.income.variable}</td>
                    <td>
                      <div className="stacked-cell">
                        <span>{translateExpenseAllocation(expense.allocationKind, language)}</span>
                        {expense.goalId ? <strong>{snapshot.goals.find((goal) => goal.id === expense.goalId)?.name ?? expense.goalId}</strong> : null}
                        {expense.debtId ? <strong>{snapshot.debts.find((debt) => debt.id === expense.debtId)?.name ?? expense.debtId}</strong> : null}
                      </div>
                    </td>
                    <td>{fmtMoney(expense.amount)}</td>
                    <td>
                      <div className="toolbar">
                        <button className="ghost-button" onClick={() => beginEditExpense(expense)}><Pencil size={14} />{text.common.edit}</button>
                        <button className="ghost-button" onClick={() => void performAction(text.common.delete, () => bridge.deleteExpense(expense.id))}>{text.common.delete}</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </SectionCard>
    </div>
  )

  const renderBudget = () => (
    <div className="screen-grid">
      <div className="two-column-grid">
        <SectionCard title={text.budget.engineTitle} subtitle={text.budget.engineSubtitle}>
          <div className="form-grid">
            <SelectField label={text.budget.method} value={currentBudgetPlan.method} options={Object.entries(budgetMethodLabels).map(([value, label]) => ({ value, label }))} onChange={(value) => void updateBudgetMethod(value as BudgetMethod)} />
            <InputField label={text.budget.monthlySavingsTarget} type="number" value={currentBudgetPlan.customSavingsTarget} onChange={(value) => void performAction(text.budget.monthlySavingsTarget, () => bridge.saveBudgetPlan({ ...currentBudgetPlan, customSavingsTarget: parseDecimalInput(value) }))} />
            <InputField label={text.budget.emergencyTarget} type="number" value={currentBudgetPlan.customEmergencyTarget} onChange={(value) => void performAction(text.budget.emergencyTarget, () => bridge.saveBudgetPlan({ ...currentBudgetPlan, customEmergencyTarget: parseDecimalInput(value) }))} />
            <InputField label={text.budget.debtAcceleration} type="number" value={currentBudgetPlan.debtAcceleration} onChange={(value) => void performAction(text.budget.debtAcceleration, () => bridge.saveBudgetPlan({ ...currentBudgetPlan, debtAcceleration: parseDecimalInput(value) }))} />
            <TextAreaField label={text.budget.notes} value={currentBudgetPlan.notes} onChange={(value) => void performAction(text.budget.notes, () => bridge.saveBudgetPlan({ ...currentBudgetPlan, notes: value }))} />
          </div>
        </SectionCard>

        <SectionCard title={text.budget.sustainabilityTitle} subtitle={text.budget.sustainabilitySubtitle}>
          <div className="forecast-list">
            <MetricLine label={text.budget.disposableCash} value={fmtMoney(dashboard.disposableCash)} />
            <MetricLine label={text.budget.goalCapacity} value={fmtMoney(dashboard.goalContributionCapacity)} />
            <MetricLine label={text.budget.remainingBalance} value={fmtMoney(dashboard.remainingBalance)} />
            <MetricLine label={text.dashboard.fixedMonthlyExpenses} value={fmtMoney(dashboard.fixedMonthlyExpenses)} />
            <MetricLine label={text.dashboard.remainingAfterFixedExpenses} value={fmtMoney(dashboard.remainingAfterFixedExpenses)} />
            <MetricLine label={text.dashboard.remainingAfterFixedAndVariableExpenses} value={fmtMoney(dashboard.remainingAfterFixedAndVariableExpenses)} />
            <MetricLine label={text.budget.healthScore} value={`${dashboard.budgetHealthScore.toFixed(0)} / 100`} />
            <RiskChip level={dashboard.riskLevel} label={`${text.common.risk}: ${translateRiskLevel(dashboard.riskLevel, language)}`} />
          </div>
        </SectionCard>
      </div>

      <SectionCard title={text.budget.comparisonTitle} subtitle={text.budget.comparisonSubtitle}>
        <table className="data-table">
          <thead>
            <tr>
              <th>{text.expenses.category}</th>
              <th>{text.common.recommended}</th>
              <th>{text.common.actual}</th>
              <th>{text.common.difference}</th>
              <th>{text.common.used}</th>
              <th>{text.common.status}</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.analytics.categoryBudgets.map((item) => (
              <tr key={item.categoryId}>
                <td><Badge label={item.categoryName} color={item.color} /></td>
                <td>{fmtMoney(item.recommended)}</td>
                <td>{fmtMoney(item.actual)}</td>
                <td className={item.difference < 0 ? 'negative' : 'positive'}>{item.difference < 0 ? '-' : '+'}{fmtMoney(Math.abs(item.difference))}</td>
                <td>{item.percentUsed.toFixed(1)}%</td>
                <td><span className={`state-pill state-${item.status}`}>{translateStatus(item.status, language)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>
    </div>
  )

  const renderGoals = () => (
    <div className="screen-grid">
      <div className="two-column-grid">
        <SectionCard title={text.goals.addTitle} subtitle={text.goals.addSubtitle}>
          <div className="form-grid">
            <InputField label={text.goals.name} value={goalForm.name} onChange={(value) => setGoalForm({ ...goalForm, name: value })} error={goalErrors.name} />
            <SelectField label={text.goals.type} value={goalForm.type} options={(['general', 'emergency-fund', 'travel', 'device', 'debt-payoff', 'large-purchase'] as const).map((value) => ({ label: translateGoalType(value, language), value }))} onChange={(value) => setGoalForm({ ...goalForm, type: value as SaveGoalInput['type'] })} />
            <InputField label={text.goals.targetAmount} type="number" value={goalForm.targetAmount} onChange={(value) => setGoalForm({ ...goalForm, targetAmount: parseDecimalInput(value) })} error={goalErrors.targetAmount} />
            <InputField label={text.goals.openingAmount} type="number" value={goalForm.currentAmount} onChange={(value) => setGoalForm({ ...goalForm, currentAmount: parseDecimalInput(value) })} />
            <InputField label={text.goals.targetDate} type="date" value={goalForm.targetDate} onChange={(value) => setGoalForm({ ...goalForm, targetDate: value })} />
            <SelectField label={text.goals.priority} value={goalForm.priority} options={(['high', 'medium', 'low'] as const).map((value) => ({ label: translatePriority(value, language), value }))} onChange={(value) => setGoalForm({ ...goalForm, priority: value as SaveGoalInput['priority'] })} />
            <TextAreaField label={text.goals.notes} value={goalForm.notes} onChange={(value) => setGoalForm({ ...goalForm, notes: value })} />
            <button className="primary-button" onClick={() => void handleGoalSubmit()} disabled={actionsDisabled || Boolean(goalErrors.name || goalErrors.targetAmount)}>
              <Plus size={16} />
              {goalForm.id ? text.common.edit : text.goals.saveAction}
            </button>
            {goalForm.id ? <button className="ghost-button" onClick={resetGoalForm}>{text.common.cancel}</button> : null}
          </div>
        </SectionCard>

        <SectionCard title={text.goals.insightsTitle} subtitle={text.goals.insightsSubtitle}>
          <div className="goal-insights">
            {snapshot.analytics.goalInsights.map((goal) => (
              <div key={goal.goalId} className="goal-insight-card">
                <strong>{goal.name}</strong>
                <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.min(goal.completionPercent, 100)}%` }} /></div>
                <p>{text.goals.current}: {fmtMoney(goal.currentAmount)}</p>
                <p>{text.goals.requiredMonthlyContribution}: {fmtMoney(goal.monthlyRequiredContribution)}</p>
                <p>{text.goals.requiredWeeklyContribution}: {fmtMoney(goal.weeklyRequiredContribution)}</p>
                <p>{text.goals.goalStatus}: {text.goals.statuses[goal.status]}</p>
                <p>{text.goals.estimatedCompletion}: {goal.estimatedCompletionDate}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard title={text.goals.addContribution} subtitle={text.goals.contributionHistory}>
        <div className="form-grid">
          <SelectField label={text.goals.name} value={goalContributionForm.goalId} options={snapshot.goals.map((goal) => ({ label: goal.name, value: goal.id }))} onChange={(value) => setGoalContributionForm({ ...goalContributionForm, goalId: value })} />
          <SelectField
            label={text.expenses.category}
            value={goalContributionForm.categoryId ?? 'savings'}
            options={snapshot.categories.map((entry) => ({ label: translateCategoryName(entry, language), value: entry.id }))}
            onChange={(value) => setGoalContributionForm({ ...goalContributionForm, categoryId: value })}
          />
          <InputField label={text.goals.contributionAmount} type="number" value={goalContributionForm.amount} onChange={(value) => setGoalContributionForm({ ...goalContributionForm, amount: parseDecimalInput(value) })} />
          <InputField label={text.goals.contributionDate} type="date" value={goalContributionForm.date} onChange={(value) => setGoalContributionForm({ ...goalContributionForm, date: value })} />
          <SelectField
            label={text.expenses.paymentMethod}
            value={goalContributionForm.paymentMethod ?? 'transfer'}
            options={(['card', 'bank', 'cash', 'wallet', 'transfer'] as const).map((value) => ({ label: translatePaymentMethod(value, language), value }))}
            onChange={(value) => setGoalContributionForm({ ...goalContributionForm, paymentMethod: value as SaveGoalContributionInput['paymentMethod'] })}
          />
          <TextAreaField label={text.goals.contributionNotes} value={goalContributionForm.notes} onChange={(value) => setGoalContributionForm({ ...goalContributionForm, notes: value })} />
          <button className="primary-button" onClick={() => void handleGoalContributionSubmit()} disabled={actionsDisabled || !goalContributionForm.goalId || goalContributionForm.amount <= 0}>
            <Plus size={16} />
            {text.goals.addContribution}
          </button>
        </div>
      </SectionCard>

      <SectionCard title={text.goals.currentGoalsTitle} subtitle={text.goals.currentGoalsSubtitle}>
        <div className="goal-grid">
          {snapshot.goals.map((goal) => {
            const insight = snapshot.analytics.goalInsights.find((entry) => entry.goalId === goal.id)
            const contributions = snapshot.goalContributions.filter((entry) => entry.goalId === goal.id)
            return (
              <div key={goal.id} className="goal-card">
                <div className="goal-card-header">
                  <div><h3>{goal.name}</h3><p>{translateGoalType(goal.type, language)}</p></div>
                  <Badge label={translatePriority(goal.priority, language)} />
                </div>
                <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.min(insight?.completionPercent ?? 0, 100)}%` }} /></div>
                <div className="goal-metrics">
                  <MetricLine label={text.goals.openingAmount} value={fmtMoney(goal.currentAmount)} />
                  <MetricLine label={text.goals.current} value={fmtMoney(insight?.currentAmount ?? goal.currentAmount)} />
                  <MetricLine label={text.goals.target} value={fmtMoney(goal.targetAmount)} />
                  <MetricLine label={text.goals.remaining} value={fmtMoney(insight?.remainingAmount ?? goal.targetAmount - goal.currentAmount)} />
                  <MetricLine label={text.goals.requiredMonthlyContribution} value={fmtMoney(insight?.monthlyRequiredContribution ?? 0)} />
                  <MetricLine label={text.goals.requiredWeeklyContribution} value={fmtMoney(insight?.weeklyRequiredContribution ?? 0)} />
                  <MetricLine label={text.goals.goalStatus} value={insight ? text.goals.statuses[insight.status] : text.goals.statuses['on-track']} />
                </div>
                <div className="timeline-list">
                  {contributions.slice(0, 3).map((entry) => (
                    <div key={entry.id} className="timeline-item">
                      <strong>{fmtMoney(entry.amount)}</strong>
                      <span>{entry.date}</span>
                      <small>{entry.notes || text.goals.addContribution}</small>
                    </div>
                  ))}
                </div>
                <div className="toolbar">
                  <button className="ghost-button" onClick={() => beginEditGoal(goal)}><Pencil size={14} />{text.common.edit}</button>
                  <button className="ghost-button" onClick={() => void performAction(text.goals.deleteAction, () => bridge.deleteGoal(goal.id))}>{text.goals.deleteAction}</button>
                </div>
              </div>
            )
          })}
        </div>
      </SectionCard>
    </div>
  )

  const renderDebts = () => (
    <div className="screen-grid">
      <div className="two-column-grid">
        <SectionCard title={text.debts.title} subtitle={text.debts.subtitle}>
          <div className="form-grid">
            <InputField label={text.debts.name} value={debtForm.name} onChange={(value) => setDebtForm({ ...debtForm, name: value })} error={debtErrors.name} />
            <InputField label={text.debts.totalAmount} type="number" value={debtForm.totalAmount} onChange={(value) => setDebtForm({ ...debtForm, totalAmount: parseDecimalInput(value) })} error={debtErrors.totalAmount} />
            <InputField label={text.debts.installmentAmount} type="number" value={debtForm.installmentAmount} onChange={(value) => setDebtForm({ ...debtForm, installmentAmount: parseDecimalInput(value) })} />
            <InputField label={text.debts.startDate} type="date" value={debtForm.startDate} onChange={(value) => setDebtForm({ ...debtForm, startDate: value })} />
            <InputField label={text.debts.endDate} type="date" value={debtForm.endDate ?? ''} onChange={(value) => setDebtForm({ ...debtForm, endDate: value || null })} />
            <InputField label={text.debts.desiredPayoffDate} type="date" value={debtForm.desiredPayoffDate ?? ''} onChange={(value) => setDebtForm({ ...debtForm, desiredPayoffDate: value || null })} />
            <SelectField
              label={text.debts.paymentFrequency}
              value={debtForm.paymentFrequency}
              options={[
                { label: text.debts.monthly, value: 'monthly' },
                { label: text.debts.weekly, value: 'weekly' }
              ]}
              onChange={(value) => setDebtForm({ ...debtForm, paymentFrequency: value as SaveDebtInput['paymentFrequency'] })}
            />
            <SelectField
              label={text.expenses.category}
              value={debtForm.categoryId}
              options={snapshot.categories.map((entry) => ({ label: translateCategoryName(entry, language), value: entry.id }))}
              onChange={(value) => setDebtForm({ ...debtForm, categoryId: value })}
            />
            <ToggleField label={text.debts.recurringAutomatically} checked={debtForm.recurringAutomatically} onChange={(checked) => setDebtForm({ ...debtForm, recurringAutomatically: checked })} />
            <TextAreaField label={text.debts.notes} value={debtForm.notes} onChange={(value) => setDebtForm({ ...debtForm, notes: value })} />
            <button className="primary-button" onClick={() => void handleDebtSubmit()} disabled={actionsDisabled || Boolean(debtErrors.name || debtErrors.totalAmount)}>
              <Plus size={16} />
              {debtForm.id ? text.common.edit : text.debts.saveAction}
            </button>
            {debtForm.id ? <button className="ghost-button" onClick={resetDebtForm}>{text.common.cancel}</button> : null}
          </div>
        </SectionCard>

        <SectionCard title={text.debts.summaryTitle} subtitle={text.debts.summarySubtitle}>
          <div className="forecast-list">
            <MetricLine label={text.debts.activeDebts} value={String(snapshot.analytics.debtInsights.filter((entry) => entry.status === 'active').length)} />
            <MetricLine label={text.debts.completedDebts} value={String(snapshot.analytics.debtInsights.filter((entry) => entry.status === 'completed').length)} />
            <MetricLine
              label={text.debts.remainingBalance}
              value={fmtMoney(snapshot.analytics.debtInsights.filter((entry) => entry.status === 'active').reduce((sum, entry) => sum + entry.remainingBalance, 0))}
            />
            <MetricLine
              label={text.debts.nextPayment}
              value={snapshot.analytics.debtInsights.find((entry) => entry.status === 'active')?.nextPaymentDate ?? text.common.no}
            />
          </div>
        </SectionCard>
      </div>

      <SectionCard title={text.debts.activeDebtsTitle} subtitle={text.debts.activeDebtsSubtitle}>
        <div className="goal-grid">
          {snapshot.analytics.debtInsights.map((debt) => (
            <div key={debt.debtId} className="goal-card">
              <div className="goal-card-header">
                <div><h3>{debt.name}</h3><p>{debt.status === 'completed' ? text.debts.completed : text.debts.active}</p></div>
                <Badge label={debt.status === 'completed' ? text.debts.completed : text.debts.active} />
              </div>
              <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.min(debt.progressPercent, 100)}%` }} /></div>
              <div className="goal-metrics">
                <MetricLine label={text.debts.totalAmount} value={fmtMoney(debt.totalAmount)} />
                <MetricLine label={text.debts.paidSoFar} value={fmtMoney(debt.paidSoFar)} />
                <MetricLine label={text.debts.remainingBalance} value={fmtMoney(debt.remainingBalance)} />
                <MetricLine label={text.debts.installmentsRemaining} value={String(debt.installmentsRemaining)} />
                <MetricLine label={text.debts.installmentAmount} value={fmtMoney(debt.installmentAmount)} />
                <MetricLine label={text.debts.requiredInstallment} value={fmtMoney(debt.requiredInstallmentAmount)} />
                <MetricLine label={text.debts.payoffDate} value={debt.payoffDate ?? text.common.no} />
                <MetricLine label={text.debts.nextPayment} value={debt.nextPaymentDate ?? text.common.no} />
                <MetricLine label={text.debts.progress} value={`${debt.progressPercent.toFixed(1)}%`} />
              </div>
              <p>{debt.isInstallmentEnough ? text.debts.onTrack : text.debts.needsHigherInstallment}</p>
              <div className="toolbar">
                <button className="ghost-button" onClick={() => {
                  const debtRecord = snapshot.debts.find((entry) => entry.id === debt.debtId)
                  if (debtRecord) beginEditDebt(debtRecord)
                }}><Pencil size={14} />{text.common.edit}</button>
                <button className="ghost-button" onClick={() => void performAction(text.common.delete, () => bridge.deleteDebt(debt.debtId))}>{text.common.delete}</button>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  )

  const renderSettings = () => (
    <div className="screen-grid">
      <div className="two-column-grid">
        <SectionCard title={text.settings.appTitle} subtitle={text.settings.appSubtitle}>
          <div className="form-grid">
            <SelectField label={text.settings.language} value={settings.language} options={[{ label: text.settings.languageArabic, value: 'ar' }, { label: text.settings.languageEnglish, value: 'en' }]} onChange={(value) => void updateSettings(applyLanguageToSettings(settings, value as Settings['language']))} />
            <SelectField label={text.settings.currency} value={settings.currency} options={currencyOptions.map((value) => ({ label: value, value }))} onChange={(value) => void updateSettings({ ...settings, currency: value.toUpperCase() })} />
            <SelectField label={text.settings.theme} value={settings.theme} options={[{ label: text.themes.dark, value: 'dark' }, { label: text.themes.light, value: 'light' }]} onChange={(value) => void updateSettings({ ...settings, theme: value as Settings['theme'] })} />
            <InputField label={text.settings.financialMonthStart} type="number" value={settings.financialMonthStartDay} onChange={(value) => void updateSettings({ ...settings, financialMonthStartDay: Number(value) })} />
            <ToggleField label={text.settings.smartNotifications} checked={settings.notificationsEnabled} onChange={(checked) => void updateSettings({ ...settings, notificationsEnabled: checked })} />
            <ToggleField
              label={text.settings.includeGoalsInForecast}
              checked={settings.includeOptionalGoalsInForecast}
              onChange={(checked) => void updateSettings({ ...settings, includeOptionalGoalsInForecast: checked })}
            />
          </div>
        </SectionCard>

        <SectionCard
          title={text.settings.syncTitle}
          subtitle={text.settings.syncSubtitle}
          action={syncStatus ? <Badge label={syncConnectionLabel} color={syncStatus.backendReachable ? '#10b981' : '#f59e0b'} /> : undefined}
        >
          <div className="forecast-list">
            <MetricLine label={text.settings.syncStatus} value={syncPhaseLabel} />
            <MetricLine label={text.settings.syncConnection} value={syncConnectionLabel} />
            <MetricLine label={text.settings.syncLastSync} value={syncStatus?.lastSyncAt ? new Date(syncStatus.lastSyncAt).toLocaleString(settings.locale) : text.settings.syncNever} />
            <MetricLine label={text.settings.syncPendingChanges} value={String(syncStatus?.pendingChanges ?? 0)} />
            <MetricLine label={text.settings.syncBackendUrl} value={syncStatus?.backendUrl ?? text.settings.syncNotConfigured} />
            <MetricLine label={text.settings.syncDevice} value={syncStatus?.deviceId ?? text.settings.syncNotAvailable} />
            <MetricLine label={text.settings.syncAuthMode} value={syncStatus?.authMode === 'password' ? text.settings.authPassword : syncStatus?.authMode === 'dev-session' ? text.settings.authDevSession : text.settings.syncNotAvailable} />
            <MetricLine label={text.settings.syncAccount} value={syncStatus?.accountEmail ?? text.settings.syncNotAvailable} />
            {syncStatus?.lastError ? <MetricLine label={text.settings.syncError} value={syncStatus.lastError} /> : null}
          </div>
          <div className="toolbar wrap">
            <button className="primary-button" onClick={() => void runManualSync()} disabled={actionsDisabled || !syncStatus?.enabled || syncStatus.paused}>
              <RefreshCw size={16} />
              {text.settings.syncNow}
            </button>
            <button className="secondary-button" onClick={() => void refreshSyncStatus()} disabled={actionsDisabled}>
              {text.settings.refreshSyncStatus}
            </button>
          </div>
          <ToggleField label={text.settings.pauseSyncToggle} checked={Boolean(syncStatus?.paused)} onChange={(checked) => void updateSyncPaused(checked)} />
          <p className="section-note">
            {syncStatus?.enabled ? text.settings.syncLocalFirstNote : text.settings.syncDisabledNote}
          </p>
        </SectionCard>

        <SectionCard title={text.settings.categoryTitle} subtitle={text.settings.categorySubtitle}>
          <div className="form-grid">
            <InputField label={text.settings.categoryName} value={categoryForm.name} onChange={(value) => setCategoryForm({ ...categoryForm, name: value })} />
            <SelectField
              label={text.settings.categoryType}
              value={categoryForm.type}
              options={(['custom', 'essential', 'lifestyle', 'saving', 'debt'] as const).map((value) => ({ label: translateCategoryType(value, language), value }))}
              onChange={(value) => setCategoryForm({ ...categoryForm, type: value as Category['type'] })}
            />
            <InputField label={text.settings.color} value={categoryForm.color} onChange={(value) => setCategoryForm({ ...categoryForm, color: value })} hint={text.settings.colorHint} />
            <SelectField label={text.settings.icon} value={categoryForm.icon} options={iconOptions.map((value) => ({ label: value, value }))} onChange={(value) => setCategoryForm({ ...categoryForm, icon: value })} />
            <InputField label={text.settings.monthlyLimit} type="number" value={categoryForm.monthlyLimit ?? 0} onChange={(value) => setCategoryForm({ ...categoryForm, monthlyLimit: parseDecimalInput(value) })} />
            <button className="primary-button" onClick={() => void handleCategorySubmit()} disabled={actionsDisabled || !categoryForm.name.trim()}>
              <Plus size={16} />
              {editingCategoryId ? text.settings.updateCategory : text.settings.saveCategory}
            </button>
            {editingCategoryId ? <button className="ghost-button" onClick={() => { setEditingCategoryId(null); setCategoryForm(createCategoryForm()) }}>{text.common.cancel}</button> : null}
          </div>
        </SectionCard>
      </div>

      <div className="two-column-grid">
        <SectionCard title={text.settings.dataToolsTitle} subtitle={text.settings.dataToolsSubtitle}>
          <div className="toolbar wrap">
            <button className="primary-button" onClick={() => void performAction(text.settings.loadDemo, () => bridge.seedDemoData())}><RefreshCw size={16} />{text.settings.loadDemo}</button>
            <button className="secondary-button" onClick={() => void performAction(text.settings.importCsv, () => bridge.importData('csv'))}>{text.settings.importCsv}</button>
            <button className="secondary-button" onClick={() => void performAction(text.settings.importExcel, () => bridge.importData('xlsx'))}>{text.settings.importExcel}</button>
            <button className="ghost-button" onClick={() => setResetDialogOpen(true)}>{text.settings.reset}</button>
          </div>
        </SectionCard>

        <SectionCard title={text.settings.currentCategoriesTitle} subtitle={text.settings.currentCategoriesSubtitle}>
          <div className="category-grid">
            {snapshot.categories.map((category) => (
              <div key={category.id} className="category-tile">
                <span className="color-dot" style={{ backgroundColor: category.color }} />
                <div>
                  <strong>{translateCategoryName(category, language)}</strong>
                  <p>{category.monthlyLimit ? fmtMoney(category.monthlyLimit) : text.common.noLimit}</p>
                  <small>{translateCategoryType(category.type, language)} · {category.builtIn ? text.common.builtIn : text.common.custom}</small>
                </div>
                <div className="toolbar">
                  <button className="ghost-button" onClick={() => beginEditCategory(category)}><Pencil size={14} />{text.common.edit}</button>
                  <button className="ghost-button" onClick={() => void openCategoryDeletionDialog(category)}>{text.common.delete}</button>
                </div>
              </div>
            ))}
          </div>
          <p className="section-note">{text.settings.editBuiltInHint}</p>
        </SectionCard>
      </div>
    </div>
  )

  const contentByTab: Record<TabKey, ReactNode> = {
    dashboard: (
      <Suspense fallback={<ScreenSkeleton />}>
        <DashboardScreen
          snapshot={snapshot}
          fmtMoney={fmtMoney}
          actionsDisabled={actionsDisabled}
          performAction={performAction}
          setActiveTab={(tab) => setActiveTab(tab)}
          budgetMethodLabels={budgetMethodLabels}
          language={language}
          text={text}
        />
      </Suspense>
    ),
    income: renderIncome(),
    expenses: renderExpenses(),
    budget: renderBudget(),
    reports: (
      <Suspense fallback={<ScreenSkeleton />}>
        <ReportsScreen
          snapshot={snapshot}
          fmtMoney={fmtMoney}
          actionsDisabled={actionsDisabled}
          performAction={performAction}
          filteredExpenses={filteredExpenses}
          expensePeriodLabel={expensePeriodLabel}
          expensePeriodTotal={expensePeriodTotal}
          expensePeriodAverageDaily={expensePeriodAverageDaily}
          expensePeriodChart={expensePeriodChart}
          language={language}
          text={text}
          onExport={(format) => void bridge.exportData(format)}
          onImport={(format) => void performAction(format, () => bridge.importData(format))}
          onMonthlyClose={(month) => void performAction(text.reports.monthlyCloseTitle, () => bridge.runMonthlyClose(month))}
        />
      </Suspense>
    ),
    goals: renderGoals(),
    debts: renderDebts(),
    settings: renderSettings()
  }

  return (
    <div className={`app-shell theme-${settings.theme}`} dir={settings.rtl ? 'rtl' : 'ltr'}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">MW</div>
          <div>
            <h1>{text.appName}</h1>
            <p>{text.appTagline}</p>
          </div>
        </div>

        <nav className="nav-list">
          {nav.map((item) => {
            const Icon = item.icon
            return (
              <button key={item.key} className={`nav-item ${activeTab === item.key ? 'active' : ''}`} onClick={() => setActiveTab(item.key)}>
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="footer-card">
            <span>{text.budget.healthScore}</span>
            <strong>{dashboard.budgetHealthScore.toFixed(0)} / 100</strong>
            <small>
              {dashboard.riskLevel === 'low'
                ? text.topbar.stablePlan
                : dashboard.riskLevel === 'moderate'
                  ? text.topbar.reviewPlan
                  : text.topbar.interventionPlan}
            </small>
          </div>
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <span className="eyebrow">{text.topbar.month} {dashboard.month}</span>
            <h2>{nav.find((item) => item.key === activeTab)?.label}</h2>
          </div>
          <div className="topbar-actions">
            {busyLabel ? <span className="status-chip busy">{busyLabel}</span> : null}
            {statusMessage ? <span className="status-chip">{statusMessage}</span> : null}
            {actionError ? <span className="status-chip error">{actionError}</span> : null}
            {syncStatus ? <span className={`status-chip ${syncStatus.phase === 'error' ? 'error' : syncStatus.phase === 'syncing' ? 'busy' : ''}`}>{syncTopbarLabel}</span> : null}
            <span className="status-chip">{settings.currency}</span>
            <span className="status-chip">{translateRiskLevel(dashboard.riskLevel, language)}</span>
          </div>
        </header>

        {contentByTab[activeTab]}
      </main>

      {pendingGoalLinkExpense ? (
        <div className="dialog-overlay">
          <div className="dialog-card">
            <h3>{text.expenses.goalLinkDecisionTitle}</h3>
            <p>{text.expenses.goalLinkDecisionDescription}</p>
            <div className="form-grid compact">
              <SelectField label={text.expenses.goalLink} value={goalLinkPromptGoalId} options={snapshot.goals.map((goal) => ({ label: goal.name, value: goal.id }))} onChange={setGoalLinkPromptGoalId} />
            </div>
            <div className="toolbar">
              <button className="primary-button" onClick={() => void confirmGoalExpenseLink('convert')} disabled={!goalLinkPromptGoalId}>
                {text.expenses.convertToSavingAndLink}
              </button>
              <button className="secondary-button" onClick={() => void confirmGoalExpenseLink('keep')} disabled={!goalLinkPromptGoalId}>
                {text.expenses.keepCategoryAndLink}
              </button>
              <button className="ghost-button" onClick={() => setPendingGoalLinkExpense(null)}>
                {text.common.cancel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {categoryDeletionImpact ? (
        <div className="dialog-overlay">
          <div className="dialog-card">
            <h3>{text.settings.deleteDialogTitle}</h3>
            <p>{text.settings.deleteDialogDescription}</p>
            <div className="forecast-list">
              <MetricLine label={text.settings.linkedExpenses} value={String(categoryDeletionImpact.expenseCount)} />
              <MetricLine label={text.settings.linkedBudgets} value={String(categoryDeletionImpact.budgetRuleCount)} />
              <MetricLine label={text.settings.linkedRecurring} value={String(categoryDeletionImpact.recurringCount)} />
              <MetricLine label={text.settings.affectedAmount} value={fmtMoney(categoryDeletionImpact.affectedReportAmount)} />
            </div>
            <div className="form-grid compact">
              <SelectField
                label={text.common.actions}
                value={categoryDeletionMode}
                options={[
                  { label: text.settings.fallbackData, value: 'fallback' },
                  { label: text.settings.reassignData, value: 'reassign' }
                ]}
                onChange={(value) => setCategoryDeletionMode(value as DeleteCategoryInput['mode'])}
              />
              {categoryDeletionMode === 'reassign' ? (
                <SelectField
                  label={text.settings.targetCategory}
                  value={categoryDeletionTargetId}
                  options={categoryDeletionImpact.availableTargetCategories.map((entry) => ({
                    label: translateCategoryName(snapshot.categories.find((category) => category.id === entry.id) ?? { id: entry.id, name: entry.name, builtIn: entry.builtIn, type: 'custom', color: '#64748b', icon: 'folder', monthlyLimit: null }, language),
                    value: entry.id
                  }))}
                  onChange={setCategoryDeletionTargetId}
                />
              ) : null}
            </div>
            <div className="toolbar">
              <button className="primary-button" onClick={() => void confirmCategoryDeletion()} disabled={categoryDeletionMode === 'reassign' && !categoryDeletionTargetId}>
                {text.settings.confirmDeleteCategory}
              </button>
              <button className="ghost-button" onClick={() => setCategoryDeletionImpact(null)}>
                {text.common.cancel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {resetDialogOpen ? (
        <div className="dialog-overlay">
          <div className="dialog-card">
            <h3>{text.settings.resetDialogTitle}</h3>
            <p>{text.settings.resetDialogDescription}</p>
            <div className="toolbar">
              <button className="primary-button" onClick={() => void confirmResetData()}>
                {text.settings.confirmReset}
              </button>
              <button className="ghost-button" onClick={() => setResetDialogOpen(false)}>
                {text.common.cancel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
