import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDefaultFinanceState, createEmptySyncState } from '../mobile/src/models/defaults'
import type { FinanceState, SyncState } from '../mobile/src/models/types'
import { MobileSyncService } from '../mobile/src/services/sync'
import { buildSyncableStateIndex as buildMobileIndex } from '../mobile/src/services/repository'
import { defaultSettings } from '../src/shared/defaults'
import type { FinanceDomainState } from '../src/shared/domain'
import { MAX_MONEY_MINOR_UNITS } from '../src/shared/money'
import { syncPayloadSchemas } from '../src/shared/validation'
import { buildSyncableStateIndex as buildDesktopIndex, type SyncEntityType } from '../src/main/sync-types'

const require = createRequire(import.meta.url)
const { createBackend } = require('../backend/index.cjs') as { createBackend: (config: Record<string, unknown>) => Promise<any> }
const enabled = process.env.RUN_CROSS_PLATFORM_TURSO === '1'
const remoteDescribe = enabled ? describe : describe.skip

type Session = { accessToken: string; refreshToken: string; user: { id: string; email: string }; session: { expiresAt: string } }
type RemoteRecord = {
  entityType: SyncEntityType
  recordId: string
  payload: Record<string, unknown>
  version: number
  revision?: number
  deletedAt: string | null
}

