import AsyncStorage from '@react-native-async-storage/async-storage'
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { createDefaultFinanceState, createEmptySyncState } from '../models/defaults'
import type { FinanceState, SyncState } from '../models/types'

const FINANCE_STATE_KEY = 'moneywise.mobile.financeState.v1'
const SYNC_STATE_KEY = 'moneywise.mobile.syncState.v1'
const ACCESS_TOKEN_KEY = 'moneywise.mobile.accessToken.v1'
const REFRESH_TOKEN_KEY = 'moneywise.mobile.refreshToken.v1'
const STORAGE_MIGRATION_KEY = 'moneywise.mobile.storageMigration.v2'
const ACTIVE_PROFILE_KEY = 'moneywise.mobile.activeProfile.v3'
const ENVELOPE_VERSION = 3

type PayloadKind = 'finance' | 'sync' | 'quarantine-finance' | 'quarantine-sync'
type FailurePoint = 'after-staging-write' | 'after-encrypted-write' | 'after-encrypted-verify' | 'before-plaintext-delete'

type EncryptedEnvelope = {
  version: 3
  algorithm: 'AES-256-GCM'
  profile: string
  kind: PayloadKind
  ciphertext: string
}

export class MobileStorageError extends Error {}
class SimulatedStorageCrash extends Error {}

let injectedFailure: FailurePoint | null = null
const pendingKeys = new Map<string, Promise<AESEncryptionKey>>()
const pendingWrites = new Map<string, Promise<void>>()

export function configureStorageFailureInjectionForTests(point: FailurePoint | null): void {
  injectedFailure = point
}

function failAt(point: FailurePoint): void {
  if (injectedFailure === point) throw new SimulatedStorageCrash(`Simulated storage crash at ${point}`)
}

function profileId(userId: string): string {
  return Array.from(userId)
    .map((character) => character.codePointAt(0)!.toString(16).padStart(6, '0'))
    .join('')
}

function scopeKeys(scope: string) {
  return {
    finance: `moneywise.mobile.profile.${scope}.finance.v3`,
    sync: `moneywise.mobile.profile.${scope}.sync.v3`,
    staging: (kind: PayloadKind) => `moneywise.mobile.profile.${scope}.${kind}.staging.v3`,
    key: `moneywise.mobile.profile.${scope}.encryptionKey.v3`,
    access: `moneywise.mobile.profile.${scope}.accessToken.v3`,
    refresh: `moneywise.mobile.profile.${scope}.refreshToken.v3`
  }
}

function legacyProfileKeys(userId: string) {
  const id = profileId(userId)
  return {
    finance: `moneywise.mobile.profile.${id}.finance.v2`,
    sync: `moneywise.mobile.profile.${id}.sync.v2`,
    access: `moneywise.mobile.profile.${id}.accessToken.v2`,
    refresh: `moneywise.mobile.profile.${id}.refreshToken.v2`
  }
}

function keysFor(userId?: string) {
  const scope = userId ? profileId(userId) : 'unscoped'
  const current = scopeKeys(scope)
  const legacy = userId
    ? legacyProfileKeys(userId)
    : { finance: FINANCE_STATE_KEY, sync: SYNC_STATE_KEY, access: ACCESS_TOKEN_KEY, refresh: REFRESH_TOKEN_KEY }
  return { scope, current, legacy }
}

async function readSecret(key: string): Promise<string | null> {
  return Platform.OS === 'web' ? null : SecureStore.getItemAsync(key)
}

async function writeSecret(key: string, value: string | null): Promise<void> {
  if (Platform.OS === 'web') return
  if (value) await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY })
  else await SecureStore.deleteItemAsync(key)
}

function parseJson<T>(value: string, description: string): T {
  try {
    return JSON.parse(value) as T
  } catch {
    throw new MobileStorageError(`${description} is malformed.`)
  }
}

function aad(scope: string, kind: PayloadKind): Uint8Array {
  return new TextEncoder().encode(`MoneyWise-Mobile|${ENVELOPE_VERSION}|${scope}|${kind}`)
}

async function getOrCreateKey(scope: string): Promise<AESEncryptionKey> {
  if (Platform.OS === 'web') throw new MobileStorageError('Encrypted mobile persistence requires native secure storage.')
  const keyName = scopeKeys(scope).key
  const existing = await readSecret(keyName)
  if (existing) {
    try {
      return await AESEncryptionKey.import(existing, 'base64')
    } catch {
      throw new MobileStorageError('The protected local encryption key is corrupt.')
    }
  }
  const pending = pendingKeys.get(scope)
  if (pending) return pending
  const creation = (async () => {
    const raced = await readSecret(keyName)
    if (raced) return AESEncryptionKey.import(raced, 'base64')
    const generated = await AESEncryptionKey.generate(256)
    await writeSecret(keyName, await generated.encoded('base64'))
    return generated
  })()
  pendingKeys.set(scope, creation)
  try {
    return await creation
  } finally {
    pendingKeys.delete(scope)
  }
}

