import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FinanceDomainState } from '../shared/domain'
import { defaultSettings } from '../shared/defaults'
import type { DesktopSyncConfig } from './sync-config'
import { DesktopSyncManager } from './desktop-sync'
import { DesktopSyncStateStore } from './desktop-sync-state'
import type { RemoteSyncRecord, SyncEntityType } from './sync-types'

type SyncableCollectionKey =
  | 'incomes'
  | 'expenses'
  | 'categories'
  | 'goals'
  | 'debts'
  | 'budgetPlans'
  | 'monthlySummaries'

interface FetchResponse {
  status?: number
  body?: unknown
}

function createEmptyState(): FinanceDomainState {
  return {
    incomes: [],
    expenses: [],
    categories: [],
    goals: [],
    goalContributions: [],
    debts: [],
    budgetPlans: [],
    recurringTransactions: [],
    alerts: [],
    settings: { ...defaultSettings },
    activityLog: [],
    monthlySummaries: []
  }
}

function cloneState(state: FinanceDomainState): FinanceDomainState {
  return JSON.parse(JSON.stringify(state)) as FinanceDomainState
}

function collectionKey(entityType: SyncEntityType): SyncableCollectionKey | null {
  switch (entityType) {
    case 'income':
      return 'incomes'
    case 'expense':
      return 'expenses'
    case 'category':
      return 'categories'
    case 'goal':
      return 'goals'
    case 'debt':
      return 'debts'
    case 'budget':
      return 'budgetPlans'
    case 'monthly-summary':
      return 'monthlySummaries'
    default:
      return null
  }
}

class FakeFinanceDatabase {
  private activeProfile = 'test-user'
  private readonly profiles = new Map<string, FinanceDomainState>()

  constructor(
    state: FinanceDomainState,
    private readonly transformers: Partial<Record<SyncEntityType, (payload: Record<string, unknown>) => Record<string, unknown>>> = {}
  ) {
    this.profiles.set(this.activeProfile, state)
  }

  private get state(): FinanceDomainState {
    const state = this.profiles.get(this.activeProfile)
    if (!state) throw new Error(`Missing fake profile ${this.activeProfile}`)
    return state
  }

  switchAccountProfile(userId: string | null): void {
    this.activeProfile = userId ?? 'local-only'
    if (!this.profiles.has(this.activeProfile)) this.profiles.set(this.activeProfile, createEmptyState())
  }

  getDomainState(): FinanceDomainState {
    return cloneState(this.state)
  }

  applyRemoteSyncChanges(changes: RemoteSyncRecord[]): void {
    changes.forEach((change) => {
      if (change.entityType === 'settings') {
        this.state.settings = change.deletedAt
          ? { ...defaultSettings }
          : ({ ...this.state.settings, ...this.transformPayload(change.entityType, change.payload) } as FinanceDomainState['settings'])
        return
      }

      const key = collectionKey(change.entityType)
      if (!key) {
        return
      }
      const collection = this.state[key] as unknown as Array<Record<string, unknown>>
      const index = collection.findIndex((entry) => {
        const entryId = change.entityType === 'monthly-summary' ? entry.month : entry.id
        return entryId === change.recordId
      })
      if (change.deletedAt) {
        if (index >= 0) {
          collection.splice(index, 1)
        }
        return
      }

      const payload = this.transformPayload(change.entityType, change.payload)
      const normalizedRecord =
        change.entityType === 'monthly-summary'
          ? ({ month: change.recordId, ...payload } as Record<string, unknown>)
          : ({ id: change.recordId, ...payload } as Record<string, unknown>)

      if (index >= 0) {
        collection[index] = normalizedRecord
      } else {
        collection.push(normalizedRecord)
      }
    })
  }

  private transformPayload(entityType: SyncEntityType, payload: Record<string, unknown>): Record<string, unknown> {
    return this.transformers[entityType]?.(payload) ?? payload
  }
}

function createConfig(): DesktopSyncConfig {
  return {
    enabled: true,
    backendUrl: 'http://127.0.0.1:8787',
    deviceId: 'desktop-test'
  }
}

function createStateStore() {
  const dir = mkdtempSync(join(tmpdir(), 'moneywise-sync-test-'))
  const store = new DesktopSyncStateStore(join(dir, 'sync-state.json'), {
    encrypt: (value) => Buffer.from(value, 'utf8').toString('base64'),
    decrypt: (value) => Buffer.from(value, 'base64').toString('utf8')
  })
  store.write({
    deviceId: 'desktop-test',
    authToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
    userId: 'test-user',
    accountEmail: 'desktop-test@example.com',
    authMode: 'password',
    cursor: null,
    bootstrapCompleted: false,
    paused: false,
    lastSyncAt: null,
    lastError: null,
    manifest: {}
  })
  return {
    dir,
    store
  }
}