remoteDescribe('real Turso desktop/mobile compatibility', () => {
  let backend: any
  let baseUrl = ''

  async function json(path: string, init: RequestInit = {}, token?: string): Promise<{ status: number; body: any }> {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) }
    })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }

  async function push(token: string, deviceId: string, requestId: string, changes: Array<Record<string, unknown>>) {
    const result = await json('/api/sync/push', { method: 'POST', body: JSON.stringify({ deviceId, requestId, changes }) }, token)
    expect(result.status).toBe(200)
    return result.body
  }

  function desktopState(): FinanceDomainState {
    return {
      incomes: [1, 10, 30, 1234, MAX_MONEY_MINOR_UNITS].map((amount, index) => ({
        id: `desktop-income-${index}`,
        name: `Desktop income ${amount}`,
        groupName: 'Primary',
        amount,
        date: '2026-08-15',
        type: 'fixed' as const,
        recurring: false,
        notes: ''
      })),
      expenses: [
        {
          id: 'desktop-expense',
          title: 'Desktop expense',
          amount: 1234,
          date: '2026-08-15',
          categoryId: 'misc',
          paymentMethod: 'card',
          type: 'variable',
          recurring: false,
          notes: '',
          tags: [],
          goalId: null,
          debtId: null,
          allocationKind: 'spend'
        }
      ],
      categories: [{ id: 'misc', name: 'Misc', type: 'custom', color: '#64748b', icon: 'circle', monthlyLimit: 9999, builtIn: false }],
      goals: [
        {
          id: 'desktop-goal',
          name: 'Goal',
          type: 'general',
          targetAmount: 9999,
          currentAmount: 30,
          targetDate: '2027-08-15',
          priority: 'medium',
          notes: ''
        }
      ],
      goalContributions: [],
      debts: [
        {
          id: 'desktop-debt',
          name: 'Debt',
          totalAmount: 123400,
          installmentAmount: 1000,
          startDate: '2026-08-15',
          endDate: null,
          desiredPayoffDate: null,
          paymentFrequency: 'monthly',
          recurringAutomatically: true,
          categoryId: 'misc',
          notes: ''
        }
      ],
      budgetPlans: [
        {
          id: 'desktop-budget',
          month: '2026-08',
          method: 'zero-based',
          customSavingsTarget: 3000,
          customEmergencyTarget: 1000,
          debtAcceleration: 100,
          notes: '',
          rules: [{ categoryId: 'misc', percentage: 10, priorityWeight: 1, lockedAmount: 100 }]
        }
      ],
      recurringTransactions: [],
      alerts: [],
      activityLog: [],
      settings: { ...defaultSettings, currency: 'EUR', locale: 'de-DE' },
      monthlySummaries: [{ month: '2026-08', income: 10000, expenses: 3000, savings: 7000, debtPayments: 1000, closingBalance: 7000 }]
    }
  }

  function desktopChanges(state: FinanceDomainState) {
    return [...buildDesktopIndex(state).records.values()].map((record) => ({
      entityType: record.entityType,
      recordId: record.recordId,
      payload: record.payload,
      deletedAt: null
    }))
  }

  beforeAll(async () => {
    expect(process.env.TURSO_DATABASE_URL).toMatch(/^libsql:\/\//)
    expect(process.env.TURSO_AUTH_TOKEN).toBeTruthy()
    backend = await createBackend({
      nodeEnv: 'test',
      databaseProvider: 'turso',
      tursoDatabaseUrl: process.env.TURSO_DATABASE_URL,
      tursoAuthToken: process.env.TURSO_AUTH_TOKEN,
      host: '127.0.0.1',
      port: 0,
      authMode: 'password-only',
      authSecret: 'cross-platform-disposable-auth-secret-2026',
      sessionTtlDays: 1,
      accessTokenTtlMinutes: 15,
      logLevel: 'silent',
      tlsTerminated: false,
      trustedProxies: []
    })
    await new Promise<void>((resolve) => backend.server.listen(0, '127.0.0.1', resolve))
    const address = backend.server.address()
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  }, 60_000)

  afterAll(async () => {
    if (backend?.server) await new Promise<void>((resolve) => backend.server.close(() => resolve()))
    if (backend?.database) await backend.database.close()
  })

  it('preserves the v2 contract bidirectionally across edits, tombstones, retries, auth, and accounts', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const emailA = `cross-a-${suffix}@example.invalid`
    const emailB = `cross-b-${suffix}@example.invalid`
    const password = 'Disposable-cross-platform-2026!'
    const registrationA = await json('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: emailA, password, deviceId: 'desktop-a' })
    })
    const registrationB = await json('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: emailB, password, deviceId: 'desktop-b' })
    })
    expect(registrationA.status).toBe(201)
    expect(registrationB.status).toBe(201)
    const desktopA = registrationA.body as Session
    const desktopB = registrationB.body as Session

    await push(desktopA.accessToken, 'desktop-a', `desktop-seed-${suffix}`, desktopChanges(desktopState()))

    const mobile = new MobileSyncService({ enabled: true, backendUrl: baseUrl, deviceId: 'mobile-a' })
    let mobileSync = await mobile.login(createEmptySyncState(), emailA, password)
    let mobileFinance = createDefaultFinanceState()
    ;({ financeState: mobileFinance, syncState: mobileSync } = await mobile.syncFinanceState(mobileFinance, mobileSync))
    expect(mobileFinance.incomes.map((record) => record.amount).sort((a, b) => a - b)).toEqual([1, 10, 30, 1234, MAX_MONEY_MINOR_UNITS])
    expect(mobileFinance.settings).toMatchObject({ currency: 'EUR', locale: 'de-DE' })
    expect(mobileFinance.expenses.find((record) => record.id === 'desktop-expense')?.amount).toBe(1234)
    expect(mobileFinance.goals.find((record) => record.id === 'desktop-goal')?.targetAmount).toBe(9999)
    expect(mobileFinance.debts.find((record) => record.id === 'desktop-debt')?.totalAmount).toBe(123400)
    expect(mobileFinance.budgetPlans.some((record) => record.id === 'desktop-budget')).toBe(true)

    mobileFinance = {
      ...mobileFinance,
      incomes: [
        {
          id: 'mobile-income',
          name: 'Mobile income',
          groupName: 'Primary',
          amount: 30,
          date: '2026-08-15',
          type: 'variable',
          recurring: false,
          notes: ''
        },
        ...mobileFinance.incomes
      ],
      expenses: mobileFinance.expenses.map((record) =>
        record.id === 'desktop-expense' ? { ...record, amount: 10, title: 'Mobile edit' } : record
      )
    }
    ;({ financeState: mobileFinance, syncState: mobileSync } = await mobile.syncFinanceState(mobileFinance, mobileSync))
    const bootstrapA = await json('/api/sync/bootstrap', {}, desktopA.accessToken)
    expect(bootstrapA.status).toBe(200)
    const remoteRecords = Object.entries(bootstrapA.body.records).flatMap(([entityType, records]) =>
      (records as any[]).map((record) => ({ ...record, entityType }))
    ) as any[]
    for (const record of remoteRecords) {
      if (!record.deletedAt) syncPayloadSchemas[record.entityType as SyncEntityType].parse(record.payload)
    }
    expect(remoteRecords.find((record) => record.id === 'mobile-income').payload.amount).toBe(30)
    expect(remoteRecords.find((record) => record.id === 'desktop-expense').payload).toMatchObject({ amount: 10, title: 'Mobile edit' })

    const expenseRemote = remoteRecords.find((record) => record.id === 'desktop-expense')
    await push(desktopA.accessToken, 'desktop-a', `desktop-alternate-${suffix}`, [
      {
        entityType: 'expense',
        recordId: 'desktop-expense',
        baseVersion: expenseRemote.version,
        payload: { ...expenseRemote.payload, moneyVersion: 2, amount: 1, title: 'Desktop final edit' },
        deletedAt: null
      }
    ])
    ;({ financeState: mobileFinance, syncState: mobileSync } = await mobile.syncFinanceState(mobileFinance, mobileSync))
    expect(mobileFinance.expenses.find((record) => record.id === 'desktop-expense')).toMatchObject({
      amount: 1,
      title: 'Desktop final edit'
    })

    mobileFinance = {
      ...mobileFinance,
      incomes: [
        {
          id: 'mobile-offline-income',
          name: 'Mobile offline',
          groupName: 'Primary',
          amount: 10,
          date: '2026-08-15',
          type: 'variable',
          recurring: false,
          notes: ''
        },
        ...mobileFinance.incomes
      ]
    }
    await push(desktopA.accessToken, 'desktop-a', `desktop-online-${suffix}`, [
      {
        entityType: 'income',
        recordId: 'desktop-online-income',
        payload: {
          moneyVersion: 2,
          id: 'desktop-online-income',
          name: 'Desktop online',
          groupName: 'Primary',
          amount: 30,
          date: '2026-08-15',
          type: 'variable',
          recurring: false,
          notes: ''
        },
        deletedAt: null
      }
    ])
    ;({ financeState: mobileFinance, syncState: mobileSync } = await mobile.syncFinanceState(mobileFinance, mobileSync))
    expect(mobileFinance.incomes.find((record) => record.id === 'desktop-online-income')?.amount).toBe(30)
    const afterNonConflict = await json('/api/sync/bootstrap', {}, desktopA.accessToken)
    expect(afterNonConflict.body.records.income.find((record: any) => record.id === 'mobile-offline-income').payload.amount).toBe(10)

    const createForMobile = {
      entityType: 'income',
      recordId: 'desktop-delete-me',
      payload: {
        moneyVersion: 2,
        id: 'desktop-delete-me',
        name: 'Delete me',
        groupName: 'Primary',
        amount: 10,
        date: '2026-08-15',
        type: 'fixed',
        recurring: false,
        notes: ''
      },
      deletedAt: null
    }
    const created = await push(desktopA.accessToken, 'desktop-a', `desktop-create-delete-${suffix}`, [createForMobile])
    ;({ financeState: mobileFinance, syncState: mobileSync } = await mobile.syncFinanceState(mobileFinance, mobileSync))
    expect(mobileFinance.incomes.some((record) => record.id === 'desktop-delete-me')).toBe(true)
    mobileFinance = { ...mobileFinance, incomes: mobileFinance.incomes.filter((record) => record.id !== 'desktop-delete-me') }
    ;({ financeState: mobileFinance, syncState: mobileSync } = await mobile.syncFinanceState(mobileFinance, mobileSync))
    const deletedChanges = await json('/api/sync/changes?since=0', {}, desktopA.accessToken)
    expect(deletedChanges.body.changes.find((record: RemoteRecord) => record.recordId === 'desktop-delete-me')).toMatchObject({
      deletedAt: expect.any(String),
      version: created.applied[0].version + 1
    })

    mobileFinance = {
      ...mobileFinance,
      incomes: [
        {
          id: 'mobile-delete-me',
          name: 'Mobile delete target',
          groupName: 'Primary',
          amount: 10,
          date: '2026-08-15',
          type: 'fixed',
          recurring: false,
          notes: ''
        },
        ...mobileFinance.incomes
      ]
    }
    ;({ financeState: mobileFinance, syncState: mobileSync } = await mobile.syncFinanceState(mobileFinance, mobileSync))
    const beforeDesktopDelete = await json('/api/sync/bootstrap', {}, desktopA.accessToken)
    const mobileDeleteRemote = beforeDesktopDelete.body.records.income.find((record: any) => record.id === 'mobile-delete-me')
    await push(desktopA.accessToken, 'desktop-a', `desktop-delete-mobile-${suffix}`, [
      {
        entityType: 'income',
        recordId: 'mobile-delete-me',
        payload: {},
        deletedAt: new Date().toISOString(),
        baseVersion: mobileDeleteRemote.version
      }
    ])
    ;({ financeState: mobileFinance, syncState: mobileSync } = await mobile.syncFinanceState(mobileFinance, mobileSync))
    expect(mobileFinance.incomes.some((record) => record.id === 'mobile-delete-me')).toBe(false)

    mobileFinance = {
      ...mobileFinance,
      incomes: [
        {
          id: 'ambiguous-mobile',
          name: 'Ambiguous',
          groupName: 'Primary',
          amount: 1,
          date: '2026-08-15',
          type: 'fixed',
          recurring: false,
          notes: ''
        },
        ...mobileFinance.incomes
      ]
    }
    const realFetch = globalThis.fetch
    let loseResponse = true
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await realFetch(input, init)
      if (loseResponse && new URL(String(input)).pathname === '/api/sync/push') {
        loseResponse = false
        throw new TypeError('simulated response loss after remote commit')
      }
      return response
    }) as typeof fetch
    const failed = await mobile.syncFinanceState(mobileFinance, mobileSync)
    expect(failed.status.phase).toBe('error')
    expect(failed.syncState.pendingPush).toBeTruthy()
    globalThis.fetch = realFetch
    ;({ financeState: mobileFinance, syncState: mobileSync } = await mobile.syncFinanceState(failed.financeState, failed.syncState))
    expect(mobileSync.pendingPush).toBeNull()
    const afterRetry = await json('/api/sync/bootstrap', {}, desktopA.accessToken)
    const ambiguous = afterRetry.body.records.income.find((record: any) => record.id === 'ambiguous-mobile')
    expect(ambiguous.version).toBe(1)
    expect(ambiguous.payload.amount).toBe(1)

    const expiringState: SyncState = { ...mobileSync, accessTokenExpiresAt: '2000-01-01T00:00:00.000Z' }
    const oldRefresh = expiringState.refreshToken
    const refreshed = await mobile.syncFinanceState(mobileFinance, expiringState)
    expect(refreshed.status.phase).toBe('idle')
    expect(refreshed.syncState.refreshToken).not.toBe(oldRefresh)
    expect(
      (await json('/api/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: oldRefresh, deviceId: 'replay' }) })).status
    ).toBe(401)
    expect((await json('/api/auth/dev-session', { method: 'POST', body: '{}' })).status).toBe(403)

    const mobileB = new MobileSyncService({ enabled: true, backendUrl: baseUrl, deviceId: 'mobile-b' })
    let mobileBSync = await mobileB.login(createEmptySyncState(), emailB, password)
    const mobileBResult = await mobileB.syncFinanceState(createDefaultFinanceState(), mobileBSync)
    mobileBSync = mobileBResult.syncState
    expect(
      [...buildMobileIndex(mobileBResult.financeState).values()].some(
        (record) => record.recordId === 'mobile-income' || record.recordId === 'ambiguous-mobile'
      )
    ).toBe(false)
    expect((await json('/api/sync/bootstrap', {}, desktopB.accessToken)).body.records.income).toBeUndefined()
    expect(mobileBSync.authMode).toBe('password')

    const accessBeforeLogout = refreshed.syncState.authToken
    const loggedOut = await mobile.logout(refreshed.syncState)
    expect(loggedOut).toMatchObject({ authToken: null, refreshToken: null, userId: null, authMode: null })
    expect((await json('/api/auth/session', {}, accessBeforeLogout ?? undefined)).status).toBe(401)
  }, 120_000)
})
