import React, { useEffect, useMemo, useRef, useState } from 'react'
import { StatusBar, StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { AppShell, PRIMARY_TABS, SECONDARY_TABS, type AppTab, type AppTabId } from './src/components/AppShell'
import { Card, Skeleton } from './src/components/ui'
import { MoreScreen } from './src/screens/MoreScreen'
import { describeSyncError, describeSyncPhase } from './src/services/userMessages'
import { palette, spacing } from './src/theme/tokens'
import { BudgetScreen } from './src/screens/BudgetScreen'
import { DashboardScreen } from './src/screens/DashboardScreen'
import { DebtsScreen } from './src/screens/DebtsScreen'
import { ExpensesScreen } from './src/screens/ExpensesScreen'
import { GoalsScreen } from './src/screens/GoalsScreen'
import { IncomeScreen } from './src/screens/IncomeScreen'
import { SettingsScreen } from './src/screens/SettingsScreen'
import { computeDashboardAnalytics } from './src/models/analytics'
import { createDefaultFinanceState, createEmptySyncState } from './src/models/defaults'
import type {
  DebtRecord,
  ExpenseRecord,
  FinanceState,
  Goal,
  IncomeRecord,
  SyncState
} from './src/models/types'
import { getMobileSyncConfig } from './src/services/config'
import { upsertDebt, upsertExpense, upsertGoal, upsertIncome, deleteEntity, ensureSeedState, updateSettings } from './src/services/repository'
import { MobileSyncService } from './src/services/sync'
import { clearMobileCredentials, initializeMobileStorage, loadAccountProfile, resetMobileStorage, saveFinanceState, saveSyncState, setActiveMobileProfile } from './src/services/storage'

type SyncStatus = {
  phase: 'disabled' | 'idle' | 'syncing' | 'error'
  message: string
}

export default function App(): React.JSX.Element {
  const syncConfig = useMemo(() => getMobileSyncConfig(), [])
  const [financeState, setFinanceState] = useState<FinanceState>(() => createDefaultFinanceState())
  const [syncState, setSyncState] = useState<SyncState>(() => createEmptySyncState())
  const [activeTab, setActiveTab] = useState<AppTabId>('dashboard')
  const [isReady, setIsReady] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    phase: syncConfig.enabled ? 'idle' : 'disabled',
    message: syncConfig.enabled ? 'Ready to sync' : 'Sync disabled'
  })

  const financeRef = useRef(financeState)
  const syncRef = useRef(syncState)
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const syncInFlightRef = useRef(false)
  const syncPromiseRef = useRef<Promise<void> | null>(null)
  const accountGenerationRef = useRef(0)

  financeRef.current = financeState
  syncRef.current = syncState

  const analytics = useMemo(() => computeDashboardAnalytics(financeState), [financeState])
  const tabs: AppTab[] = useMemo(
    () =>
      financeState.settings.language === 'ar'
        ? [
            { id: 'dashboard', label: 'الرئيسية' },
            { id: 'expenses', label: 'المصروفات' },
            { id: 'income', label: 'الدخل' },
            { id: 'budget', label: 'الميزانية' },
            { id: 'goals', label: 'الأهداف' },
            { id: 'debts', label: 'الديون' },
            { id: 'settings', label: 'الإعدادات' },
            { id: 'more', label: 'المزيد' }
          ]
        : [
            { id: 'dashboard', label: 'Dashboard' },
            { id: 'expenses', label: 'Expenses' },
            { id: 'income', label: 'Income' },
            { id: 'budget', label: 'Budget' },
            { id: 'goals', label: 'Goals' },
            { id: 'debts', label: 'Debts' },
            { id: 'settings', label: 'Settings' },
            { id: 'more', label: 'More' }
          ],
    [financeState.settings.language]
  )
  const syncService = useMemo(() => new MobileSyncService(syncConfig), [syncConfig])
  const pendingChanges = useMemo(() => syncService.getPendingChangeCount(financeState, syncState), [financeState, syncService, syncState])

  useEffect(() => {
    let cancelled = false

    async function bootstrap(): Promise<void> {
      const stored = await initializeMobileStorage()
      if (cancelled) {
        return
      }
      setFinanceState(ensureSeedState(stored.financeState ?? createDefaultFinanceState()))
      setSyncState({
        ...createEmptySyncState(),
        ...(stored.syncState ?? {})
      })
      setIsReady(true)
    }

    void bootstrap()

    return () => {
      cancelled = true
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!isReady) {
      return
    }
    if (syncState.userId) void saveFinanceState(financeState, syncState.userId)
  }, [financeState, isReady, syncState.userId])

  useEffect(() => {
    if (!isReady) {
      return
    }
    if (syncState.userId) void saveSyncState(syncState, syncState.userId)
  }, [syncState, isReady])

  useEffect(() => {
    if (!isReady || !syncConfig.enabled) {
      return
    }
    void runSync('startup')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, syncConfig.enabled])

  useEffect(() => {
    if (!isReady || !syncConfig.enabled || syncState.paused) {
      return
    }
    const timer = setInterval(() => {
      void runSync('poll')
    }, 7000)
    return () => clearInterval(timer)
  }, [isReady, syncConfig.enabled, syncState.paused])

  async function runSync(reason: string): Promise<void> {
    if (!syncConfig.enabled) {
      setSyncStatus({ phase: 'disabled', message: 'Sync disabled' })
      return
    }
    if (syncInFlightRef.current) {
      return
    }

    syncInFlightRef.current = true
    const generation = accountGenerationRef.current

    setSyncStatus({ phase: 'syncing', message: `Syncing ${reason}...` })

    const operation = (async () => {
      const result = await syncService.syncFinanceState(financeRef.current, syncRef.current)
      if (generation !== accountGenerationRef.current) return
      if (result.financeState !== financeRef.current) {
        setFinanceState(result.financeState)
      }
      setSyncState(result.syncState)
      setSyncStatus(result.status)
    })()
    syncPromiseRef.current = operation
    try {
      await operation
    } finally {
      if (syncPromiseRef.current === operation) syncPromiseRef.current = null
      syncInFlightRef.current = false
    }
  }

  async function beginAccountTransition(): Promise<void> {
    accountGenerationRef.current += 1
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current)
      syncTimeoutRef.current = null
    }
    await syncPromiseRef.current?.catch(() => undefined)
  }

  async function activateAccount(authenticated: SyncState): Promise<void> {
    if (!authenticated.userId) throw new Error('Authenticated session is missing a user identity.')
    const profile = await loadAccountProfile(authenticated.userId)
    const nextFinance = ensureSeedState(profile.financeState ?? createDefaultFinanceState())
    const nextSync: SyncState = {
      ...createEmptySyncState(),
      ...(profile.syncState ?? {}),
      deviceId: authenticated.deviceId,
      authToken: authenticated.authToken,
      refreshToken: authenticated.refreshToken,
      accessTokenExpiresAt: authenticated.accessTokenExpiresAt,
      userId: authenticated.userId,
      accountEmail: authenticated.accountEmail,
      authMode: authenticated.authMode,
      paused: false,
      lastError: null
    }
    await Promise.all([
      saveFinanceState(nextFinance, authenticated.userId),
      saveSyncState(nextSync, authenticated.userId),
      setActiveMobileProfile(authenticated.userId)
    ])
    setFinanceState(nextFinance)
    setSyncState(nextSync)
  }

  function queueSync(reason: string): void {
    if (!syncConfig.enabled || syncRef.current.paused) {
      return
    }
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current)
    }
    syncTimeoutRef.current = setTimeout(() => {
      syncTimeoutRef.current = null
      void runSync(reason)
    }, 900)
  }

  function updateFinanceState(mutator: (current: FinanceState) => FinanceState, syncReason: string): void {
    setFinanceState((current) => {
      const next = ensureSeedState(mutator(current))
      return next
    })
    queueSync(syncReason)
  }

  function handleSaveIncome(input: Partial<IncomeRecord>): void {
    updateFinanceState((current) => upsertIncome(current, input), 'income-save')
  }

  function handleSaveExpense(input: Partial<ExpenseRecord>): void {
    updateFinanceState((current) => upsertExpense(current, input), 'expense-save')
  }

  function handleSaveGoal(input: Partial<Goal>): void {
    updateFinanceState((current) => upsertGoal(current, input), 'goal-save')
  }

  function handleSaveDebt(input: Partial<DebtRecord>): void {
    updateFinanceState((current) => upsertDebt(current, input), 'debt-save')
  }

  function handleDelete(entityType: 'income' | 'expense' | 'goal' | 'debt', id: string): void {
    updateFinanceState((current) => deleteEntity(current, entityType, id), `${entityType}-delete`)
  }

  function handleUpdateSettings(patch: Partial<FinanceState['settings']>): void {
    updateFinanceState((current) => updateSettings(current, patch), 'settings-save')
  }

  function handleToggleSyncPaused(paused: boolean): void {
    setSyncState((current) => ({
      ...current,
      paused,
      lastError: paused ? null : current.lastError
    }))
    if (!paused && syncConfig.enabled) {
      void runSync('resume')
    } else if (paused) {
      setSyncStatus({ phase: 'idle', message: 'Sync paused on this device' })
    }
  }

  async function handleLogin(email: string, password: string): Promise<void> {
    setSyncStatus({ phase: 'syncing', message: 'Signing in...' })
    try {
      await beginAccountTransition()
      const next = await syncService.login(syncRef.current, email, password)
      await activateAccount(next)
      setSyncStatus({ phase: 'idle', message: 'Signed in' })
    } catch (error) {
      setSyncStatus({ phase: 'error', message: error instanceof Error ? error.message : 'Sign in failed' })
      throw error
    }
  }

  async function handleRegister(email: string, password: string): Promise<void> {
    setSyncStatus({ phase: 'syncing', message: 'Creating account...' })
    try {
      await beginAccountTransition()
      const next = await syncService.register(syncRef.current, email, password)
      await activateAccount(next)
      setSyncStatus({ phase: 'idle', message: 'Account created' })
    } catch (error) {
      setSyncStatus({ phase: 'error', message: error instanceof Error ? error.message : 'Registration failed' })
      throw error
    }
  }

  async function handleLogout(): Promise<void> {
    await beginAccountTransition()
    const userId = syncRef.current.userId
    if (userId) {
      await Promise.all([
        saveFinanceState(financeRef.current, userId),
        saveSyncState(syncRef.current, userId)
      ])
    }
    await Promise.all([clearMobileCredentials(userId ?? undefined), setActiveMobileProfile(null)])
    const next = await syncService.logout(syncRef.current)
    await clearMobileCredentials(userId ?? undefined)
    setSyncState(next)
    setFinanceState(createDefaultFinanceState())
    setSyncStatus({ phase: 'idle', message: 'Signed out' })
  }

  function handleResetLocalData(): void {
    const nextFinanceState = createDefaultFinanceState()
    const nextSyncState = createEmptySyncState()
    setFinanceState(nextFinanceState)
    setSyncState(nextSyncState)
    setSyncStatus({
      phase: syncConfig.enabled ? 'idle' : 'disabled',
      message: syncConfig.enabled ? 'Local data reset. Sync to restore remote records if needed.' : 'Local data reset'
    })
    void resetMobileStorage(syncState.userId ?? undefined)
  }

  // The header shows sanitised copy: syncStatus.message can carry backend text
  // and HTTP codes, which stay in state for diagnostics but never reach the UI.
  const headerSubtitle = !syncConfig.enabled
    ? 'Local-first mode'
    : syncStatus.phase === 'error'
      ? (describeSyncError(syncStatus.message)?.title ?? 'Sync did not finish')
      : syncStatus.phase === 'syncing'
        ? 'Syncing your data'
        : syncState.accountEmail ?? 'Signed out'

  const syncBadgeLabel = describeSyncPhase(syncStatus.phase, syncState.paused)
  const isProfileEmpty =
    financeState.incomes.length === 0 &&
    financeState.expenses.length === 0 &&
    financeState.goals.length === 0 &&
    financeState.debts.length === 0

  if (!isReady) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <StatusBar barStyle="light-content" />
          <View style={styles.loadingHeader}>
            <Skeleton height={26} width="58%" />
            <Skeleton height={13} width="38%" />
          </View>
          <View style={styles.loadingBody}>
            <Card>
              <Skeleton height={12} width="32%" />
              <Skeleton height={38} width="70%" />
              <Skeleton height={12} width="86%" />
            </Card>
            <View style={styles.loadingRow}>
              <Card style={styles.loadingCell}>
                <Skeleton height={12} width="52%" />
                <Skeleton height={22} width="76%" />
              </Card>
              <Card style={styles.loadingCell}>
                <Skeleton height={12} width="52%" />
                <Skeleton height={22} width="76%" />
              </Card>
            </View>
            <Card>
              <Skeleton height={14} width="44%" />
              <Skeleton height={8} />
              <Skeleton height={8} width="80%" />
            </Card>
          </View>
          <Text accessibilityRole="progressbar" accessibilityLabel="Loading your MoneyWise data" style={styles.loadingCaption}>
            Preparing your encrypted data…
          </Text>
        </SafeAreaView>
      </SafeAreaProvider>
    )
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" />
      <AppShell
        title="MoneyWise"
        subtitle={headerSubtitle}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onSync={() => void runSync('manual')}
        syncEnabled={syncConfig.enabled}
        syncPhase={syncStatus.phase}
        syncLabel={syncBadgeLabel}
      >
        {activeTab === 'dashboard' ? (
          <DashboardScreen
            analytics={analytics}
            currency={financeState.settings.currency}
            locale={financeState.settings.locale}
            isEmpty={isProfileEmpty}
            onOpenExpenses={() => setActiveTab('expenses')}
            onOpenIncome={() => setActiveTab('income')}
            onOpenBudget={() => setActiveTab('budget')}
          />
        ) : null}
        {activeTab === 'more' ? (
          <MoreScreen
            onNavigate={setActiveTab}
            accountEmail={syncState.accountEmail}
            syncSummary={syncBadgeLabel}
            pendingChanges={pendingChanges}
          />
        ) : null}
        {activeTab === 'expenses' ? (
          <ExpensesScreen
            records={financeState.expenses}
            categories={financeState.categories}
            debts={financeState.debts}
            currency={financeState.settings.currency}
            locale={financeState.settings.locale}
            language={financeState.settings.language}
            onSave={handleSaveExpense}
            onDelete={(id) => handleDelete('expense', id)}
          />
        ) : null}
        {activeTab === 'income' ? (
          <IncomeScreen
            records={financeState.incomes}
            currency={financeState.settings.currency}
            locale={financeState.settings.locale}
            onSave={handleSaveIncome}
            onDelete={(id) => handleDelete('income', id)}
          />
        ) : null}
        {activeTab === 'budget' ? <BudgetScreen state={financeState} onUpdateSettings={handleUpdateSettings} /> : null}
        {activeTab === 'goals' ? (
          <GoalsScreen
            records={financeState.goals}
            currency={financeState.settings.currency}
            locale={financeState.settings.locale}
            onSave={handleSaveGoal}
            onDelete={(id) => handleDelete('goal', id)}
            onOpenDebts={() => setActiveTab('debts')}
          />
        ) : null}
        {activeTab === 'debts' ? (
          <DebtsScreen
            records={financeState.debts}
            expenses={financeState.expenses}
            currency={financeState.settings.currency}
            onSave={handleSaveDebt}
            onDelete={(id) => handleDelete('debt', id)}
          />
        ) : null}
        {activeTab === 'settings' ? (
          <SettingsScreen
            settings={financeState.settings}
            syncEnabled={syncConfig.enabled}
            backendUrl={syncConfig.backendUrl}
            syncState={syncState}
            syncPhase={syncStatus.phase}
            pendingChanges={pendingChanges}
            onSyncNow={() => void runSync('manual')}
            onTogglePaused={handleToggleSyncPaused}
            onLogin={handleLogin}
            onRegister={handleRegister}
            onLogout={handleLogout}
            onUpdateSettings={handleUpdateSettings}
            onResetData={handleResetLocalData}
            onOpenDebts={() => setActiveTab('debts')}
          />
        ) : null}
      </AppShell>
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.canvas
  },
  loadingHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.sm
  },
  loadingBody: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md
  },
  loadingRow: {
    flexDirection: 'row',
    gap: spacing.md
  },
  loadingCell: {
    flex: 1
  },
  loadingCaption: {
    marginTop: spacing.xl,
    textAlign: 'center',
    color: palette.textMuted,
    fontSize: 13
  }
})
