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
})