async function requireKey(scope: string): Promise<AESEncryptionKey> {
  const encoded = await readSecret(scopeKeys(scope).key)
  if (!encoded) throw new MobileStorageError('The protected local encryption key is missing.')
  try {
    return await AESEncryptionKey.import(encoded, 'base64')
  } catch {
    throw new MobileStorageError('The protected local encryption key is corrupt.')
  }
}

async function seal(scope: string, kind: PayloadKind, plaintext: string, key: AESEncryptionKey): Promise<string> {
  const sealed = await aesEncryptAsync(new TextEncoder().encode(plaintext), key, { additionalData: aad(scope, kind), tagLength: 16 })
  return JSON.stringify({
    version: ENVELOPE_VERSION,
    algorithm: 'AES-256-GCM',
    profile: scope,
    kind,
    ciphertext: await sealed.combined('base64')
  } satisfies EncryptedEnvelope)
}

async function open(scope: string, kind: PayloadKind, serialized: string, key: AESEncryptionKey): Promise<string> {
  const envelope = parseJson<EncryptedEnvelope>(serialized, 'Encrypted local envelope')
  if (envelope.version !== ENVELOPE_VERSION || envelope.algorithm !== 'AES-256-GCM' || envelope.profile !== scope || envelope.kind !== kind || typeof envelope.ciphertext !== 'string') {
    throw new MobileStorageError('Encrypted local envelope metadata is invalid.')
  }
  try {
    const decrypted = await aesDecryptAsync(AESSealedData.fromCombined(envelope.ciphertext), key, { additionalData: aad(scope, kind), output: 'bytes' })
    return new TextDecoder().decode(decrypted as Uint8Array)
  } catch {
    throw new MobileStorageError('Encrypted local data failed authentication.')
  }
}

async function writeEncrypted(scope: string, storageKey: string, kind: PayloadKind, plaintext: string): Promise<void> {
  const key = await getOrCreateKey(scope)
  const envelope = await seal(scope, kind, plaintext, key)
  await AsyncStorage.setItem(storageKey, envelope)
  const verified = await open(scope, kind, (await AsyncStorage.getItem(storageKey)) ?? '', key)
  if (verified !== plaintext) throw new MobileStorageError('Encrypted local data verification failed.')
}

async function enqueueWrite(storageKey: string, operation: () => Promise<void>): Promise<void> {
  const previous = pendingWrites.get(storageKey) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(operation)
  pendingWrites.set(storageKey, current)
  try {
    await current
  } finally {
    if (pendingWrites.get(storageKey) === current) pendingWrites.delete(storageKey)
  }
}

async function readOrMigrate<T>(scope: string, storageKey: string, legacyKey: string, kind: PayloadKind): Promise<T | null> {
  const encrypted = await AsyncStorage.getItem(storageKey)
  if (encrypted) {
    const plaintext = await open(scope, kind, encrypted, await requireKey(scope))
    const parsed = parseJson<T>(plaintext, 'Decrypted local data')
    if (await AsyncStorage.getItem(legacyKey)) await AsyncStorage.removeItem(legacyKey)
    return parsed
  }
  const legacy = await AsyncStorage.getItem(legacyKey)
  if (!legacy) return null
  parseJson<T>(legacy, 'Legacy local data')
  const key = await getOrCreateKey(scope)
  const envelope = await seal(scope, kind, legacy, key)
  const stagingKey = scopeKeys(scope).staging(kind)
  try {
    await AsyncStorage.setItem(stagingKey, envelope)
    failAt('after-staging-write')
    if (await open(scope, kind, (await AsyncStorage.getItem(stagingKey)) ?? '', key) !== legacy) throw new MobileStorageError('Staged encrypted migration verification failed.')
    await AsyncStorage.setItem(storageKey, envelope)
    failAt('after-encrypted-write')
    if (await open(scope, kind, (await AsyncStorage.getItem(storageKey)) ?? '', key) !== legacy) throw new MobileStorageError('Encrypted migration verification failed.')
    failAt('after-encrypted-verify')
    await AsyncStorage.removeItem(stagingKey)
    failAt('before-plaintext-delete')
    await AsyncStorage.removeItem(legacyKey)
    return parseJson<T>(legacy, 'Legacy local data')
  } catch (error) {
    if (!(error instanceof SimulatedStorageCrash)) {
      await AsyncStorage.removeItem(stagingKey)
      await AsyncStorage.removeItem(storageKey)
    }
    throw error
  }
}

export async function loadFinanceState(userId?: string): Promise<FinanceState | null> {
  if (Platform.OS === 'web') return null
  const keys = keysFor(userId)
  return readOrMigrate<FinanceState>(keys.scope, keys.current.finance, keys.legacy.finance, 'finance')
}

export async function saveFinanceState(state: FinanceState, userId?: string): Promise<void> {
  if (Platform.OS === 'web') return
  const keys = keysFor(userId)
  await enqueueWrite(keys.current.finance, () => writeEncrypted(keys.scope, keys.current.finance, 'finance', JSON.stringify(state)))
}

