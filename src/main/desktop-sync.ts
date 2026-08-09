import { createHash, randomUUID } from 'node:crypto'
import type { SyncStatusSnapshot } from '@shared/contracts'
import type { FinanceDomainState } from '@shared/domain'
import { defaultSettings } from '../shared/defaults'
import { syncPayloadSchemas } from '../shared/validation'
import type { DesktopSyncConfig } from './sync-config'
import { DesktopSyncStateStore } from './desktop-sync-state'
import type { FinanceDatabase } from './database'
import {
  SYNC_ENTITY_ORDER,
  buildSyncableStateIndex,
  createSyncRecordKey,
  type DesktopSyncStateData,
  type PendingSyncChange,
  type RemoteBootstrapPayload,
  type RemoteBootstrapRecord,
  type RemoteChangesPayload,
  type RemoteSyncRecord,
  type SyncEntityType,
  type SyncManifestEntry,
  type SyncableLocalRecord
} from './sync-types'

type Logger = (message: string, detail?: unknown) => void

interface SessionResponse {
  accessToken: string
  refreshToken: string
  accessTokenExpiresAt: string
  userId: string
  email: string
  authMode: 'password'
}

interface PushAppliedRecord {
  entityType: SyncEntityType
  recordId: string
  version: number
  updatedAt: string
  deletedAt: string | null
}

interface PushConflictRecord {
  entityType: SyncEntityType
  recordId: string
  version: number
  updatedAt: string | null
  deletedAt: string | null
}

