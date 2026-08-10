import React, { useEffect, useMemo, useRef, useState } from 'react'
import { SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native'
import { AppShell, type AppTab } from './src/components/AppShell'
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
import { initializeMobileStorage, loadAccountProfile, resetMobileStorage, saveFinanceState, saveSyncState, setActiveMobileProfile } from './src/services/storage'

type SyncStatus = {
  phase: 'disabled' | 'idle' | 'syncing' | 'error'
  message: string
}

export default function App(): React.JSX.Element {
  const syncConfig = useMemo(() => getMobileSyncConfig(), [])
  const [financeState, setFinanceState] = useState<FinanceState>(() => createDefaultFinanceState())
  const [syncState, setSyncState] = useState<SyncState>(() => createEmptySyncState())
  const [activeTab, setActiveTab] = useState<AppTab['id']>('dashboard')
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
            { id: 'settings', label: 'الإعدادات' }
          ]
        : [
            { id: 'dashboard', label: 'Dashboard' },
            { id: 'expenses', label: 'Expenses' },
            { id: 'income', label: 'Income' },
            { id: 'budget', label: 'Budget' },
            { id: 'goals', label: 'Goals' },
            { id: 'debts', label: 'Debts' },
            { id: 'settings', label: 'Settings' }
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
    if (syncRef.current.userId) {
      await Promise.all([
        saveFinanceState(financeRef.current, syncRef.current.userId),
        saveSyncState(syncRef.current, syncRef.current.userId)
      ])
    }
    const next = await syncService.logout(syncRef.current)
    await setActiveMobileProfile(null)
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

  if (!isReady) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.loadingTitle}>MoneyWise Mobile</Text>
        <Text style={styles.loadingSubtitle}>Loading local data...</Text>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <AppShell
        title="MoneyWise Mobile"
        subtitle={syncConfig.enabled ? syncStatus.message : 'Local-first mode'}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onSync={() => void runSync('manual')}
        syncEnabled={syncConfig.enabled}
        syncPhase={syncStatus.phase}
      >
        {activeTab === 'dashboard' ? (
          <DashboardScreen analytics={analytics} currency={financeState.settings.currency} />
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
            onSave={handleSaveIncome}
            onDelete={(id) => handleDelete('income', id)}
          />
        ) : null}
        {activeTab === 'budget' ? <BudgetScreen state={financeState} onUpdateSettings={handleUpdateSettings} /> : null}
        {activeTab === 'goals' ? (
          <GoalsScreen
            records={financeState.goals}
            currency={financeState.settings.currency}
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
            syncMessage={syncStatus.message}
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
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {syncConfig.enabled
            ? `${pendingChanges} pending change${pendingChanges === 1 ? '' : 's'}`
            : 'Set EXPO_PUBLIC_MONEYWISE_SYNC_ENABLED=true to enable sync.'}
        </Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#081122'
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#081122',
    paddingHorizontal: 24
  },
  loadingTitle: {
    color: '#f8fafc',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8
  },
  loadingSubtitle: {
    color: '#94a3b8',
    fontSize: 15
  },
  footer: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    paddingTop: 6,
    backgroundColor: '#081122'
  },
  footerText: {
    color: '#64748b',
    fontSize: 12,
    textAlign: 'center'
  }
})
