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

import { createEmptySyncState } from '../models/defaults'
import { loadSyncState, saveSyncState } from './storage'

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
})
