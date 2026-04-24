import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DesktopSyncStateData, SyncManifestEntry } from './sync-types'

const EMPTY_STATE: DesktopSyncStateData = {
  deviceId: null,
  authToken: null,
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
    userId: typeof raw.userId === 'string' && raw.userId ? raw.userId : null,
    accountEmail: typeof raw.accountEmail === 'string' && raw.accountEmail ? raw.accountEmail : null,
    authMode: raw.authMode === 'dev-session' || raw.authMode === 'password' ? raw.authMode : null,
    cursor: typeof raw.cursor === 'string' && raw.cursor ? raw.cursor : null,
    bootstrapCompleted: raw.bootstrapCompleted === true,
    paused: raw.paused === true,
    lastSyncAt: typeof raw.lastSyncAt === 'string' && raw.lastSyncAt ? raw.lastSyncAt : null,
    lastError: typeof raw.lastError === 'string' && raw.lastError ? raw.lastError : null,
    manifest
  }
}

export class DesktopSyncStateStore {
  constructor(private readonly filePath: string) {}

  read(): DesktopSyncStateData {
    if (!existsSync(this.filePath)) {
      return { ...EMPTY_STATE }
    }
    try {
      return normalizeState(JSON.parse(readFileSync(this.filePath, 'utf8')))
    } catch {
      return { ...EMPTY_STATE }
    }
  }

  write(next: DesktopSyncStateData): DesktopSyncStateData {
    const directory = dirname(this.filePath)
    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: true })
    }
    writeFileSync(this.filePath, JSON.stringify(next, null, 2), 'utf8')
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
