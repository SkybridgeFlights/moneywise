import { beforeEach, describe, expect, it, vi } from 'vitest'

const asyncValues = new Map<string, string>()
const secureValues = new Map<string, string>()
let keyCounter = 0

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => asyncValues.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { asyncValues.set(key, value) }),
    removeItem: vi.fn(async (key: string) => { asyncValues.delete(key) })
  }
}))
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: vi.fn(async (key: string) => secureValues.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => { secureValues.set(key, value) }),
  deleteItemAsync: vi.fn(async (key: string) => { secureValues.delete(key) })
}))
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-crypto', () => {
  class AESEncryptionKey {
    constructor(readonly value: string) {}
    static async generate(): Promise<AESEncryptionKey> { return new AESEncryptionKey(`generated-key-${++keyCounter}`) }
    static async import(value: string): Promise<AESEncryptionKey> {
      if (!value.startsWith('generated-key-')) throw new Error('invalid key')
      return new AESEncryptionKey(value)
    }
    async encoded(): Promise<string> { return this.value }
  }
  class AESSealedData {
    static fromCombined(combined: string): { combined: string } { return { combined } }
  }
  return {
    AESEncryptionKey,
    AESSealedData,
    aesEncryptAsync: vi.fn(async (plaintext: Uint8Array, key: AESEncryptionKey, options: { additionalData: Uint8Array }) => ({
      combined: async () => bytesToBase64(new TextEncoder().encode(JSON.stringify({ key: key.value, aad: [...options.additionalData], plaintext: bytesToBase64(plaintext) })))
    })),
    aesDecryptAsync: vi.fn(async (sealed: { combined: string }, key: AESEncryptionKey, options: { additionalData: Uint8Array }) => {
      const decoded = JSON.parse(new TextDecoder().decode(base64ToBytes(sealed.combined))) as { key: string; aad: number[]; plaintext: string }
      if (decoded.key !== key.value || JSON.stringify(decoded.aad) !== JSON.stringify([...options.additionalData])) throw new Error('authentication failed')
      return base64ToBytes(decoded.plaintext)
    })
  }
})

import { createDefaultFinanceState, createEmptySyncState } from '../models/defaults'
import {
  MobileStorageError,
  clearMobileCredentials,
  configureStorageFailureInjectionForTests,
  initializeMobileStorage,
  loadFinanceState,
  loadSyncState,
  saveFinanceState,
  saveSyncState
} from './storage'

function financeCanary(id: string, amount = 1234) {
  const state = createDefaultFinanceState()
  state.incomes.push({ id, name: `${id}-salary`, groupName: 'Primary', amount, date: '2026-08-01', type: 'fixed', recurring: false, notes: `${id}-notes` })
  return state
}

