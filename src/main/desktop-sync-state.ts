import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
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
  private activeFilePath: string
  private readonly legacyFilePath: string
  private readonly metadataPath: string

  constructor(filePath: string, private readonly tokenProtector: TokenProtector) {
    this.legacyFilePath = filePath
    this.metadataPath = join(dirname(filePath), 'profile-state.v2.json')
    this.activeFilePath = filePath
    const legacy = this.readFile(filePath)
    if (!existsSync(this.metadataPath) && legacy.userId) {
      const profilePath = this.profilePath(legacy.userId)
      if (!existsSync(profilePath)) this.writeFile(profilePath, legacy)
      this.writeMetadata(legacy.userId)
    } else if (!existsSync(this.metadataPath)) {
      this.writeMetadata(null)
      if (!existsSync(this.legacyFilePath)) {
        const directory = dirname(this.legacyFilePath)
        if (!existsSync(directory)) mkdirSync(directory, { recursive: true })
        writeFileSync(this.legacyFilePath, JSON.stringify({ version: 2, state: 'unscoped-quarantined' }, null, 2), 'utf8')
      }
    }
    const activeUserId = this.readMetadata()
    this.activeFilePath = activeUserId ? this.profilePath(activeUserId) : this.localOnlyPath()
  }

  private profileId(userId: string): string {
    return createHash('sha256').update(`moneywise-desktop-profile:${userId}`).digest('hex')
  }

  private profilePath(userId: string): string {
    return join(dirname(this.legacyFilePath), 'profiles', this.profileId(userId), basename(this.legacyFilePath))
  }

  private localOnlyPath(): string {
    return join(dirname(this.legacyFilePath), 'quarantine', 'unscoped-sync-state.json')
  }

  getActiveUserId(): string | null {
    return this.read().userId
  }

  switchAccount(userId: string | null): DesktopSyncStateData {
    this.writeMetadata(userId)
    this.activeFilePath = userId ? this.profilePath(userId) : this.localOnlyPath()
    return this.read()
  }

  private readMetadata(): string | null {
    try {
      const value = JSON.parse(readFileSync(this.metadataPath, 'utf8')) as { activeUserId?: unknown }
      return typeof value.activeUserId === 'string' ? value.activeUserId : null
    } catch {
      return null
    }
  }

  private writeMetadata(userId: string | null): void {
    const directory = dirname(this.metadataPath)
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true })
    writeFileSync(this.metadataPath, JSON.stringify({ version: 2, activeUserId: userId }, null, 2), 'utf8')
  }

  read(): DesktopSyncStateData {
    return this.readFile(this.activeFilePath)
  }

  private readFile(filePath: string): DesktopSyncStateData {
    if (!existsSync(filePath)) {
      return { ...EMPTY_STATE }
    }
    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
      const decrypted = {
        ...raw,
        authToken: typeof raw.authTokenEncrypted === 'string' ? this.tokenProtector.decrypt(raw.authTokenEncrypted) : raw.authToken,
        refreshToken: typeof raw.refreshTokenEncrypted === 'string' ? this.tokenProtector.decrypt(raw.refreshTokenEncrypted) : raw.refreshToken
      }
      const state = normalizeState(decrypted)
      return state
    } catch {
      return { ...EMPTY_STATE }
    }
  }

  write(next: DesktopSyncStateData): DesktopSyncStateData {
    return this.writeFile(this.activeFilePath, next)
  }

  private writeFile(filePath: string, next: DesktopSyncStateData): DesktopSyncStateData {
    const directory = dirname(filePath)
    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: true })
    }
    const { authToken, refreshToken, ...persisted } = next
    writeFileSync(filePath, JSON.stringify({
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