const DEFAULT_CURSOR = '0'
const SYNC_ENTITY_SET = new Set<SyncEntityType>(SYNC_ENTITY_ORDER)
const DEFAULT_SETTINGS_HASH = hashPayload(defaultSettings as unknown as Record<string, unknown>)

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  }
  const objectValue = value as Record<string, unknown>
  return `{${Object.keys(objectValue)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`)
    .join(',')}}`
}

function hashPayload(payload: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex')
}

function normalizeSyncEntityType(value: unknown): SyncEntityType | null {
  return typeof value === 'string' && SYNC_ENTITY_SET.has(value as SyncEntityType) ? (value as SyncEntityType) : null
}

function normalizeRemoteChange(value: unknown, entityTypeOverride?: SyncEntityType): RemoteSyncRecord | null {
  if (!isRecordObject(value)) {
    return null
  }
  const entityType = entityTypeOverride ?? normalizeSyncEntityType(value.entityType)
  const recordId = typeof value.recordId === 'string' && value.recordId ? value.recordId : typeof value.id === 'string' && value.id ? value.id : null
  const updatedAt = typeof value.updatedAt === 'string' && value.updatedAt ? value.updatedAt : null
  const version = typeof value.version === 'number' && Number.isFinite(value.version) ? value.version : null
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

function parseBootstrapPayload(value: unknown): RemoteBootstrapPayload {
  if (!isRecordObject(value)) {
    return {
      order: [...SYNC_ENTITY_ORDER],
      cursor: DEFAULT_CURSOR,
      records: {}
    }
  }
  const order = Array.isArray(value.order)
    ? value.order.map((entry) => normalizeSyncEntityType(entry)).filter((entry): entry is SyncEntityType => Boolean(entry))
    : [...SYNC_ENTITY_ORDER]
  const rawRecords = isRecordObject(value.records) ? value.records : {}
  const records = Object.fromEntries(
    Object.entries(rawRecords)
      .map(([entityType, entries]) => {
        const normalizedEntityType = normalizeSyncEntityType(entityType)
        if (!normalizedEntityType || !Array.isArray(entries)) {
          return null
        }
        const normalizedEntries = entries
          .map((entry) => normalizeRemoteChange(entry, normalizedEntityType))
          .filter((entry): entry is RemoteBootstrapRecord & RemoteSyncRecord => Boolean(entry))
          .map((entry) => ({
            id: entry.recordId,
            payload: entry.payload,
            createdAt: entry.createdAt ?? entry.updatedAt,
            updatedAt: entry.updatedAt,
            deletedAt: entry.deletedAt,
            version: entry.version,
            lastModifiedByDeviceId: entry.lastModifiedByDeviceId
          }))
        return [normalizedEntityType, normalizedEntries]
      })
      .filter((entry): entry is [SyncEntityType, RemoteBootstrapRecord[]] => Boolean(entry))
  ) as RemoteBootstrapPayload['records']

  return {
    order: order.length > 0 ? order : [...SYNC_ENTITY_ORDER],
    cursor: typeof value.cursor === 'string' && value.cursor ? value.cursor : DEFAULT_CURSOR,
    records
  }
}

function parseChangesPayload(value: unknown): RemoteChangesPayload {
  if (!isRecordObject(value)) {
    return { cursor: DEFAULT_CURSOR, changes: [] }
  }
  return {
    cursor: typeof value.cursor === 'string' && value.cursor ? value.cursor : DEFAULT_CURSOR,
    changes: Array.isArray(value.changes)
      ? value.changes.map((entry) => normalizeRemoteChange(entry)).filter((entry): entry is RemoteSyncRecord => Boolean(entry))
      : []
  }
}

function parseSessionResponse(value: unknown): SessionResponse | null {
  if (
    !isRecordObject(value) ||
    typeof value.accessToken !== 'string' ||
    typeof value.refreshToken !== 'string' ||
    !isRecordObject(value.session) ||
    typeof value.session.expiresAt !== 'string' ||
    !isRecordObject(value.user) ||
    typeof value.user.id !== 'string' ||
    typeof value.user.email !== 'string' ||
    value.authMode !== 'password'
  ) {
    return null
  }
  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    accessTokenExpiresAt: value.session.expiresAt,
    userId: value.user.id,
    email: value.user.email,
    authMode: value.authMode
  }
}

function parsePushResponse(value: unknown): { applied: PushAppliedRecord[]; conflicts: PushConflictRecord[] } {
  if (!isRecordObject(value)) {
    return { applied: [], conflicts: [] }
  }

  const applied = Array.isArray(value.applied)
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
          } satisfies PushAppliedRecord
        })
        .filter((entry): entry is PushAppliedRecord => Boolean(entry))
    : []

  const conflicts = Array.isArray(value.conflicts)
    ? value.conflicts
        .map((entry) => {
          if (!isRecordObject(entry)) return null
          const entityType = normalizeSyncEntityType(entry.entityType)
          const conflict = isRecordObject(entry.conflict) ? entry.conflict : null
          const current = conflict && isRecordObject(conflict.current) ? conflict.current : null
          if (!entityType || typeof entry.recordId !== 'string' || !current || typeof current.version !== 'number') {
            return null
          }
          return {
            entityType,
            recordId: entry.recordId,
            version: current.version,
            updatedAt: typeof current.updatedAt === 'string' ? current.updatedAt : null,
            deletedAt: typeof current.deletedAt === 'string' ? current.deletedAt : null
          } satisfies PushConflictRecord
        })
        .filter((entry): entry is PushConflictRecord => Boolean(entry))
    : []

  return { applied, conflicts }
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

function mapAppliedHash(record: SyncableLocalRecord | undefined, deletedAt: string | null): string | null {
  if (deletedAt || !record) {
    return null
  }
  return hashPayload(record.payload)
}

export class DesktopSyncManager {
  private syncTimer: NodeJS.Timeout | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private activeSync: Promise<void> | null = null
  private syncInFlight = false
  private syncQueued = false
  private backendReachable = false
  private phase: SyncStatusSnapshot['phase'] = 'disabled'
  private rendererReloadPending = false

  constructor(
    private readonly database: FinanceDatabase,
    private readonly stateStore: DesktopSyncStateStore,
    private readonly config: DesktopSyncConfig,
    private readonly log: Logger,
    private readonly reloadRendererAfterPull?: () => void
  ) {}

  start(): void {
    if (!this.config.enabled || !this.config.backendUrl) {
      this.phase = 'disabled'
      return
    }
    this.scheduleSync('startup')
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => {
        this.scheduleSync('poll')
      }, 7000)
    }
  }

  getStatus(): SyncStatusSnapshot {
    this.log('Desktop sync status requested')
    const persisted = this.stateStore.read()
    const enabled = this.config.enabled && Boolean(this.config.backendUrl)
    const effectiveEnabled = enabled && !persisted.paused
    const pendingChanges = effectiveEnabled ? this.collectPendingLocalChanges(this.database.getDomainState(), persisted.manifest).length : 0
    const status = {
      enabled,
      paused: persisted.paused,
      backendUrl: this.config.backendUrl,
      deviceId: persisted.deviceId,
      userId: persisted.userId,
      accountEmail: persisted.accountEmail,
      authMode: persisted.authMode,
      authenticated: Boolean(persisted.authToken && persisted.userId),
      backendReachable: effectiveEnabled ? this.backendReachable : false,
      bootstrapCompleted: persisted.bootstrapCompleted,
      pendingChanges,
      lastSyncAt: persisted.lastSyncAt,
      lastError: persisted.lastError,
      phase: enabled ? this.phase : 'disabled'
    }
    this.log('SYNC STATUS DEBUG', {
      enabled: status.enabled,
      paused: status.paused,
      backendUrl: status.backendUrl,
      connection: status.backendReachable,
      authMode: status.authMode,
      account: status.accountEmail,
      pendingChanges: status.pendingChanges
    })
    return status
  }

  async syncNow(): Promise<SyncStatusSnapshot> {
    const persisted = this.stateStore.read()
    const guard = {
      enabled: this.config.enabled,
      paused: persisted.paused,
      backendUrl: this.config.backendUrl,
      authToken: Boolean(persisted.authToken),
      syncInFlight: this.syncInFlight
    }
    this.log('SYNC NOW START', guard)
    if (!this.config.enabled || !this.config.backendUrl || persisted.paused) {
      this.log('SYNC NOW BLOCKED', guard)
      this.phase = !this.config.enabled || !this.config.backendUrl ? 'disabled' : 'idle'
      return this.getStatus()
    }
    if (this.activeSync) {
      this.log('SYNC NOW WAITING FOR ACTIVE SYNC', guard)
      await this.activeSync.catch(() => undefined)
    }
    await this.runSync('manual')
    return this.getStatus()
  }

  async login(email: string, password: string): Promise<SyncStatusSnapshot> {
    return this.authenticate('/api/auth/login', email, password)
  }

  async register(email: string, password: string): Promise<SyncStatusSnapshot> {
    return this.authenticate('/api/auth/register', email, password)
  }

  async logout(): Promise<SyncStatusSnapshot> {
    const current = this.stateStore.read()
    if (current.authToken) {
      try {
        await this.requestJson('/api/auth/logout', { method: 'POST' }, current.authToken)
      } catch {
        // Local logout must succeed even if the backend is offline.
      }
    }
    this.stateStore.write({
      ...current,
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
      manifest: {}
    })
    this.phase = this.config.enabled ? 'idle' : 'disabled'
    return this.getStatus()
  }

  async uploadAllLocalData(): Promise<SyncStatusSnapshot> {
    if (!this.config.enabled || !this.config.backendUrl || this.syncInFlight) {
      return this.getStatus()
    }

    this.syncInFlight = true
    this.phase = 'syncing'
    this.log('Desktop full upload requested', {
      pendingLocal: this.collectPendingLocalChanges(this.database.getDomainState(), this.stateStore.read().manifest).length
    })
    try {
      const deviceId = this.stateStore.getOrCreateDeviceId(this.config.deviceId)
      await this.checkHealth()
      let syncState = await this.ensureSession(deviceId)
      if (!syncState.bootstrapCompleted) {
        syncState = await this.bootstrap(syncState)
      }
      syncState = await this.pullChanges(syncState)
      syncState = await this.forceUploadAllLocalRecords(syncState, deviceId)
      this.stateStore.update((state) => ({
        ...state,
        lastSyncAt: new Date().toISOString(),
        lastError: null
      }))
      this.phase = 'idle'
      this.log('Desktop full upload completed', {
        cursor: syncState.cursor,
        pendingLocal: this.collectPendingLocalChanges(this.database.getDomainState(), syncState.manifest).length
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.backendReachable = false
      this.stateStore.update((state) => ({
        ...state,
        authToken: message.includes('[401]') ? null : state.authToken,
        lastError: message
      }))
      this.phase = 'error'
      this.log('Desktop full upload failed', { error: message })
    } finally {
      this.syncInFlight = false
    }

    return this.getStatus()
  }

  setPaused(paused: boolean): SyncStatusSnapshot {
    const nextState = this.stateStore.update((state) => ({
      ...state,
      paused,
      lastError: paused ? null : state.lastError
    }))
    if (paused && this.syncTimer) {
      clearTimeout(this.syncTimer)
      this.syncTimer = null
    }
    this.phase = !this.config.enabled || !this.config.backendUrl ? 'disabled' : paused ? 'idle' : this.phase
    if (!paused) {
      this.scheduleSync('resume')
    }
    return {
      ...this.getStatus(),
      paused: nextState.paused
    }
  }

  scheduleSync(reason: string): void {
    const persisted = this.stateStore.read()
    if (!this.config.enabled || !this.config.backendUrl || persisted.paused) {
      return
    }
    if (this.syncInFlight) {
      this.syncQueued = true
      return
    }
    if (this.syncTimer) {
      clearTimeout(this.syncTimer)
    }
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null
      void this.runSync(reason)
    }, 750)
  }

  private async runSync(reason: string): Promise<void> {
    const currentState = this.stateStore.read()
    const guard = {
      reason,
      enabled: this.config.enabled,
      paused: currentState.paused,
      backendUrl: this.config.backendUrl,
      authToken: Boolean(currentState.authToken),
      syncInFlight: this.syncInFlight
    }
    if (!this.config.enabled || !this.config.backendUrl || currentState.paused || this.syncInFlight) {
      this.log('SYNC RUN BLOCKED', guard)
      return
    }

    this.syncInFlight = true
    this.phase = 'syncing'
    this.activeSync = (async () => {
      const deviceId = this.stateStore.getOrCreateDeviceId(this.config.deviceId)
      await this.checkHealth()
      let syncState = await this.ensureSession(deviceId)
      if (!syncState.bootstrapCompleted) {
        syncState = await this.bootstrap(syncState)
      }
      this.log('SYNC PULL START')
      syncState = await this.pullChanges(syncState)
      this.log('SYNC PULL SUCCESS')
      this.log('SYNC PUSH START')
      syncState = await this.pushLocalChanges(syncState, deviceId)
      this.log('SYNC PUSH SUCCESS')
      this.stateStore.update((state) => ({
        ...state,
        lastSyncAt: new Date().toISOString(),
        lastError: null
      }))
      this.phase = 'idle'
      this.log('SYNC COMPLETE', { reason })
    })()

    try {
      await this.activeSync
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.backendReachable = false
      this.stateStore.update((state) => ({
        ...state,
        authToken: message.includes('[401]') ? null : state.authToken,
        lastError: message
      }))
      this.phase = 'error'
      this.log('Desktop sync skipped', {
        reason,
        error: message
      })
    } finally {
      this.activeSync = null
      this.syncInFlight = false
      if (this.rendererReloadPending) {
        this.rendererReloadPending = false
        setTimeout(() => this.reloadRendererAfterPull?.(), 0)
      }
      if (this.syncQueued) {
        this.syncQueued = false
        this.scheduleSync('queued')
      }
    }
  }

  private async checkHealth(): Promise<void> {
    await this.requestJson('/health', { method: 'GET' })
    this.backendReachable = true
  }

  private async ensureSession(deviceId: string): Promise<DesktopSyncStateData> {
    const current = this.stateStore.read()
    if (current.authToken && current.userId && current.accessTokenExpiresAt && new Date(current.accessTokenExpiresAt).getTime() > Date.now() + 30_000) {
      return current
    }
    if (!current.refreshToken || !current.userId) {
      throw new Error('Sign in is required before synchronization.')
    }
    const response = await this.requestJson('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: current.refreshToken, deviceId })
    })
    const parsed = parseSessionResponse(response)
    if (!parsed) {
      throw new Error('Sync backend returned an invalid session response.')
    }

    return this.stateStore.update((state) => ({
      ...state,
      deviceId,
      authToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      accessTokenExpiresAt: parsed.accessTokenExpiresAt,
      userId: parsed.userId,
      accountEmail: parsed.email,
      authMode: parsed.authMode,
      lastError: null
    }))
  }

  private async authenticate(path: '/api/auth/login' | '/api/auth/register', email: string, password: string): Promise<SyncStatusSnapshot> {
    if (!this.config.enabled || !this.config.backendUrl) throw new Error('Sync backend is not configured.')
    const deviceId = this.stateStore.getOrCreateDeviceId(this.config.deviceId)
    const response = await this.requestJson(path, {
      method: 'POST',
      body: JSON.stringify({ email, password, deviceId, label: 'MoneyWise desktop sync' })
    })
    const parsed = parseSessionResponse(response)
    if (!parsed) throw new Error('Sync backend returned an invalid session response.')
    const current = this.stateStore.read()
    this.stateStore.write({
      ...current,
      authToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      accessTokenExpiresAt: parsed.accessTokenExpiresAt,
      userId: parsed.userId,
      accountEmail: parsed.email,
      authMode: 'password',
      cursor: null,
      bootstrapCompleted: false,
      lastSyncAt: null,
      lastError: null,
      manifest: {}
    })
    this.phase = 'idle'
    return this.getStatus()
  }

  private async bootstrap(syncState: DesktopSyncStateData): Promise<DesktopSyncStateData> {
    const response = await this.requestJson('/api/sync/bootstrap', { method: 'GET' }, syncState.authToken)
    const parsed = parseBootstrapPayload(response)
    const localIndex = buildSyncableStateIndex(this.database.getDomainState())
    const recordsToApply: RemoteSyncRecord[] = []
    const nextManifest = { ...syncState.manifest }
    const importedKeys = new Set<string>()

    parsed.order.forEach((entityType) => {
      ;(parsed.records[entityType] ?? []).forEach((entry) => {
        const key = createSyncRecordKey(entityType, entry.id)
        const localRecord = localIndex.records.get(key)
        const localHash = localRecord ? hashPayload(localRecord.payload) : null
        const remoteHash = entry.deletedAt ? null : hashPayload(entry.payload)
        const shouldImportRecord =
          !entry.deletedAt &&
          (!localRecord || (entityType === 'settings' && !nextManifest[key] && localHash === DEFAULT_SETTINGS_HASH))
        if (shouldImportRecord) {
          importedKeys.add(key)
          recordsToApply.push({
            entityType,
            recordId: entry.id,
            payload: entry.payload,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            deletedAt: entry.deletedAt,
            version: entry.version,
            lastModifiedByDeviceId: entry.lastModifiedByDeviceId
          })
        }
        nextManifest[key] = {
          entityType,
          recordId: entry.id,
          lastSyncedHash: localHash === remoteHash ? localHash : shouldImportRecord ? remoteHash : nextManifest[key]?.lastSyncedHash ?? null,
          remoteVersion: entry.version,
          updatedAt: entry.updatedAt,
          deletedAt: entry.deletedAt
        }
      })
    })

    if (recordsToApply.length > 0) {
      this.database.applyRemoteSyncChanges(sortRemoteChanges(recordsToApply))
      this.rendererReloadPending = true
      const refreshedIndex = buildSyncableStateIndex(this.database.getDomainState())
      recordsToApply.forEach((entry) => {
        const key = createSyncRecordKey(entry.entityType, entry.recordId)
        if (!importedKeys.has(key)) {
          return
        }
        nextManifest[key] = createManifestEntry(entry, mapAppliedHash(refreshedIndex.records.get(key), entry.deletedAt))
      })
    }

    return this.stateStore.write({
      ...syncState,
      cursor: parsed.cursor,
      bootstrapCompleted: true,
      manifest: nextManifest
    })
  }

  private async pullChanges(syncState: DesktopSyncStateData): Promise<DesktopSyncStateData> {
    const response = await this.requestJson(
      `/api/sync/changes?since=${encodeURIComponent(syncState.cursor ?? DEFAULT_CURSOR)}`,
      { method: 'GET' },
      syncState.authToken
    )
    const parsed = parseChangesPayload(response)
    if (parsed.changes.length === 0) {
      return this.stateStore.write({
        ...syncState,
        cursor: parsed.cursor
      })
    }

    const currentState = this.database.getDomainState()
    const localIndex = buildSyncableStateIndex(currentState)
    const pendingLocal = this.collectPendingLocalChanges(currentState, syncState.manifest)
    const pendingKeys = new Set(pendingLocal.map((entry) => createSyncRecordKey(entry.entityType, entry.recordId)))
    const recordsToApply: RemoteSyncRecord[] = []
    const nextManifest = { ...syncState.manifest }

    sortRemoteChanges(parsed.changes).forEach((change) => {
      const key = createSyncRecordKey(change.entityType, change.recordId)
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
      const localRecord = localIndex.records.get(key)
      const localHash = localRecord ? hashPayload(localRecord.payload) : null
      if (!change.deletedAt && localRecord && manifestEntry?.lastSyncedHash === localHash && manifestEntry.remoteVersion === change.version) {
        return
      }
      recordsToApply.push(change)
    })

    if (recordsToApply.length > 0) {
      this.database.applyRemoteSyncChanges(recordsToApply)
      this.rendererReloadPending = true
    }

    const refreshedIndex = buildSyncableStateIndex(this.database.getDomainState())
    recordsToApply.forEach((change) => {
      const key = createSyncRecordKey(change.entityType, change.recordId)
      nextManifest[key] = createManifestEntry(change, mapAppliedHash(refreshedIndex.records.get(key), change.deletedAt))
    })

    return this.stateStore.write({
      ...syncState,
      cursor: parsed.cursor,
      manifest: nextManifest
    })
  }

  private async forceUploadAllLocalRecords(syncState: DesktopSyncStateData, deviceId: string): Promise<DesktopSyncStateData> {
    const response = await this.requestJson('/api/sync/bootstrap', { method: 'GET' }, syncState.authToken)
    const parsed = parseBootstrapPayload(response)
    const remoteMap = new Map<string, RemoteSyncRecord>()
    parsed.order.forEach((entityType) => {
      ;(parsed.records[entityType] ?? []).forEach((entry) => {
        remoteMap.set(
          createSyncRecordKey(entityType, entry.id),
          {
            entityType,
            recordId: entry.id,
            payload: entry.payload,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            deletedAt: entry.deletedAt,
            version: entry.version,
            lastModifiedByDeviceId: entry.lastModifiedByDeviceId
          }
        )
      })
    })

    const localIndex = buildSyncableStateIndex(this.database.getDomainState())
    const forcedChanges: PendingSyncChange[] = []
    const nextManifest = { ...syncState.manifest }
    const nextCursor = parsed.cursor

    localIndex.keyOrder.forEach((key) => {
      const localRecord = localIndex.records.get(key)
      if (!localRecord) {
        return
      }
      const localHash = hashPayload(localRecord.payload)
      const remoteRecord = remoteMap.get(key)
      if (!remoteRecord) {
        forcedChanges.push({
          entityType: localRecord.entityType,
          recordId: localRecord.recordId,
          payload: localRecord.payload,
          deletedAt: null
        })
        return
      }

      if (!remoteRecord.deletedAt) {
        const remoteHash = hashPayload(remoteRecord.payload)
        if (remoteHash === localHash) {
          nextManifest[key] = {
            entityType: localRecord.entityType,
            recordId: localRecord.recordId,
            lastSyncedHash: localHash,
            remoteVersion: remoteRecord.version,
            updatedAt: remoteRecord.updatedAt,
            deletedAt: remoteRecord.deletedAt
          }
          return
        }
      }

      forcedChanges.push({
        entityType: localRecord.entityType,
        recordId: localRecord.recordId,
        payload: localRecord.payload,
        deletedAt: null,
        baseVersion: remoteRecord.version
      })
    })

    if (forcedChanges.length === 0) {
      this.log('Desktop full upload found no additional records', {
        scannedRecords: localIndex.keyOrder.length
      })
      return this.stateStore.write({
        ...syncState,
        cursor: nextCursor,
        bootstrapCompleted: true,
        manifest: nextManifest
      })
    }

    const pushResponse = await this.requestJson(
      '/api/sync/push',
      {
        method: 'POST',
        body: JSON.stringify({
          deviceId,
          requestId: randomUUID(),
          changes: forcedChanges.map((change) => ({
            entityType: change.entityType,
            recordId: change.recordId,
            payload: change.payload,
            deletedAt: change.deletedAt,
            updatedAt: new Date().toISOString(),
            lastModifiedByDeviceId: deviceId,
            baseVersion: change.baseVersion
          }))
        })
      },
      syncState.authToken
    )

    const parsedPush = parsePushResponse(pushResponse)
    this.log('Desktop full upload push executed', {
      scannedRecords: localIndex.keyOrder.length,
      uploadedRecords: forcedChanges.length,
      appliedRecords: parsedPush.applied.length,
      conflicts: parsedPush.conflicts.length
    })
    const refreshedIndex = buildSyncableStateIndex(this.database.getDomainState())

    parsedPush.applied.forEach((entry) => {
      const key = createSyncRecordKey(entry.entityType, entry.recordId)
      nextManifest[key] = {
        entityType: entry.entityType,
        recordId: entry.recordId,
        lastSyncedHash: mapAppliedHash(refreshedIndex.records.get(key), entry.deletedAt),
        remoteVersion: entry.version,
        updatedAt: entry.updatedAt,
        deletedAt: entry.deletedAt
      }
    })

    parsedPush.conflicts.forEach((entry) => {
      const key = createSyncRecordKey(entry.entityType, entry.recordId)
      const current = nextManifest[key]
      nextManifest[key] = {
        entityType: entry.entityType,
        recordId: entry.recordId,
        lastSyncedHash: current?.lastSyncedHash ?? null,
        remoteVersion: entry.version,
        updatedAt: entry.updatedAt,
        deletedAt: entry.deletedAt
      }
    })

    if (parsedPush.conflicts.length > 0) {
      this.log('Desktop full upload conflicts detected', { count: parsedPush.conflicts.length })
    }

    return this.stateStore.write({
      ...syncState,
      cursor: nextCursor,
      bootstrapCompleted: true,
      manifest: nextManifest
    })
  }

  private async pushLocalChanges(syncState: DesktopSyncStateData, deviceId: string): Promise<DesktopSyncStateData> {
    const pendingChanges = this.collectPendingLocalChanges(this.database.getDomainState(), syncState.manifest)
    this.log('SYNC PUSH DIRTY CHECK', {
      pendingChanges: pendingChanges.length,
      manifestEntries: Object.keys(syncState.manifest).length
    })
    if (pendingChanges.length === 0) {
      return syncState
    }

    const response = await this.requestJson(
      '/api/sync/push',
      {
        method: 'POST',
        body: JSON.stringify({
          deviceId,
          requestId: randomUUID(),
          changes: pendingChanges.map((change) => ({
            entityType: change.entityType,
            recordId: change.recordId,
            payload: change.payload,
            deletedAt: change.deletedAt,
            updatedAt: new Date().toISOString(),
            lastModifiedByDeviceId: deviceId,
            baseVersion: change.baseVersion
          }))
        })
      },
      syncState.authToken
    )

    const parsed = parsePushResponse(response)
    const refreshedIndex = buildSyncableStateIndex(this.database.getDomainState())
    const nextManifest = { ...syncState.manifest }
    const nextCursor = syncState.cursor ?? DEFAULT_CURSOR

    parsed.applied.forEach((entry) => {
      const key = createSyncRecordKey(entry.entityType, entry.recordId)
      nextManifest[key] = {
        entityType: entry.entityType,
        recordId: entry.recordId,
        lastSyncedHash: mapAppliedHash(refreshedIndex.records.get(key), entry.deletedAt),
        remoteVersion: entry.version,
        updatedAt: entry.updatedAt,
        deletedAt: entry.deletedAt
      }
    })

    parsed.conflicts.forEach((entry) => {
      const key = createSyncRecordKey(entry.entityType, entry.recordId)
      const current = nextManifest[key]
      nextManifest[key] = {
        entityType: entry.entityType,
        recordId: entry.recordId,
        lastSyncedHash: current?.lastSyncedHash ?? null,
        remoteVersion: entry.version,
        updatedAt: entry.updatedAt,
        deletedAt: entry.deletedAt
      }
    })

    const nextState = this.stateStore.write({
      ...syncState,
      cursor: nextCursor,
      manifest: nextManifest
    })

    if (parsed.conflicts.length > 0) {
      this.log('Desktop sync conflicts detected', {
        count: parsed.conflicts.length
      })
    }

    return nextState
  }

  private collectPendingLocalChanges(state: FinanceDomainState, manifest: Record<string, SyncManifestEntry>): PendingSyncChange[] {
    const localIndex = buildSyncableStateIndex(state)
    const pendingChanges: PendingSyncChange[] = []

    localIndex.keyOrder.forEach((key) => {
      const localRecord = localIndex.records.get(key)
      if (!localRecord) {
        return
      }
      const manifestEntry = manifest[key]
      const localHash = hashPayload(localRecord.payload)
      if (!manifestEntry || manifestEntry.deletedAt || manifestEntry.lastSyncedHash !== localHash) {
        pendingChanges.push({
          entityType: localRecord.entityType,
          recordId: localRecord.recordId,
          payload: localRecord.payload,
          deletedAt: null,
          baseVersion: manifestEntry?.remoteVersion
        })
      }
    })

    Object.entries(manifest).forEach(([key, manifestEntry]) => {
      if (manifestEntry.deletedAt || localIndex.records.has(key)) {
        return
      }
      pendingChanges.push({
        entityType: manifestEntry.entityType,
        recordId: manifestEntry.recordId,
        payload: {},
        deletedAt: new Date().toISOString(),
        baseVersion: manifestEntry.remoteVersion
      })
    })

    return pendingChanges
  }

  private async requestJson(path: string, init: RequestInit, authToken?: string | null): Promise<unknown> {
    if (!this.config.backendUrl) {
      throw new Error('Desktop sync is not configured.')
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
        isRecordObject(payload) && typeof payload.error === 'string' && payload.error
          ? payload.error
          : `Sync request failed with ${response.status}`
      throw new Error(`[${response.status}] ${backendMessage}`)
    }
    return payload
  }
}
