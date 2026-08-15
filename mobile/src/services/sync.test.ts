import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultFinanceState, createEmptySyncState } from '../models/defaults'
import { MobileSyncService } from './sync'

describe('mobile synchronization contract', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('drains every server revision page before completing synchronization', async () => {
    const changeCursors: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input))
      let body: unknown = { ok: true }
      if (url.pathname === '/api/sync/changes') {
        const cursor = url.searchParams.get('since') ?? '0'
        changeCursors.push(cursor)
        body = cursor === '0'
          ? { cursor: '1', changes: [], hasMore: true }
          : { cursor: '2', changes: [], hasMore: false }
      } else if (url.pathname === '/api/sync/push') {
        body = { applied: [], conflicts: [] }
      }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    const service = new MobileSyncService({ enabled: true, backendUrl: 'https://sync.example.test', deviceId: 'device-1' })
    const syncState = {
      ...createEmptySyncState(),
      authToken: 'short-lived-access',
      refreshToken: 'rotating-refresh',
      accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      userId: 'user-1',
      bootstrapCompleted: true,
      cursor: '0'
    }
    const result = await service.syncFinanceState(createDefaultFinanceState(), syncState)
    expect(changeCursors).toEqual(['0', '1'])
    expect(result.syncState.cursor).toBe('2')
    expect(result.status.phase).toBe('idle')
  })

  it('imports desktop settings during first bootstrap without overwriting them with mobile defaults', async () => {
    const pushed: Array<{ changes: Array<{ entityType: string }> }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      const body = path === '/api/sync/bootstrap' ? {
        order: ['settings'], cursor: '1', records: { settings: [{ id: 'settings', payload: { moneyVersion: 2, ...createDefaultFinanceState().settings, currency: 'EUR', locale: 'de-DE' }, createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z', deletedAt: null, version: 1, lastModifiedByDeviceId: 'desktop' }] }
      } : path === '/api/sync/changes' ? { cursor: '1', changes: [], hasMore: false } : path === '/api/sync/push' ? (pushed.push(JSON.parse(String(init?.body))), { applied: [], conflicts: [] }) : { ok: true }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const service = new MobileSyncService({ enabled: true, backendUrl: 'https://sync.example.test', deviceId: 'mobile-settings' })
    const result = await service.syncFinanceState(createDefaultFinanceState(), { ...createEmptySyncState(), authToken: 'access', refreshToken: 'refresh', accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(), userId: 'user-settings' })
    expect(result.financeState.settings).toMatchObject({ currency: 'EUR', locale: 'de-DE' })
    expect(pushed.flatMap((body) => body.changes).some((change) => change.entityType === 'settings')).toBe(false)
  })

  it('fails closed on an unsupported remote money protocol version', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo) => {
      const body = new URL(String(input)).pathname === '/api/sync/bootstrap' ? {
        order: ['income'], cursor: '1', records: { income: [{ id: 'future-income', payload: { moneyVersion: 3, id: 'future-income', name: 'Future', groupName: 'Primary', amount: 1, date: '2026-08-15', type: 'fixed', recurring: false, notes: '' }, createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z', deletedAt: null, version: 1 }] }
      } : { ok: true }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const service = new MobileSyncService({ enabled: true, backendUrl: 'https://sync.example.test', deviceId: 'mobile-version' })
    const result = await service.syncFinanceState(createDefaultFinanceState(), { ...createEmptySyncState(), authToken: 'access', refreshToken: 'refresh', accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(), userId: 'user-version' })
    expect(result.status.phase).toBe('error')
    expect(result.financeState.incomes).toEqual([])
  })

  it('reuses the same request ID after an ambiguous push response loss', async () => {
    const requestIds: string[] = []
    let failFirstPush = true
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      if (path === '/api/sync/changes') return new Response(JSON.stringify({ cursor: '0', changes: [], hasMore: false }), { status: 200 })
      if (path === '/api/sync/push') {
        const request = JSON.parse(String(init?.body)) as { requestId: string; changes: Array<{ entityType: string; recordId: string }> }
        requestIds.push(request.requestId)
        if (failFirstPush) { failFirstPush = false; throw new TypeError('response lost after commit') }
        return new Response(JSON.stringify({ applied: request.changes.map((change) => ({ ...change, version: 1, updatedAt: '2026-08-15T00:00:00.000Z', deletedAt: null })), conflicts: [] }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }))
    const finance = createDefaultFinanceState()
    finance.incomes.push({ id: 'retry-income', name: 'Retry', groupName: 'Primary', amount: 1, date: '2026-08-15', type: 'fixed', recurring: false, notes: '' })
    const service = new MobileSyncService({ enabled: true, backendUrl: 'https://sync.example.test', deviceId: 'mobile-retry' })
    const initial = { ...createEmptySyncState(), authToken: 'access', refreshToken: 'refresh', accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(), userId: 'user-retry', bootstrapCompleted: true, cursor: '0' }
    const first = await service.syncFinanceState(finance, initial)
    expect(first.syncState.pendingPush).toBeTruthy()
    const second = await service.syncFinanceState(finance, first.syncState)
    expect(second.status.phase).toBe('idle')
    expect(requestIds).toHaveLength(2)
    expect(requestIds[1]).toBe(requestIds[0])
    expect(second.syncState.pendingPush).toBeNull()
  })

  it('clears the in-memory session even when server logout is offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    const service = new MobileSyncService({ enabled: true, backendUrl: 'https://sync.example.test', deviceId: 'mobile-logout' })
    const next = await service.logout({
      ...createEmptySyncState(),
      authToken: 'access-secret',
      refreshToken: 'refresh-secret',
      accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      userId: 'user-logout',
      accountEmail: 'logout@example.test',
      authMode: 'password'
    })

    expect(next).toMatchObject({ authToken: null, refreshToken: null, accessTokenExpiresAt: null, userId: null, accountEmail: null, authMode: null })
  })
})