describe('authenticated encrypted mobile storage', () => {
  beforeEach(() => {
    asyncValues.clear()
    secureValues.clear()
    keyCounter = 0
    configureStorageFailureInjectionForTests(null)
  })

  it('keeps financial canaries, tokens, and encryption keys out of AsyncStorage plaintext', async () => {
    await saveFinanceState(financeCanary('PLAINTEXT-CANARY'), 'user-a')
    await saveSyncState({ ...createEmptySyncState(), userId: 'user-a', accountEmail: 'private@example.test', authToken: 'access-secret', refreshToken: 'refresh-secret', pendingPush: { requestId: 'request-canary', body: '{"amount":1234,"memo":"SYNC-CANARY"}' } }, 'user-a')

    const persisted = [...asyncValues.values()].join('\n')
    expect(persisted).not.toContain('PLAINTEXT-CANARY')
    expect(persisted).not.toContain('SYNC-CANARY')
    expect(persisted).not.toContain('private@example.test')
    expect(persisted).not.toContain('access-secret')
    expect(persisted).not.toContain('refresh-secret')
    expect(persisted).not.toContain('generated-key-')
    expect(persisted).toContain('AES-256-GCM')
    expect(await loadFinanceState('user-a')).toEqual(financeCanary('PLAINTEXT-CANARY'))
  })

  it('removes access and refresh credentials locally without deleting the encrypted profile', async () => {
    await saveFinanceState(financeCanary('retained-profile'), 'user-a')
    await saveSyncState({ ...createEmptySyncState(), userId: 'user-a', authToken: 'access-secret', refreshToken: 'refresh-secret' }, 'user-a')
    await clearMobileCredentials('user-a')

    expect((await loadSyncState('user-a'))).toMatchObject({ authToken: null, refreshToken: null })
    expect((await loadFinanceState('user-a'))?.incomes[0].id).toBe('retained-profile')
  })

  it('partitions profiles with independent protected keys across A to B to A', async () => {
    await saveFinanceState(financeCanary('user-a-private-income', 100), 'user-a-id')
    await saveFinanceState(financeCanary('user-b-private-income', 200), 'user-b-id')

    expect((await loadFinanceState('user-a-id'))?.incomes.map((record) => record.id)).toEqual(['user-a-private-income'])
    expect((await loadFinanceState('user-b-id'))?.incomes.map((record) => record.id)).toEqual(['user-b-private-income'])
    expect((await loadFinanceState('user-a-id'))?.incomes.map((record) => record.id)).toEqual(['user-a-private-income'])
    expect([...secureValues.entries()].filter(([key]) => key.includes('encryptionKey')).map(([, value]) => value)).toHaveLength(2)
  })

  it('uses one profile key when finance and sync are first persisted concurrently', async () => {
    await Promise.all([
      saveFinanceState(financeCanary('concurrent-profile'), 'user-a'),
      saveSyncState({ ...createEmptySyncState(), userId: 'user-a' }, 'user-a')
    ])

    expect((await loadFinanceState('user-a'))?.incomes[0].id).toBe('concurrent-profile')
    expect((await loadSyncState('user-a'))?.userId).toBe('user-a')
    expect([...secureValues.keys()].filter((key) => key.includes('encryptionKey'))).toHaveLength(1)
  })

  it('serializes rapid writes so an older encryption operation cannot replace newer state', async () => {
    const first = financeCanary('older-state')
    const second = financeCanary('newer-state')
    await Promise.all([saveFinanceState(first, 'user-a'), saveFinanceState(second, 'user-a')])
    expect((await loadFinanceState('user-a'))?.incomes[0].id).toBe('newer-state')
  })

  it('fails closed when an encrypted profile key is missing or corrupt', async () => {
    await saveFinanceState(financeCanary('key-loss-canary'), 'user-a')
    const keyName = [...secureValues.keys()].find((key) => key.includes('encryptionKey'))!
    secureValues.delete(keyName)
    await expect(loadFinanceState('user-a')).rejects.toThrow(MobileStorageError)
    secureValues.set(keyName, 'corrupt-protected-key')
    await expect(loadFinanceState('user-a')).rejects.toThrow(MobileStorageError)
  })

  it('fails closed when authenticated ciphertext is corrupt or belongs to another profile', async () => {
    await saveFinanceState(financeCanary('profile-a'), 'user-a')
    await saveFinanceState(financeCanary('profile-b'), 'user-b')
    const financeKeys = [...asyncValues.keys()].filter((key) => key.endsWith('.finance.v3'))
    const [first, second] = financeKeys
    asyncValues.set(first, asyncValues.get(second)!)
    await expect(loadFinanceState('user-a')).rejects.toThrow(MobileStorageError)
  })

  for (const point of ['after-staging-write', 'after-encrypted-write', 'after-encrypted-verify', 'before-plaintext-delete'] as const) {
    it(`restarts plaintext migration safely after ${point}`, async () => {
      const legacy = financeCanary(`migration-${point}`)
      asyncValues.set('moneywise.mobile.financeState.v1', JSON.stringify(legacy))
      configureStorageFailureInjectionForTests(point)
      await expect(loadFinanceState()).rejects.toThrow('Simulated storage crash')
      expect(asyncValues.get('moneywise.mobile.financeState.v1')).toContain(`migration-${point}`)

      configureStorageFailureInjectionForTests(null)
      expect(await loadFinanceState()).toEqual(legacy)
      expect(asyncValues.has('moneywise.mobile.financeState.v1')).toBe(false)
      expect([...asyncValues.values()].join('\n')).not.toContain(`migration-${point}`)
    })
  }

  it('encrypts quarantined legacy finance when ownership cannot be proven', async () => {
    asyncValues.set('moneywise.mobile.financeState.v1', JSON.stringify(financeCanary('ambiguous-private-income')))
    asyncValues.set('moneywise.mobile.syncState.v1', JSON.stringify(createEmptySyncState()))
    const initialized = await initializeMobileStorage()

    expect(initialized.userId).toBeNull()
    expect(initialized.financeState).toBeNull()
    expect([...asyncValues.values()].join('\n')).not.toContain('ambiguous-private-income')
    expect([...asyncValues.keys()].some((key) => key.includes('quarantine') && key.endsWith('.finance.v3'))).toBe(true)
  })

  it('migrates an existing account-scoped v2 profile without losing its active owner', async () => {
    const userId = 'user-a'
    const encodedId = Array.from(userId).map((character) => character.codePointAt(0)!.toString(16).padStart(6, '0')).join('')
    const finance = financeCanary('existing-v2-profile')
    const sync = { ...createEmptySyncState(), userId, accountEmail: 'owner@example.test' }
    asyncValues.set(`moneywise.mobile.profile.${encodedId}.finance.v2`, JSON.stringify(finance))
    asyncValues.set(`moneywise.mobile.profile.${encodedId}.sync.v2`, JSON.stringify(sync))
    asyncValues.set('moneywise.mobile.storageMigration.v2', JSON.stringify({ version: 2, activeUserId: userId }))

    const initialized = await initializeMobileStorage()

    expect(initialized.userId).toBe(userId)
    expect(initialized.financeState?.incomes[0].id).toBe('existing-v2-profile')
    expect(asyncValues.has(`moneywise.mobile.profile.${encodedId}.finance.v2`)).toBe(false)
    expect([...asyncValues.values()].join('\n')).not.toContain('existing-v2-profile')
  })
})
