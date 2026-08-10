import { beforeEach, describe, expect, it, vi } from 'vitest'

const asyncValues = new Map<string, string>()
const secureValues = new Map<string, string>()

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => asyncValues.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { asyncValues.set(key, value) })
  }
}))
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: vi.fn(async (key: string) => secureValues.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => { secureValues.set(key, value) }),
  deleteItemAsync: vi.fn(async (key: string) => { secureValues.delete(key) })
}))
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))

import { createDefaultFinanceState, createEmptySyncState } from '../models/defaults'
import { initializeMobileStorage, loadFinanceState, loadSyncState, saveFinanceState, saveSyncState } from './storage'

describe('secure mobile authentication storage', () => {
  beforeEach(() => { asyncValues.clear(); secureValues.clear() })

  it('keeps bearer and refresh tokens out of AsyncStorage', async () => {
    await saveSyncState({ ...createEmptySyncState(), authToken: 'access-secret', refreshToken: 'refresh-secret', userId: 'u1' })
    const persisted = [...asyncValues.values()].join('\n')
    expect(persisted).not.toContain('access-secret')
    expect(persisted).not.toContain('refresh-secret')
    expect([...secureValues.values()]).toEqual(expect.arrayContaining(['access-secret', 'refresh-secret']))
    expect(await loadSyncState()).toMatchObject({ authToken: 'access-secret', refreshToken: 'refresh-secret', userId: 'u1' })
  })

  it('removes secure tokens on logout persistence', async () => {
    await saveSyncState({ ...createEmptySyncState(), authToken: 'access-secret', refreshToken: 'refresh-secret' })
    await saveSyncState(createEmptySyncState())
    expect(secureValues.size).toBe(0)
  })

  it('partitions financial and synchronization state by opaque account profile', async () => {
    const userAState = createDefaultFinanceState()
    userAState.incomes.push({ id: 'user-a-private-income', name: 'A salary', groupName: 'Primary', amount: 1000, date: '2026-08-01', type: 'fixed', recurring: false, notes: '' })
    const userBState = createDefaultFinanceState()
    userBState.incomes.push({ id: 'user-b-private-income', name: 'B salary', groupName: 'Primary', amount: 2000, date: '2026-08-01', type: 'fixed', recurring: false, notes: '' })

    await saveFinanceState(userAState, 'user-a-id')
    await saveFinanceState(userBState, 'user-b-id')
    await saveSyncState({ ...createEmptySyncState(), userId: 'user-a-id', authToken: 'token-a' }, 'user-a-id')
    await saveSyncState({ ...createEmptySyncState(), userId: 'user-b-id', authToken: 'token-b' }, 'user-b-id')

    expect((await loadFinanceState('user-a-id'))?.incomes.map((record) => record.id)).toEqual(['user-a-private-income'])
    expect((await loadFinanceState('user-b-id'))?.incomes.map((record) => record.id)).toEqual(['user-b-private-income'])
    expect((await loadSyncState('user-a-id'))?.authToken).toBe('token-a')
    expect((await loadSyncState('user-b-id'))?.authToken).toBe('token-b')
    expect([...asyncValues.keys()].some((key) => key.includes('user-a-id') || key.includes('user-b-id'))).toBe(false)
  })

  it('quarantines unscoped legacy finance data when ownership is not provable', async () => {
    const legacy = createDefaultFinanceState()
    legacy.incomes.push({ id: 'ambiguous-private-income', name: 'Unknown owner', groupName: 'Primary', amount: 3000, date: '2026-08-01', type: 'fixed', recurring: false, notes: '' })
    asyncValues.set('moneywise.mobile.financeState.v1', JSON.stringify(legacy))
    asyncValues.set('moneywise.mobile.syncState.v1', JSON.stringify(createEmptySyncState()))

    const initialized = await initializeMobileStorage()

    expect(initialized.userId).toBeNull()
    expect(initialized.financeState).toBeNull()
    expect(asyncValues.get('moneywise.mobile.quarantine.finance.v1')).toContain('ambiguous-private-income')
  })
})
