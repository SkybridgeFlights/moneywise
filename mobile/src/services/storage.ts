import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { createDefaultFinanceState, createEmptySyncState } from '../models/defaults'
import type { FinanceState, SyncState } from '../models/types'

const FINANCE_STATE_KEY = 'moneywise.mobile.financeState.v1'
const SYNC_STATE_KEY = 'moneywise.mobile.syncState.v1'
const ACCESS_TOKEN_KEY = 'moneywise.mobile.accessToken.v1'
const REFRESH_TOKEN_KEY = 'moneywise.mobile.refreshToken.v1'

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

export async function loadFinanceState(): Promise<FinanceState | null> {
  const raw = await AsyncStorage.getItem(FINANCE_STATE_KEY)
  return safeParse<FinanceState | null>(raw, null)
}

export async function saveFinanceState(state: FinanceState): Promise<void> {
  await AsyncStorage.setItem(FINANCE_STATE_KEY, JSON.stringify(state))
}

export async function loadSyncState(): Promise<SyncState | null> {
  const raw = await AsyncStorage.getItem(SYNC_STATE_KEY)
  const parsed = safeParse<SyncState | null>(raw, null)
  if (!parsed) return null
  const legacyAccessToken = parsed.authToken
  const legacyRefreshToken = parsed.refreshToken
  const [authToken, refreshToken] = await Promise.all([
    readSecret(ACCESS_TOKEN_KEY),
    readSecret(REFRESH_TOKEN_KEY)
  ])
  const next = { ...parsed, authToken: authToken ?? legacyAccessToken ?? null, refreshToken: refreshToken ?? legacyRefreshToken ?? null }
  if (Platform.OS !== 'web' && (legacyAccessToken || legacyRefreshToken)) await saveSyncState(next)
  return next
}

export async function saveSyncState(state: SyncState): Promise<void> {
  const { authToken, refreshToken, ...nonSecretState } = state
  await Promise.all([
    AsyncStorage.setItem(SYNC_STATE_KEY, JSON.stringify({ ...nonSecretState, authToken: null, refreshToken: null })),
    writeSecret(ACCESS_TOKEN_KEY, authToken),
    writeSecret(REFRESH_TOKEN_KEY, refreshToken)
  ])
}

export async function resetMobileStorage(): Promise<void> {
  await saveFinanceState(createDefaultFinanceState())
  await saveSyncState(createEmptySyncState())
}
