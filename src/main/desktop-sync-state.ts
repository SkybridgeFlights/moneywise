import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DesktopSyncStateData, SyncManifestEntry } from './sync-types'

export interface TokenProtector {
  encrypt(value: string): string
  decrypt(value: string): string
}

const EMPTY_STATE: DesktopSyncStateData = {
  deviceId: null,
  authToken: null,
  refreshToken: null,
  accessTokenExpiresAt: null,
  userId: null,
  accountEmail: null,
  authMode: null,
  cursor: null,
  bootstrapCompleted: false,
  paused: false,
  lastSyncAt: null,
  lastError: null,
  manifest: {}
}

function isManifestEntry(value: unknown): value is SyncManifestEntry {
  if (!value || typeof value !== 'object') {
    return false
  }
  const entry = value as Record<string, unknown>
  return (
    typeof entry.entityType === 'string' &&
    typeof entry.recordId === 'string' &&
    (typeof entry.lastSyncedHash === 'string' || entry.lastSyncedHash === null) &&
    typeof entry.remoteVersion === 'number' &&
    (typeof entry.updatedAt === 'string' || entry.updatedAt === null) &&
    (typeof entry.deletedAt === 'string' || entry.deletedAt === null)
  )
}

function normalizeState(value: unknown): DesktopSyncStateData {
  if (!value || typeof value !== 'object') {
    return { ...EMPTY_STATE }
  }
  const raw = value as Record<string, unknown>
  const manifestEntries = raw.manifest && typeof raw.manifest === 'object' ? (raw.manifest as Record<string, unknown>) : {}
  const manifest = Object.fromEntries(Object.entries(manifestEntries).filter(([, entry]) => isManifestEntry(entry))) as Record<string, SyncManifestEntry>
  return {
    deviceId: typeof raw.deviceId === 'string' && raw.deviceId ? raw.deviceId : null,
    authToken: typeof raw.authToken === 'string' && raw.authToken ? raw.authToken : null,
    refreshToken: typeof raw.refreshToken === 'string' && raw.refreshToken ? raw.refreshToken : null,
    accessTokenExpiresAt: typeof raw.accessTokenExpiresAt === 'string' && raw.accessTokenExpiresAt ? raw.accessTokenExpiresAt : null,
    userId: typeof raw.userId === 'string' && raw.userId ? raw.userId : null,
    accountEmail: typeof raw.accountEmail === 'string' && raw.accountEmail ? raw.accountEmail : null,
    authMode: raw.authMode === 'password' ? raw.authMode : null,
    cursor: typeof raw.cursor === 'string' && raw.cursor ? raw.cursor : null,
    bootstrapCompleted: raw.bootstrapCompleted === true,
    paused: raw.paused === true,
    lastSyncAt: typeof raw.lastSyncAt === 'string' && raw.lastSyncAt ? raw.lastSyncAt : null,
    lastError: typeof raw.lastError === 'string' && raw.lastError ? raw.lastError : null,
    manifest
  }
}

export class DesktopSyncStateStore {
  constructor(private readonly filePath: string, private readonly tokenProtector: TokenProtector) {}

  read(): DesktopSyncStateData {
    if (!existsSync(this.filePath)) {
      return { ...EMPTY_STATE }
    }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Record<string, unknown>
      const decrypted = {
        ...raw,
        authToken: typeof raw.authTokenEncrypted === 'string' ? this.tokenProtector.decrypt(raw.authTokenEncrypted) : raw.authToken,
        refreshToken: typeof raw.refreshTokenEncrypted === 'string' ? this.tokenProtector.decrypt(raw.refreshTokenEncrypted) : raw.refreshToken
      }
      const state = normalizeState(decrypted)
      if ((raw.authToken || raw.refreshToken) && (state.authToken || state.refreshToken)) this.write(state)
      return state
    } catch {
      return { ...EMPTY_STATE }
    }
  }

  write(next: DesktopSyncStateData): DesktopSyncStateData {
    const directory = dirname(this.filePath)
    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: true })
    }
    const { authToken, refreshToken, ...persisted } = next
    writeFileSync(this.filePath, JSON.stringify({
      ...persisted,
      authTokenEncrypted: authToken ? this.tokenProtector.encrypt(authToken) : null,
      refreshTokenEncrypted: refreshToken ? this.tokenProtector.encrypt(refreshToken) : null
    }, null, 2), 'utf8')
    return next
  }

  update(mutator: (current: DesktopSyncStateData) => DesktopSyncStateData): DesktopSyncStateData {
    const current = this.read()
    return this.write(mutator(current))
  }

  getOrCreateDeviceId(preferredDeviceId: string | null): string {
    const current = this.read()
    if (current.deviceId) {
      return current.deviceId
    }
    const nextDeviceId = preferredDeviceId?.trim() || `desktop-${randomUUID()}`
    this.write({
      ...current,
      deviceId: nextDeviceId
    })
    return nextDeviceId
  }
}
