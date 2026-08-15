import { defaultSettings } from '../models/defaults'
import type {
  FinanceState,
  PendingSyncChange,
  RemoteSyncRecord,
  SyncEntityType,
  SyncManifestEntry,
  SyncState
} from '../models/types'
import type { MobileSyncConfig } from './config'
import { applyRemoteSyncChanges, buildSyncRecordKey, buildSyncableStateIndex } from './repository'
import { syncPayloadSchemas } from '../models/validation'

const DEFAULT_CURSOR = '0'

function createRequestId(): string {
  return `request-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}
const SYNC_ENTITY_ORDER: SyncEntityType[] = ['settings', 'category', 'budget', 'goal', 'debt', 'income', 'expense', 'monthly-summary']
const SYNC_ENTITY_SET = new Set<SyncEntityType>(SYNC_ENTITY_ORDER)
const DEFAULT_SETTINGS_HASH = hashPayload({ ...(defaultSettings as unknown as Record<string, unknown>), moneyVersion: 2 })

class PendingPushError extends Error {
  constructor(message: string, readonly financeState: FinanceState, readonly syncState: SyncState) {
    super(message)
    this.name = 'PendingPushError'
  }
}

type SyncStatus = {
  phase: 'disabled' | 'idle' | 'syncing' | 'error'
  message: string
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  }
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

function hashPayload(payload: Record<string, unknown>): string {
  const source = stableStringify(payload)
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `h${(hash >>> 0).toString(16)}`
}

function createDeviceId(): string {
  return `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeSyncEntityType(value: unknown): SyncEntityType | null {
  return typeof value === 'string' && SYNC_ENTITY_SET.has(value as SyncEntityType) ? (value as SyncEntityType) : null
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeRemoteChange(value: unknown, entityTypeOverride?: SyncEntityType): RemoteSyncRecord | null {
  if (!isRecordObject(value)) {
    return null
  }
  const entityType = entityTypeOverride ?? normalizeSyncEntityType(value.entityType)
  const recordId = typeof value.recordId === 'string' ? value.recordId : typeof value.id === 'string' ? value.id : null
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : null
  const version = typeof value.version === 'number' ? value.version : null
  if (!entityType || !recordId || !updatedAt || version === null) {
    return null
  }
  const deletedAt = typeof value.deletedAt === 'string' ? value.deletedAt : null
  const rawPayload = isRecordObject(value.payload) ? value.payload : {}
  const payload = deletedAt ? rawPayload : syncPayloadSchemas[entityType].parse({
    ...rawPayload,
    ...(entityType === 'settings' ? {} : entityType === 'monthly-summary' ? { month: recordId } : { id: recordId })
  }) as Record<string, unknown>
  return {
    entityType,
    recordId,
    payload,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : null,
    updatedAt,
    deletedAt,
    version,
    lastModifiedByDeviceId: typeof value.lastModifiedByDeviceId === 'string' ? value.lastModifiedByDeviceId : null
  }
}

function sortRemoteChanges(changes: RemoteSyncRecord[]): RemoteSyncRecord[] {
  return [...changes].sort((left, right) => {
    if (Boolean(left.deletedAt) !== Boolean(right.deletedAt)) {
      return left.deletedAt ? 1 : -1
    }
    const leftIndex = SYNC_ENTITY_ORDER.indexOf(left.entityType)
    const rightIndex = SYNC_ENTITY_ORDER.indexOf(right.entityType)
    return left.deletedAt ? rightIndex - leftIndex : leftIndex - rightIndex
  })
}

function createManifestEntry(change: RemoteSyncRecord, lastSyncedHash: string | null): SyncManifestEntry {
  return {
    entityType: change.entityType,
    recordId: change.recordId,
    lastSyncedHash,
    remoteVersion: change.version,
    updatedAt: change.updatedAt,
    deletedAt: change.deletedAt
  }
}

function mapAppliedHash(financeState: FinanceState, entityType: SyncEntityType, recordId: string, deletedAt: string | null): string | null {
  if (deletedAt) {
    return null
  }
  const index = buildSyncableStateIndex(financeState)
  return index.get(buildSyncRecordKey(entityType, recordId)) ? hashPayload(index.get(buildSyncRecordKey(entityType, recordId))!.payload) : null
}

function parseBootstrapPayload(value: unknown): { order: SyncEntityType[]; cursor: string; records: Partial<Record<SyncEntityType, RemoteSyncRecord[]>> } {
  if (!isRecordObject(value)) {
    return { order: [...SYNC_ENTITY_ORDER], cursor: DEFAULT_CURSOR, records: {} }
  }
  const order = Array.isArray(value.order)
    ? value.order.map((entry) => normalizeSyncEntityType(entry)).filter((entry): entry is SyncEntityType => Boolean(entry))
    : [...SYNC_ENTITY_ORDER]
  const records = Object.fromEntries(
    Object.entries(isRecordObject(value.records) ? value.records : {})
      .map(([entityType, entries]) => {
        const normalizedEntityType = normalizeSyncEntityType(entityType)
        if (!normalizedEntityType || !Array.isArray(entries)) {
          return null
        }
        return [normalizedEntityType, entries.map((entry) => normalizeRemoteChange(entry, normalizedEntityType)).filter((entry): entry is RemoteSyncRecord => Boolean(entry))]
      })
      .filter((entry): entry is [SyncEntityType, RemoteSyncRecord[]] => Boolean(entry))
  ) as Partial<Record<SyncEntityType, RemoteSyncRecord[]>>

  return {
    order: order.length > 0 ? order : [...SYNC_ENTITY_ORDER],
    cursor: typeof value.cursor === 'string' ? value.cursor : DEFAULT_CURSOR,
    records
  }
}

function parseChangesPayload(value: unknown): { cursor: string; changes: RemoteSyncRecord[]; hasMore: boolean } {
  if (!isRecordObject(value)) {
    return { cursor: DEFAULT_CURSOR, changes: [], hasMore: false }
  }
  return {
    cursor: typeof value.cursor === 'string' ? value.cursor : DEFAULT_CURSOR,
    hasMore: value.hasMore === true,
    changes: Array.isArray(value.changes)
      ? value.changes.map((entry) => normalizeRemoteChange(entry)).filter((entry): entry is RemoteSyncRecord => Boolean(entry))
      : []
  }
}

function parsePushResponse(value: unknown): {
  applied: Array<{ entityType: SyncEntityType; recordId: string; version: number; updatedAt: string; deletedAt: string | null }>
  conflicts: Array<{ entityType: SyncEntityType; recordId: string; version: number; updatedAt: string | null; deletedAt: string | null }>
} {
  if (!isRecordObject(value)) {
    return { applied: [], conflicts: [] }
  }
  return {
    applied: Array.isArray(value.applied)
      ? value.applied
          .map((entry) => {
            if (!isRecordObject(entry)) return null
            const entityType = normalizeSyncEntityType(entry.entityType)
            if (!entityType || typeof entry.recordId !== 'string' || typeof entry.version !== 'number' || typeof entry.updatedAt !== 'string') {
              return null
            }
            return {
              entityType,
              recordId: entry.recordId,
              version: entry.version,
              updatedAt: entry.updatedAt,
              deletedAt: typeof entry.deletedAt === 'string' ? entry.deletedAt : null
            }
          })
          .filter((entry): entry is { entityType: SyncEntityType; recordId: string; version: number; updatedAt: string; deletedAt: string | null } => Boolean(entry))
      : [],
    conflicts: Array.isArray(value.conflicts)
      ? value.conflicts
          .map((entry) => {
            if (!isRecordObject(entry)) return null
            const entityType = normalizeSyncEntityType(entry.entityType)
            const current = isRecordObject(entry.conflict) && isRecordObject(entry.conflict.current) ? entry.conflict.current : null
            if (!entityType || typeof entry.recordId !== 'string' || !current || typeof current.version !== 'number') {
              return null
            }
            return {
              entityType,
              recordId: entry.recordId,
              version: current.version,
              updatedAt: typeof current.updatedAt === 'string' ? current.updatedAt : null,
              deletedAt: typeof current.deletedAt === 'string' ? current.deletedAt : null
            }
          })
          .filter((entry): entry is { entityType: SyncEntityType; recordId: string; version: number; updatedAt: string | null; deletedAt: string | null } => Boolean(entry))
      : []
  }
}

export class MobileSyncService {
  constructor(private readonly config: MobileSyncConfig) {}

  getPendingChangeCount(financeState: FinanceState, syncState: SyncState): number {
    if (!this.config.enabled || syncState.paused) {
      return 0
    }
    return this.collectPendingLocalChanges(financeState, syncState.manifest).length
  }

  async login(syncState: SyncState, email: string, password: string): Promise<SyncState> {
    return this.authenticate(syncState, '/api/auth/login', email, password)
  }

  async register(syncState: SyncState, email: string, password: string): Promise<SyncState> {
    return this.authenticate(syncState, '/api/auth/register', email, password)
  }

  async logout(syncState: SyncState): Promise<SyncState> {
    if (syncState.authToken) {
      try { await this.requestJson('/api/auth/logout', { method: 'POST' }, syncState.authToken) } catch { /* offline logout remains local */ }
    }
    return {
      ...syncState,
      authToken: null,
      refreshToken: null,
      accessTokenExpiresAt: null,
      userId: null,
      accountEmail: null,
      authMode: null,
      cursor: null,
      bootstrapCompleted: false,
      lastSyncAt: null,
      lastError: null,
      pendingPush: null,
      manifest: {}
    }
  }

  async syncFinanceState(financeState: FinanceState, syncState: SyncState): Promise<{
    financeState: FinanceState
    syncState: SyncState
    status: SyncStatus
  }> {
    if (!this.config.enabled || !this.config.backendUrl) {
      return {
        financeState,
        syncState,
        status: { phase: 'disabled', message: 'Sync disabled' }
      }
    }

    if (syncState.paused) {
      return {
        financeState,
        syncState,
        status: { phase: 'idle', message: 'Sync paused on this device' }
      }
    }

    try {
      await this.requestJson('/health', { method: 'GET' })
      let nextSyncState = await this.ensureSession(syncState)
      let nextFinanceState = financeState

      if (!nextSyncState.bootstrapCompleted) {
        const bootstrapResult = await this.bootstrap(nextFinanceState, nextSyncState)
        nextFinanceState = bootstrapResult.financeState
        nextSyncState = bootstrapResult.syncState
      }

      const pulled = await this.pullChanges(nextFinanceState, nextSyncState)
      nextFinanceState = pulled.financeState
      nextSyncState = pulled.syncState

      const pushed = await this.pushLocalChanges(nextFinanceState, nextSyncState)
      nextFinanceState = pushed.financeState
      nextSyncState = pushed.syncState

      return {
        financeState: nextFinanceState,
        syncState: {
          ...nextSyncState,
          lastSyncAt: new Date().toISOString(),
          lastError: null
        },
        status: { phase: 'idle', message: 'Sync completed' }
      }
    } catch (error) {
      const failedFinanceState = error instanceof PendingPushError ? error.financeState : financeState
      const failedSyncState = error instanceof PendingPushError ? error.syncState : syncState
      return {
        financeState: failedFinanceState,
        syncState: {
          ...failedSyncState,
          authToken: error instanceof Error && error.message.includes('[401]') ? null : failedSyncState.authToken,
          lastError: error instanceof Error ? error.message : 'Sync failed'
        },
        status: {
          phase: 'error',
          message: error instanceof Error ? error.message : 'Sync failed'
        }
      }
    }
  }

  private async ensureSession(syncState: SyncState): Promise<SyncState> {
    if (syncState.authToken && syncState.userId && syncState.accessTokenExpiresAt && new Date(syncState.accessTokenExpiresAt).getTime() > Date.now() + 30_000) {
      return syncState
    }
    const nextDeviceId = syncState.deviceId ?? this.config.deviceId ?? createDeviceId()
    if (!syncState.refreshToken || !syncState.userId) throw new Error('Sign in is required before synchronization.')
    const response = await this.requestJson('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: syncState.refreshToken, deviceId: nextDeviceId })
    })
    if (
      !isRecordObject(response) ||
      typeof response.accessToken !== 'string' ||
      typeof response.refreshToken !== 'string' ||
      !isRecordObject(response.session) ||
      typeof response.session.expiresAt !== 'string' ||
      !isRecordObject(response.user) ||
      typeof response.user.id !== 'string' ||
      typeof response.user.email !== 'string' ||
      response.authMode !== 'password'
    ) {
      throw new Error('Invalid backend session response.')
    }
    return {
      ...syncState,
      deviceId: nextDeviceId,
      authToken: response.accessToken,
      refreshToken: response.refreshToken,
      accessTokenExpiresAt: response.session.expiresAt,
      userId: response.user.id,
      accountEmail: response.user.email,
      authMode: response.authMode,
      lastError: null
    }
  }

  private async authenticate(syncState: SyncState, path: '/api/auth/login' | '/api/auth/register', email: string, password: string): Promise<SyncState> {
    const deviceId = syncState.deviceId ?? this.config.deviceId ?? createDeviceId()
    const response = await this.requestJson(path, {
      method: 'POST',
      body: JSON.stringify({ email, password, deviceId, label: 'MoneyWise mobile sync' })
    })
    if (!isRecordObject(response) || typeof response.accessToken !== 'string' || typeof response.refreshToken !== 'string' || !isRecordObject(response.session) || typeof response.session.expiresAt !== 'string' || !isRecordObject(response.user) || typeof response.user.id !== 'string' || typeof response.user.email !== 'string') {
      throw new Error('Invalid backend session response.')
    }
    return {
      ...syncState,
      deviceId,
      authToken: response.accessToken,
      refreshToken: response.refreshToken,
      accessTokenExpiresAt: response.session.expiresAt,
      userId: response.user.id,
      accountEmail: response.user.email,
      authMode: 'password',
      cursor: null,
      bootstrapCompleted: false,
      lastSyncAt: null,
      lastError: null,
      pendingPush: null,
      manifest: {}
    }
  }

  private async bootstrap(financeState: FinanceState, syncState: SyncState): Promise<{ financeState: FinanceState; syncState: SyncState }> {
    const response = await this.requestJson('/api/sync/bootstrap', { method: 'GET' }, syncState.authToken)
    const parsed = parseBootstrapPayload(response)
    const localIndex = buildSyncableStateIndex(financeState)
    const nextManifest = { ...syncState.manifest }
    const importedKeys = new Set<string>()
    const recordsToApply: RemoteSyncRecord[] = []

    parsed.order.forEach((entityType) => {
      ;(parsed.records[entityType] ?? []).forEach((entry) => {
        const key = buildSyncRecordKey(entityType, entry.recordId)
        const localRecord = localIndex.get(key)
        const localHash = localRecord ? hashPayload(localRecord.payload) : null
        const remoteHash = entry.deletedAt ? null : hashPayload(entry.payload)
        const shouldImportRecord =
          !entry.deletedAt &&
          (!localRecord || (entityType === 'settings' && !nextManifest[key] && localHash === DEFAULT_SETTINGS_HASH))
        if (shouldImportRecord) {
          importedKeys.add(key)
          recordsToApply.push(entry)
        }
        nextManifest[key] = {
          entityType,
          recordId: entry.recordId,
          lastSyncedHash: localHash === remoteHash ? localHash : shouldImportRecord ? remoteHash : nextManifest[key]?.lastSyncedHash ?? null,
          remoteVersion: entry.version,
          updatedAt: entry.updatedAt,
          deletedAt: entry.deletedAt
        }
      })
    })

    const nextFinanceState = recordsToApply.length > 0 ? applyRemoteSyncChanges(financeState, recordsToApply) : financeState
    recordsToApply.forEach((entry) => {
      const key = buildSyncRecordKey(entry.entityType, entry.recordId)
      if (!importedKeys.has(key)) {
        return
      }
      nextManifest[key] = createManifestEntry(entry, mapAppliedHash(nextFinanceState, entry.entityType, entry.recordId, entry.deletedAt))
    })

    return {
      financeState: nextFinanceState,
      syncState: {
        ...syncState,
        cursor: parsed.cursor,
        bootstrapCompleted: true,
        manifest: nextManifest
      }
    }
  }

  private async pullChanges(financeState: FinanceState, syncState: SyncState): Promise<{ financeState: FinanceState; syncState: SyncState }> {
    const response = await this.requestJson(
      `/api/sync/changes?since=${encodeURIComponent(syncState.cursor ?? DEFAULT_CURSOR)}`,
      { method: 'GET' },
      syncState.authToken
    )
    const parsed = parseChangesPayload(response)
    if (parsed.changes.length === 0) {
      const result = {
        financeState,
        syncState: {
          ...syncState,
          cursor: parsed.cursor
        }
      }
      return parsed.hasMore ? this.pullChanges(result.financeState, result.syncState) : result
    }

    const localIndex = buildSyncableStateIndex(financeState)
    const pendingLocal = this.collectPendingLocalChanges(financeState, syncState.manifest)
    const pendingKeys = new Set(pendingLocal.map((entry) => buildSyncRecordKey(entry.entityType, entry.recordId)))
    const nextManifest = { ...syncState.manifest }
    const recordsToApply: RemoteSyncRecord[] = []

    sortRemoteChanges(parsed.changes).forEach((change) => {
      const key = buildSyncRecordKey(change.entityType, change.recordId)
      const manifestEntry = nextManifest[key]
      if (pendingKeys.has(key)) {
        nextManifest[key] = {
          entityType: change.entityType,
          recordId: change.recordId,
          lastSyncedHash: manifestEntry?.lastSyncedHash ?? null,
          remoteVersion: change.version,
          updatedAt: change.updatedAt,
          deletedAt: change.deletedAt
        }
        return
      }
      const localRecord = localIndex.get(key)
      const localHash = localRecord ? hashPayload(localRecord.payload) : null
      if (!change.deletedAt && localRecord && manifestEntry?.lastSyncedHash === localHash && manifestEntry.remoteVersion === change.version) {
        return
      }
      recordsToApply.push(change)
    })

    const nextFinanceState = recordsToApply.length > 0 ? applyRemoteSyncChanges(financeState, recordsToApply) : financeState
    recordsToApply.forEach((change) => {
      const key = buildSyncRecordKey(change.entityType, change.recordId)
      nextManifest[key] = createManifestEntry(change, mapAppliedHash(nextFinanceState, change.entityType, change.recordId, change.deletedAt))
    })

    const result = {
      financeState: nextFinanceState,
      syncState: {
        ...syncState,
        cursor: parsed.cursor,
        manifest: nextManifest
      }
    }
    return parsed.hasMore ? this.pullChanges(result.financeState, result.syncState) : result
  }

  private async pushLocalChanges(financeState: FinanceState, syncState: SyncState): Promise<{ financeState: FinanceState; syncState: SyncState }> {
    const deviceId = syncState.deviceId ?? this.config.deviceId ?? createDeviceId()
    const pendingChanges = this.collectPendingLocalChanges(financeState, syncState.manifest)
    if (pendingChanges.length === 0 && !syncState.pendingPush) {
      return {
        financeState,
        syncState: {
          ...syncState,
          deviceId
        }
      }
    }

    const pendingPush = syncState.pendingPush ?? (() => {
      const requestId = createRequestId()
      return { requestId, body: JSON.stringify({ deviceId, requestId, changes: pendingChanges.map((change) => ({
        entityType: change.entityType, recordId: change.recordId, payload: change.payload, deletedAt: change.deletedAt,
        updatedAt: new Date().toISOString(), lastModifiedByDeviceId: deviceId, baseVersion: change.baseVersion
      })) }) }
    })()
    let response: unknown
    try {
      response = await this.requestJson('/api/sync/push', { method: 'POST', body: pendingPush.body }, syncState.authToken)
    } catch (error) {
      throw new PendingPushError(error instanceof Error ? error.message : 'Sync push failed', financeState, { ...syncState, deviceId, pendingPush })
    }

    const parsed = parsePushResponse(response)
    const sent = JSON.parse(pendingPush.body) as { changes: PendingSyncChange[] }
    const sentByKey = new Map(sent.changes.map((change) => [buildSyncRecordKey(change.entityType, change.recordId), change]))
    const nextManifest = { ...syncState.manifest }
    const nextCursor = syncState.cursor ?? DEFAULT_CURSOR

    parsed.applied.forEach((entry) => {
      const key = buildSyncRecordKey(entry.entityType, entry.recordId)
      nextManifest[key] = {
        entityType: entry.entityType,
        recordId: entry.recordId,
        lastSyncedHash: entry.deletedAt ? null : sentByKey.get(key)?.payload ? hashPayload(sentByKey.get(key)!.payload) : mapAppliedHash(financeState, entry.entityType, entry.recordId, entry.deletedAt),
        remoteVersion: entry.version,
        updatedAt: entry.updatedAt,
        deletedAt: entry.deletedAt
      }
    })

    parsed.conflicts.forEach((entry) => {
      const key = buildSyncRecordKey(entry.entityType, entry.recordId)
      nextManifest[key] = {
        entityType: entry.entityType,
        recordId: entry.recordId,
        lastSyncedHash: nextManifest[key]?.lastSyncedHash ?? null,
        remoteVersion: entry.version,
        updatedAt: entry.updatedAt,
        deletedAt: entry.deletedAt
      }
    })

    return {
      financeState,
      syncState: {
        ...syncState,
        deviceId,
        cursor: nextCursor,
        pendingPush: null,
        manifest: nextManifest
      }
    }
  }

  private collectPendingLocalChanges(financeState: FinanceState, manifest: Record<string, SyncManifestEntry>): PendingSyncChange[] {
    const index = buildSyncableStateIndex(financeState)
    const pending: PendingSyncChange[] = []

    index.forEach((record, key) => {
      const manifestEntry = manifest[key]
      const localHash = hashPayload(record.payload)
      if (!manifestEntry || manifestEntry.deletedAt || manifestEntry.lastSyncedHash !== localHash) {
        pending.push({
          entityType: record.entityType,
          recordId: record.recordId,
          payload: record.payload,
          deletedAt: null,
          baseVersion: manifestEntry?.remoteVersion
        })
      }
    })

    Object.entries(manifest).forEach(([key, entry]) => {
      if (entry.deletedAt || index.has(key)) {
        return
      }
      pending.push({
        entityType: entry.entityType,
        recordId: entry.recordId,
        payload: {},
        deletedAt: new Date().toISOString(),
        baseVersion: entry.remoteVersion
      })
    })

    return pending
  }

  private async requestJson(path: string, init: RequestInit, authToken?: string | null): Promise<unknown> {
    if (!this.config.backendUrl) {
      throw new Error('Sync backend URL is missing.')
    }
    const response = await fetch(new URL(path, this.config.backendUrl), {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(init.headers ?? {})
      }
    })
    const text = await response.text()
    const payload = text ? JSON.parse(text) : null
    if (!response.ok) {
      const backendMessage =
        isRecordObject(payload) && typeof payload.error === 'string' && payload.error ? payload.error : `Sync request failed with ${response.status}`
      throw new Error(`[${response.status}] ${backendMessage}`)
    }
    return payload
  }
}