function createFetchMock(handler: (url: string, init?: RequestInit) => FetchResponse | Promise<FetchResponse>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const result = await handler(url, init)
    return {
      ok: (result.status ?? 200) >= 200 && (result.status ?? 200) < 300,
      status: result.status ?? 200,
      text: async () => JSON.stringify(result.body ?? {})
    } as Response
  })
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  }
  const objectValue = value as Record<string, unknown>
  return `{${Object.keys(objectValue)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`)
    .join(',')}}`
}

function hashPayload(payload: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex')
}

async function runSync(manager: DesktopSyncManager): Promise<void> {
  await (manager as unknown as { runSync: (reason: string) => Promise<void> }).runSync('test')
}

const cleanupDirs: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  delete (globalThis as Record<string, unknown>).fetch
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

describe('DesktopSyncManager', () => {
  it('does not persist access or refresh tokens in plaintext', () => {
    const { dir, store } = createStateStore()
    cleanupDirs.push(dir)
    const persisted = readFileSync(join(dir, 'sync-state.json'), 'utf8')
    expect(persisted).not.toContain('test-access-token')
    expect(persisted).not.toContain('test-refresh-token')
    expect(store.read().authToken).toBe('test-access-token')
  })

  it('does not upload the previous account local records after switching accounts', async () => {
    const state = createEmptyState()
    state.incomes.push({
      id: 'user-a-private-income',
      name: 'User A private salary',
      groupName: 'Primary',
      amount: 5000,
      date: '2026-08-01',
      type: 'fixed',
      recurring: false,
      notes: ''
    })
    const database = new FakeFinanceDatabase(state)
    const { dir, store } = createStateStore()
    cleanupDirs.push(dir)
    const pushedRecordIds: string[] = []

    globalThis.fetch = createFetchMock((url, init) => {
      if (url.endsWith('/api/auth/login')) {
        const credentials = JSON.parse(String(init?.body)) as { email: string }
        const isUserA = credentials.email === 'user-a@example.com'
        return {
          body: {
            authMode: 'password',
            accessToken: isUserA ? 'user-a-access' : 'user-b-access',
            refreshToken: isUserA ? 'user-a-refresh' : 'user-b-refresh',
            session: { expiresAt: '2099-01-01T00:00:00.000Z' },
            user: { id: isUserA ? 'test-user' : 'user-b', email: credentials.email }
          }
        }
      }
      if (url.endsWith('/health')) return { body: { ok: true } }
      if (url.endsWith('/api/sync/bootstrap')) return { body: { order: [], cursor: '0', records: {} } }
      if (url.includes('/api/sync/changes')) return { body: { cursor: '0', changes: [], hasMore: false } }
      if (url.endsWith('/api/sync/push')) {
        const body = JSON.parse(String(init?.body)) as { changes: Array<{ recordId: string }> }
        pushedRecordIds.push(...body.changes.map((change) => change.recordId))
        return {
          body: {
            applied: body.changes.map((change) => ({
              entityType: 'income', recordId: change.recordId, version: 1,
              updatedAt: '2026-08-10T00:00:00.000Z', deletedAt: null
            })),
            conflicts: []
          }
        }
      }
      throw new Error(`Unhandled URL: ${url}`)
    }) as typeof fetch

    const manager = new DesktopSyncManager(database as never, store, createConfig(), () => undefined)
    await manager.login('user-b@example.com', 'user-b-password')
    await runSync(manager)

    expect(pushedRecordIds).not.toContain('user-a-private-income')
    expect(database.getDomainState().incomes).toHaveLength(0)

    await manager.login('user-a@example.com', 'user-a-password')
    expect(database.getDomainState().incomes.map((record) => record.id)).toContain('user-a-private-income')
  })

  it('bootstraps remote data into an empty local state without creating false pending changes after normalization', async () => {
    const database = new FakeFinanceDatabase(createEmptyState(), {
      settings: (payload) => ({
        ...payload,
        locale: payload.locale ?? 'ar',
        rtl: payload.rtl ?? true
      })
    })
    const { dir, store } = createStateStore()
    cleanupDirs.push(dir)
    const manager = new DesktopSyncManager(database as never, store, createConfig(), () => undefined)

    globalThis.fetch = createFetchMock((url) => {
      if (url.endsWith('/health')) return { body: { ok: true } }
      if (url.endsWith('/api/auth/dev-session')) {
        return { body: { authMode: 'dev-session', token: 'token-1', user: { id: 'user-1', email: 'user-1@example.com' } } }
      }
      if (url.includes('/api/sync/bootstrap')) {
        return {
          body: {
            order: ['settings'],
            cursor: '1',
            records: {
              settings: [
                {
                  id: 'settings',
                  payload: { ...defaultSettings, language: 'ar', currency: 'EUR', locale: 'ar', rtl: true },
                  createdAt: '2026-04-01T00:00:00.000Z',
                  updatedAt: '2026-04-01T00:00:00.000Z',
                  deletedAt: null,
                  version: 3,
                  lastModifiedByDeviceId: 'remote'
                }
              ]
            }
          }
        }
      }
      if (url.includes('/api/sync/changes')) {
        return { body: { cursor: '1', changes: [] } }
      }
      if (url.endsWith('/api/sync/push')) {
        return { body: { applied: [], conflicts: [] } }
      }
      throw new Error(`Unhandled URL: ${url}`)
    }) as typeof fetch

    await runSync(manager)

    const savedState = store.read()
    expect(database.getDomainState().settings.language).toBe('ar')
    expect(savedState.cursor).toBe('1')
    expect(savedState.bootstrapCompleted).toBe(true)
    expect((manager as unknown as { collectPendingLocalChanges: (state: FinanceDomainState, manifest: Record<string, unknown>) => unknown[] }).collectPendingLocalChanges(
      database.getDomainState(),
      savedState.manifest
    )).toHaveLength(0)
  })

  it('pushes local records once without replaying duplicates after restart', async () => {
    const state = createEmptyState()
    state.incomes.push({
      id: 'income-local-1',
      name: 'Salary',
      groupName: 'Primary',
      amount: 1200,
      date: '2026-04-01',
      type: 'fixed',
      recurring: false,
      notes: ''
    })
    const database = new FakeFinanceDatabase(state)
    const { dir, store } = createStateStore()
    cleanupDirs.push(dir)

    const requests: Array<{ url: string; body: unknown }> = []
    globalThis.fetch = createFetchMock(async (url, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      requests.push({ url, body })
      if (url.endsWith('/health')) return { body: { ok: true } }
      if (url.endsWith('/api/auth/dev-session')) return { body: { authMode: 'dev-session', token: 'token-2', user: { id: 'user-2', email: 'user-2@example.com' } } }
      if (url.includes('/api/sync/bootstrap')) return { body: { order: [], cursor: '0', records: {} } }
      if (url.includes('/api/sync/changes')) {
        const since = new URL(url).searchParams.get('since') ?? '0'
        return { body: { cursor: since, changes: [] } }
      }
      if (url.endsWith('/api/sync/push')) {
        const changes = (body?.changes as Array<{ entityType: SyncEntityType; recordId: string; deletedAt: string | null }> | undefined) ?? []
        return {
          body: {
            applied: changes.map((change, index) => ({
              entityType: change.entityType,
              recordId: change.recordId,
              version: index + 1,
              updatedAt: '2026-04-02T10:00:00.000Z',
              deletedAt: change.deletedAt
            })),
            conflicts: []
          }
        }
      }
      throw new Error(`Unhandled URL: ${url}`)
    }) as typeof fetch

    const manager = new DesktopSyncManager(database as never, store, createConfig(), () => undefined)
    await runSync(manager)

    expect(requests.filter((entry) => entry.url.endsWith('/api/sync/push'))).toHaveLength(1)
    expect(store.read().cursor).toBe('0')

    requests.length = 0
    const restartedManager = new DesktopSyncManager(database as never, store, createConfig(), () => undefined)
    await runSync(restartedManager)

    expect(requests.filter((entry) => entry.url.endsWith('/api/sync/push'))).toHaveLength(0)
  })

  it('pulls remote updates and applies remote deletes to local state', async () => {
    const state = createEmptyState()
    state.incomes.push({
      id: 'income-existing',
      name: 'Salary',
      groupName: 'Primary',
      amount: 800,
      date: '2026-04-01',
      type: 'fixed',
      recurring: false,
      notes: ''
    })
    state.expenses.push({
      id: 'expense-delete',
      title: 'Fuel',
      amount: 50,
      date: '2026-04-01',
      categoryId: 'transportation',
      paymentMethod: 'card',
      type: 'variable',
      recurring: false,
      notes: '',
      tags: [],
      goalId: null,
      debtId: null,
      allocationKind: 'spend'
    })
    const database = new FakeFinanceDatabase(state)
    const { dir, store } = createStateStore()
    cleanupDirs.push(dir)
    store.write({
      deviceId: 'desktop-test',
      authToken: 'token-3',
      refreshToken: 'refresh-3',
      accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
      userId: 'user-3',
      accountEmail: 'user-3@example.com',
      authMode: 'password',
      cursor: '2026-04-01T00:00:00.000Z',
      bootstrapCompleted: true,
      paused: false,
      lastSyncAt: null,
      lastError: null,
      manifest: {
        'income:income-existing': {
          entityType: 'income',
          recordId: 'income-existing',
          lastSyncedHash: await hashPayload(state.incomes[0] as unknown as Record<string, unknown>),
          remoteVersion: 1,
          updatedAt: '2026-04-01T00:00:00.000Z',
          deletedAt: null
        },
        'expense:expense-delete': {
          entityType: 'expense',
          recordId: 'expense-delete',
          lastSyncedHash: await hashPayload(state.expenses[0] as unknown as Record<string, unknown>),
          remoteVersion: 1,
          updatedAt: '2026-04-01T00:00:00.000Z',
          deletedAt: null
        }
      }
    })

    globalThis.fetch = createFetchMock((url) => {
      if (url.endsWith('/health')) return { body: { ok: true } }
      if (url.includes('/api/sync/changes')) {
        return {
          body: {
            cursor: '2026-04-03T00:00:00.000Z',
            changes: [
              {
                entityType: 'income',
                recordId: 'income-existing',
                payload: {
                  id: 'income-existing',
                  name: 'Salary updated',
                  groupName: 'Primary',
                  amount: 950,
                  date: '2026-04-01',
                  type: 'fixed',
                  recurring: false,
                  notes: ''
                },
                createdAt: '2026-04-01T00:00:00.000Z',
                updatedAt: '2026-04-02T00:00:00.000Z',
                deletedAt: null,
                version: 2,
                lastModifiedByDeviceId: 'remote'
              },
              {
                entityType: 'expense',
                recordId: 'expense-delete',
                payload: {},
                createdAt: '2026-04-01T00:00:00.000Z',
                updatedAt: '2026-04-03T00:00:00.000Z',
                deletedAt: '2026-04-03T00:00:00.000Z',
                version: 3,
                lastModifiedByDeviceId: 'remote'
              }
            ]
          }
        }
      }
      if (url.endsWith('/api/sync/push')) return { body: { applied: [], conflicts: [] } }
      throw new Error(`Unhandled URL: ${url}`)
    }) as typeof fetch

    const manager = new DesktopSyncManager(database as never, store, createConfig(), () => undefined)
    await runSync(manager)

    const refreshed = database.getDomainState()
    expect(refreshed.incomes[0]?.name).toBe('Salary updated')
    expect(refreshed.expenses).toHaveLength(0)
    expect(store.read().cursor).toBe('2026-04-03T00:00:00.000Z')
  })

  it('keeps local changes when a conflicting remote update arrives and records the remote version for the next push', async () => {
    const state = createEmptyState()
    state.incomes.push({
      id: 'income-conflict',
      name: 'Local salary',
      groupName: 'Primary',
      amount: 1111,
      date: '2026-04-01',
      type: 'fixed',
      recurring: false,
      notes: ''
    })
    const database = new FakeFinanceDatabase(state)
    const { dir, store } = createStateStore()
    cleanupDirs.push(dir)
    store.write({
      deviceId: 'desktop-test',
      authToken: 'token-4',
      refreshToken: 'refresh-4',
      accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
      userId: 'user-4',
      accountEmail: 'user-4@example.com',
      authMode: 'password',
      cursor: '2026-04-01T00:00:00.000Z',
      bootstrapCompleted: true,
      paused: false,
      lastSyncAt: null,
      lastError: null,
      manifest: {
        'income:income-conflict': {
          entityType: 'income',
          recordId: 'income-conflict',
          lastSyncedHash: 'old-synced-hash',
          remoteVersion: 1,
          updatedAt: '2026-04-01T00:00:00.000Z',
          deletedAt: null
        }
      }
    })

    const pushedBodies: unknown[] = []
    globalThis.fetch = createFetchMock((url, init) => {
      if (url.endsWith('/health')) return { body: { ok: true } }
      if (url.includes('/api/sync/changes')) {
        return {
          body: {
            cursor: '2026-04-04T00:00:00.000Z',
            changes: [
              {
                entityType: 'income',
                recordId: 'income-conflict',
                payload: {
                  id: 'income-conflict',
                  name: 'Remote salary',
                  groupName: 'Primary',
                  amount: 999,
                  date: '2026-04-01',
                  type: 'fixed',
                  recurring: false,
                  notes: ''
                },
                createdAt: '2026-04-01T00:00:00.000Z',
                updatedAt: '2026-04-04T00:00:00.000Z',
                deletedAt: null,
                version: 2,
                lastModifiedByDeviceId: 'remote'
              }
            ]
          }
        }
      }
      if (url.endsWith('/api/sync/push')) {
        const body = init?.body ? JSON.parse(String(init.body)) : null
        pushedBodies.push(body)
        return {
          body: {
            applied: [
              {
                entityType: 'income',
                recordId: 'income-conflict',
                version: 3,
                updatedAt: '2026-04-05T00:00:00.000Z',
                deletedAt: null
              }
            ],
            conflicts: []
          }
        }
      }
      throw new Error(`Unhandled URL: ${url}`)
    }) as typeof fetch

    const manager = new DesktopSyncManager(database as never, store, createConfig(), () => undefined)
    await runSync(manager)

    expect(database.getDomainState().incomes[0]?.name).toBe('Local salary')
    const pushedChange = ((pushedBodies[0] as { changes: Array<{ recordId: string; baseVersion?: number }> }).changes.find(
      (entry) => entry.recordId === 'income-conflict'
    ))
    expect(pushedChange).toBeDefined()
    expect(pushedChange!.baseVersion).toBe(2)
    expect(store.read().manifest['income:income-conflict']?.remoteVersion).toBe(3)
  })

  it('fails safely offline and preserves local state and sync metadata for recovery after restart', async () => {
    const state = createEmptyState()
    state.expenses.push({
      id: 'expense-local',
      title: 'Taxi',
      amount: 25,
      date: '2026-04-01',
      categoryId: 'transportation',
      paymentMethod: 'card',
      type: 'variable',
      recurring: false,
      notes: '',
      tags: [],
      goalId: null,
      debtId: null,
      allocationKind: 'spend'
    })
    const database = new FakeFinanceDatabase(state)
    const { dir, store } = createStateStore()
    cleanupDirs.push(dir)
    const logs: string[] = []

    globalThis.fetch = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED')
    }) as typeof fetch

    const manager = new DesktopSyncManager(database as never, store, createConfig(), (message) => logs.push(message))
    await runSync(manager)

    expect(database.getDomainState().expenses).toHaveLength(1)
    expect(store.read().bootstrapCompleted).toBe(false)
    expect(logs).toContain('Desktop sync skipped')

    globalThis.fetch = createFetchMock((url) => {
      if (url.endsWith('/health')) return { body: { ok: true } }
      if (url.endsWith('/api/auth/dev-session')) return { body: { authMode: 'dev-session', token: 'token-5', user: { id: 'user-5', email: 'user-5@example.com' } } }
      if (url.includes('/api/sync/bootstrap')) return { body: { order: [], cursor: '0', records: {} } }
      if (url.includes('/api/sync/changes')) return { body: { cursor: '0', changes: [] } }
      if (url.endsWith('/api/sync/push')) {
        return {
          body: {
            applied: [
              {
                entityType: 'expense',
                recordId: 'expense-local',
                version: 1,
                updatedAt: '2026-04-06T00:00:00.000Z',
                deletedAt: null
              }
            ],
            conflicts: []
          }
        }
      }
      throw new Error(`Unhandled URL: ${url}`)
    }) as typeof fetch

    const restartedManager = new DesktopSyncManager(database as never, store, createConfig(), () => undefined)
    await runSync(restartedManager)

    expect(store.read().cursor).toBe('0')
    expect(store.read().manifest['expense:expense-local']?.remoteVersion).toBe(1)
  })

  it('uploads all existing local records explicitly and does not re-upload them again after success', async () => {
    const state = createEmptyState()
    state.incomes.push({
      id: 'income-legacy',
      name: 'Legacy salary',
      groupName: 'Primary',
      amount: 2222,
      date: '2026-04-01',
      type: 'fixed',
      recurring: false,
      notes: ''
    })
    state.expenses.push({
      id: 'expense-legacy',
      title: 'Legacy grocery',
      amount: 75,
      date: '2026-04-02',
      categoryId: 'food',
      paymentMethod: 'card',
      type: 'variable',
      recurring: false,
      notes: '',
      tags: [],
      goalId: null,
      debtId: null,
      allocationKind: 'spend'
    })

    const database = new FakeFinanceDatabase(state)
    const { dir, store } = createStateStore()
    cleanupDirs.push(dir)
    store.write({
      deviceId: 'desktop-test',
      authToken: 'token-legacy',
      refreshToken: 'refresh-legacy',
      accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
      userId: 'user-legacy',
      accountEmail: 'legacy@example.com',
      authMode: 'password',
      cursor: '2026-04-01T00:00:00.000Z',
      bootstrapCompleted: true,
      paused: false,
      lastSyncAt: null,
      lastError: null,
      manifest: {
        'income:income-legacy': {
          entityType: 'income',
          recordId: 'income-legacy',
          lastSyncedHash: hashPayload(state.incomes[0] as unknown as Record<string, unknown>),
          remoteVersion: 1,
          updatedAt: '2026-04-01T00:00:00.000Z',
          deletedAt: null
        }
      }
    })

    const remoteRecords = new Map<string, { entityType: SyncEntityType; recordId: string; payload: Record<string, unknown>; version: number; updatedAt: string; deletedAt: string | null }>()
    const pushedBatches: unknown[] = []

    globalThis.fetch = createFetchMock((url, init) => {
      if (url.endsWith('/health')) return { body: { ok: true } }
      if (url.includes('/api/sync/changes')) {
        const since = new URL(url).searchParams.get('since') ?? '1970-01-01T00:00:00.000Z'
        return { body: { cursor: since, changes: [] } }
      }
      if (url.includes('/api/sync/bootstrap')) {
        const records = Array.from(remoteRecords.values()).reduce<Record<string, unknown[]>>((acc, record) => {
          acc[record.entityType] ??= []
          acc[record.entityType].push({
            id: record.recordId,
            payload: record.payload,
            createdAt: record.updatedAt,
            updatedAt: record.updatedAt,
            deletedAt: record.deletedAt,
            version: record.version,
            lastModifiedByDeviceId: 'remote'
          })
          return acc
        }, {})
        return {
          body: {
            order: ['settings', 'category', 'budget', 'goal', 'debt', 'income', 'expense', 'monthly-summary'],
            cursor: remoteRecords.size > 0 ? '2026-04-06T00:00:00.000Z' : '2026-04-01T00:00:00.000Z',
            records
          }
        }
      }
      if (url.endsWith('/api/sync/push')) {
        const body = init?.body ? JSON.parse(String(init.body)) : null
        pushedBatches.push(body)
        const applied = ((body?.changes as Array<{ entityType: SyncEntityType; recordId: string; payload: Record<string, unknown>; deletedAt: string | null }> | undefined) ?? []).map(
          (change, index) => {
            const updatedAt = `2026-04-06T00:00:0${index}.000Z`
            remoteRecords.set(`${change.entityType}:${change.recordId}`, {
              entityType: change.entityType,
              recordId: change.recordId,
              payload: change.payload,
              version: 1,
              updatedAt,
              deletedAt: change.deletedAt
            })
            return {
              entityType: change.entityType,
              recordId: change.recordId,
              version: 1,
              updatedAt,
              deletedAt: change.deletedAt
            }
          }
        )
        return { body: { applied, conflicts: [] } }
      }
      throw new Error(`Unhandled URL: ${url}`)
    }) as typeof fetch

    const manager = new DesktopSyncManager(database as never, store, createConfig(), () => undefined)
    const firstStatus = await manager.uploadAllLocalData()

    expect(firstStatus.pendingChanges).toBe(0)
    expect(pushedBatches).toHaveLength(1)
    expect(((pushedBatches[0] as { changes: Array<{ recordId: string }> }).changes).map((entry) => entry.recordId).sort()).toEqual([
      'expense-legacy',
      'income-legacy',
      'settings'
    ])

    pushedBatches.length = 0
    const secondStatus = await manager.uploadAllLocalData()
    expect(secondStatus.pendingChanges).toBe(0)
    expect(pushedBatches).toHaveLength(0)
  })
})