export async function loadSyncState(userId?: string): Promise<SyncState | null> {
  if (Platform.OS === 'web') return null
  const keys = keysFor(userId)
  const parsed = await readOrMigrate<SyncState>(keys.scope, keys.current.sync, keys.legacy.sync, 'sync')
  if (!parsed) return null
  const legacyAccessToken = parsed.authToken
  const legacyRefreshToken = parsed.refreshToken
  const [authToken, refreshToken] = await Promise.all([
    readSecretWithFallback(keys.current.access, keys.legacy.access),
    readSecretWithFallback(keys.current.refresh, keys.legacy.refresh)
  ])
  const next = { ...parsed, authToken: authToken ?? legacyAccessToken ?? null, refreshToken: refreshToken ?? legacyRefreshToken ?? null }
  if (legacyAccessToken || legacyRefreshToken) await saveSyncState(next, userId)
  return next
}

async function readSecretWithFallback(current: string, legacy: string): Promise<string | null> {
  return (await readSecret(current)) ?? readSecret(legacy)
}

export async function saveSyncState(state: SyncState, userId?: string): Promise<void> {
  if (Platform.OS === 'web') return
  const keys = keysFor(userId)
  const { authToken, refreshToken, ...nonSecretState } = state
  await enqueueWrite(keys.current.sync, async () => {
    await writeEncrypted(keys.scope, keys.current.sync, 'sync', JSON.stringify({ ...nonSecretState, authToken: null, refreshToken: null }))
    await Promise.all([
      writeSecret(keys.current.access, authToken),
      writeSecret(keys.current.refresh, refreshToken),
      writeSecret(keys.legacy.access, null),
      writeSecret(keys.legacy.refresh, null)
    ])
  })
}

export async function clearMobileCredentials(userId?: string): Promise<void> {
  const keys = keysFor(userId)
  await pendingWrites.get(keys.current.sync)?.catch(() => undefined)
  await Promise.all([
    writeSecret(keys.current.access, null),
    writeSecret(keys.current.refresh, null),
    writeSecret(keys.legacy.access, null),
    writeSecret(keys.legacy.refresh, null)
  ])
}

export async function initializeMobileStorage(): Promise<{ financeState: FinanceState | null; syncState: SyncState | null; userId: string | null }> {
  if (Platform.OS === 'web') return { financeState: null, syncState: null, userId: null }
  const metadataRaw = await AsyncStorage.getItem(STORAGE_MIGRATION_KEY)
  const metadata = metadataRaw ? parseJson<{ version?: number; activeUserId?: string | null }>(metadataRaw, 'Storage migration metadata') : {}
  let owner = await readSecret(ACTIVE_PROFILE_KEY)
  if (!owner && typeof metadata.activeUserId === 'string') owner = metadata.activeUserId

  if (metadata.version !== ENVELOPE_VERSION) {
    if (owner) {
      await Promise.all([loadFinanceState(owner), loadSyncState(owner)])
      await writeSecret(ACTIVE_PROFILE_KEY, owner)
      await AsyncStorage.setItem(STORAGE_MIGRATION_KEY, JSON.stringify({ version: ENVELOPE_VERSION, ownership: 'existing-account-profile', profileId: profileId(owner) }))
    } else {
      const legacySync = await loadSyncState()
      const legacyFinance = await loadFinanceState()
      if (legacySync?.userId) {
        owner = legacySync.userId
        if (!(await loadSyncState(owner))) {
          if (legacyFinance) await saveFinanceState(legacyFinance, owner)
          await saveSyncState(legacySync, owner)
        }
        await writeSecret(ACTIVE_PROFILE_KEY, owner)
        await AsyncStorage.setItem(STORAGE_MIGRATION_KEY, JSON.stringify({ version: ENVELOPE_VERSION, ownership: 'deterministic-authenticated-user', profileId: profileId(owner) }))
      } else {
        const quarantine = scopeKeys('quarantine')
        if (legacyFinance) await writeEncrypted('quarantine', quarantine.finance, 'quarantine-finance', JSON.stringify(legacyFinance))
        if (legacySync) await writeEncrypted('quarantine', quarantine.sync, 'quarantine-sync', JSON.stringify(legacySync))
        await clearMobileCredentials()
        await writeSecret(ACTIVE_PROFILE_KEY, null)
        owner = null
        await AsyncStorage.setItem(STORAGE_MIGRATION_KEY, JSON.stringify({ version: ENVELOPE_VERSION, ownership: 'unknown-encrypted-quarantine' }))
      }
    }
  }
  if (!owner) return { financeState: null, syncState: null, userId: null }
  return { financeState: await loadFinanceState(owner), syncState: await loadSyncState(owner), userId: owner }
}

export async function setActiveMobileProfile(userId: string | null): Promise<void> {
  await writeSecret(ACTIVE_PROFILE_KEY, userId)
}

export async function loadAccountProfile(userId: string): Promise<{ financeState: FinanceState | null; syncState: SyncState | null }> {
  return { financeState: await loadFinanceState(userId), syncState: await loadSyncState(userId) }
}

export async function resetMobileStorage(userId?: string): Promise<void> {
  await saveFinanceState(createDefaultFinanceState(), userId)
  await saveSyncState({ ...createEmptySyncState(), userId: userId ?? null }, userId)
}
