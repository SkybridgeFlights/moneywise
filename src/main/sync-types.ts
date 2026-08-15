import type { FinanceDomainState } from '@shared/domain'
import type { BudgetPlan, Category, DebtRecord, ExpenseRecord, Goal, IncomeRecord, MonthlySummary, Settings } from '@shared/types'

export type SyncEntityType = 'income' | 'expense' | 'category' | 'budget' | 'goal' | 'debt' | 'settings' | 'monthly-summary'

export interface RemoteSyncRecord {
  entityType: SyncEntityType
  recordId: string
  payload: Record<string, unknown>
  createdAt: string | null
  updatedAt: string
  deletedAt: string | null
  version: number
  lastModifiedByDeviceId: string | null
}

export interface RemoteBootstrapRecord {
  id: string
  payload: Record<string, unknown>
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  version: number
  lastModifiedByDeviceId: string | null
}

export type RemoteBootstrapRecords = Partial<Record<SyncEntityType, RemoteBootstrapRecord[]>>

export interface RemoteBootstrapPayload {
  order: SyncEntityType[]
  cursor: string
  records: RemoteBootstrapRecords
}

export interface RemoteChangesPayload {
  cursor: string
  changes: RemoteSyncRecord[]
  hasMore: boolean
}

export interface PendingSyncChange {
  entityType: SyncEntityType
  recordId: string
  payload: Record<string, unknown>
  deletedAt: string | null
  baseVersion?: number
}

export interface SyncManifestEntry {
  entityType: SyncEntityType
  recordId: string
  lastSyncedHash: string | null
  remoteVersion: number
  updatedAt: string | null
  deletedAt: string | null
}

export interface DesktopSyncStateData {
  deviceId: string | null
  authToken: string | null
  refreshToken: string | null
  accessTokenExpiresAt: string | null
  userId: string | null
  accountEmail: string | null
  authMode: 'password' | null
  cursor: string | null
  bootstrapCompleted: boolean
  paused: boolean
  lastSyncAt: string | null
  lastError: string | null
  pendingPush?: { requestId: string; body: string } | null
  manifest: Record<string, SyncManifestEntry>
}

export interface SyncableLocalRecord {
  entityType: SyncEntityType
  recordId: string
  payload: Record<string, unknown>
}

export interface SyncableStateIndex {
  keyOrder: string[]
  records: Map<string, SyncableLocalRecord>
}

export type SyncablePayload =
  | IncomeRecord
  | ExpenseRecord
  | Category
  | Goal
  | DebtRecord
  | BudgetPlan
  | Settings
  | MonthlySummary

export const SYNC_ENTITY_ORDER: SyncEntityType[] = ['settings', 'category', 'budget', 'goal', 'debt', 'income', 'expense', 'monthly-summary']

export function createSyncRecordKey(entityType: SyncEntityType, recordId: string): string {
  return `${entityType}:${recordId}`
}

export function buildSyncableStateIndex(state: FinanceDomainState): SyncableStateIndex {
  const records = new Map<string, SyncableLocalRecord>()
  const keyOrder: string[] = []

  const pushRecord = (entityType: SyncEntityType, recordId: string, payload: SyncablePayload): void => {
    const key = createSyncRecordKey(entityType, recordId)
    keyOrder.push(key)
    records.set(key, {
      entityType,
      recordId,
      payload: { ...(payload as unknown as Record<string, unknown>), moneyVersion: 2 }
    })
  }

  pushRecord('settings', 'settings', state.settings)
  state.categories.forEach((entry) => pushRecord('category', entry.id, entry))
  state.budgetPlans.forEach((entry) => pushRecord('budget', entry.id, entry))
  state.goals.forEach((entry) => pushRecord('goal', entry.id, entry))
  state.debts.forEach((entry) => pushRecord('debt', entry.id, entry))
  state.incomes.forEach((entry) => pushRecord('income', entry.id, entry))
  state.expenses.forEach((entry) => pushRecord('expense', entry.id, entry))
  state.monthlySummaries.forEach((entry) => pushRecord('monthly-summary', entry.month, entry))

  return { keyOrder, records }
}
