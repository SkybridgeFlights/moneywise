import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { createDefaultFinanceState, createEmptySyncState } from '../models/defaults'
import type { FinanceState, SyncState } from '../models/types'

const FINANCE_STATE_KEY = 'moneywise.mobile.financeState.v1'
const SYNC_STATE_KEY = 'moneywise.mobile.syncState.v1'
const ACCESS_TOKEN_KEY = 'moneywise.mobile.accessToken.v1'
const REFRESH_TOKEN_KEY = 'moneywise.mobile.refreshToken.v1'
const STORAGE_MIGRATION_KEY = 'moneywise.mobile.storageMigration.v2'

function profileId(userId: string): string {
  return Array.from(userId)
    .map((character) => character.codePointAt(0)!.toString(16).padStart(6, '0'))
    .join('')
}

function profileKeys(userId: string) {
  const id = profileId(userId)
  return {
    finance: `moneywise.mobile.profile.${id}.finance.v2`,
    sync: `moneywise.mobile.profile.${id}.sync.v2`,
    access: `moneywise.mobile.profile.${id}.accessToken.v2`,
    refresh: `moneywise.mobile.profile.${id}.refreshToken.v2`
  }
}

async function readSecret(key: string): Promise<string | null> {
  return Platform.OS === 'web' ? null : SecureStore.getItemAsync(key)
}

async function writeSecret(key: string, value: string | null): Promise<void> {
  if (Platform.OS === 'web') return
  if (value) await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY })
  else await SecureStore.deleteItemAsync(key)
}

function safeParse<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback
  }
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export async function loadFinanceState(userId?: string): Promise<FinanceState | null> {
  const raw = await AsyncStorage.getItem(userId ? profileKeys(userId).finance : FINANCE_STATE_KEY)
  return safeParse<FinanceState | null>(raw, null)
}

export async function saveFinanceState(state: FinanceState, userId?: string): Promise<void> {
  await AsyncStorage.setItem(userId ? profileKeys(userId).finance : FINANCE_STATE_KEY, JSON.stringify(state))
}

export async function loadSyncState(userId?: string): Promise<SyncState | null> {
  const keys = userId ? profileKeys(userId) : null
  const raw = await AsyncStorage.getItem(keys?.sync ?? SYNC_STATE_KEY)
  const parsed = safeParse<SyncState | null>(raw, null)
  if (!parsed) return null
  const legacyAccessToken = parsed.authToken
  const legacyRefreshToken = parsed.refreshToken
  const [authToken, refreshToken] = await Promise.all([
    readSecret(keys?.access ?? ACCESS_TOKEN_KEY),
    readSecret(keys?.refresh ?? REFRESH_TOKEN_KEY)
  ])
  const next = { ...parsed, authToken: authToken ?? legacyAccessToken ?? null, refreshToken: refreshToken ?? legacyRefreshToken ?? null }
  if (Platform.OS !== 'web' && (legacyAccessToken || legacyRefreshToken)) await saveSyncState(next, userId)
  return next
}

export async function saveSyncState(state: SyncState, userId?: string): Promise<void> {
  const keys = userId ? profileKeys(userId) : null
  const { authToken, refreshToken, ...nonSecretState } = state
  await Promise.all([
    AsyncStorage.setItem(keys?.sync ?? SYNC_STATE_KEY, JSON.stringify({ ...nonSecretState, authToken: null, refreshToken: null })),
    writeSecret(keys?.access ?? ACCESS_TOKEN_KEY, authToken),
    writeSecret(keys?.refresh ?? REFRESH_TOKEN_KEY, refreshToken)
  ])
}

export async function initializeMobileStorage(): Promise<{ financeState: FinanceState | null; syncState: SyncState | null; userId: string | null }> {
  const migrated = await AsyncStorage.getItem(STORAGE_MIGRATION_KEY)
  const legacySync = await loadSyncState()
  const legacyFinance = await loadFinanceState()
  if (!migrated) {
    if (legacySync?.userId) {
      const existingProfile = await loadSyncState(legacySync.userId)
      if (!existingProfile) {
        if (legacyFinance) await saveFinanceState(legacyFinance, legacySync.userId)
        await saveSyncState(legacySync, legacySync.userId)
      }
      await AsyncStorage.setItem(STORAGE_MIGRATION_KEY, JSON.stringify({ version: 2, ownership: 'deterministic-authenticated-user', profileId: profileId(legacySync.userId), activeUserId: legacySync.userId }))
    } else {
      await AsyncStorage.setItem('moneywise.mobile.quarantine.finance.v1', JSON.stringify(legacyFinance))
      await AsyncStorage.setItem('moneywise.mobile.quarantine.sync.v1', JSON.stringify(legacySync))
      await writeSecret(ACCESS_TOKEN_KEY, null)
      await writeSecret(REFRESH_TOKEN_KEY, null)
      await AsyncStorage.setItem(STORAGE_MIGRATION_KEY, JSON.stringify({ version: 2, ownership: 'unknown-quarantined' }))
    }
  }
  const metadata = safeParse<{ activeUserId?: string | null }>(await AsyncStorage.getItem(STORAGE_MIGRATION_KEY), {})
  const owner = typeof metadata.activeUserId === 'string' ? metadata.activeUserId : null
  if (!owner) return { financeState: null, syncState: null, userId: null }
  return { financeState: await loadFinanceState(owner), syncState: await loadSyncState(owner), userId: owner }
}

export async function setActiveMobileProfile(userId: string | null): Promise<void> {
  const metadata = safeParse<Record<string, unknown>>(await AsyncStorage.getItem(STORAGE_MIGRATION_KEY), { version: 2 })
  await AsyncStorage.setItem(STORAGE_MIGRATION_KEY, JSON.stringify({ ...metadata, version: 2, activeUserId: userId }))
}

export async function loadAccountProfile(userId: string): Promise<{ financeState: FinanceState | null; syncState: SyncState | null }> {
  return { financeState: await loadFinanceState(userId), syncState: await loadSyncState(userId) }
}

export async function resetMobileStorage(userId?: string): Promise<void> {
  await saveFinanceState(createDefaultFinanceState(), userId)
  await saveSyncState({ ...createEmptySyncState(), userId: userId ?? null }, userId)
}
