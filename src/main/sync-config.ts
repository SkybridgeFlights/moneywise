import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface DesktopSyncConfig {
  enabled: boolean
  backendUrl: string | null
  deviceId: string | null
}

export interface DesktopSyncConfigDebug {
  enabledRaw: string | null
  enabledParsed: boolean
  backendUrl: string | null
  deviceId: string | null
}

function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {}
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      return
    }
    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex === -1) {
      return
    }
    const key = trimmed.slice(0, separatorIndex).trim()
    if (!key) {
      return
    }
    const rawValue = trimmed.slice(separatorIndex + 1).trim()
    const unquoted =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue
    values[key] = unquoted
  })
  return values
}

function loadDesktopEnvFileValues(): Record<string, string> {
  const candidates = ['.env', '.env.local', '.env.backend', '.env.backend.local']
  const merged: Record<string, string> = {}
  candidates.forEach((filename) => {
    const filePath = join(process.cwd(), filename)
    if (!existsSync(filePath)) {
      return
    }
    try {
      Object.assign(merged, parseEnvFile(readFileSync(filePath, 'utf8')))
    } catch {
      // ignore malformed env fallback files and continue using process.env
    }
  })
  return merged
}

function readEnvValue(key: string, fileValues: Record<string, string>): string | null {
  const processValue = process.env[key]
  if (typeof processValue === 'string' && processValue.trim()) {
    return processValue.trim()
  }
  const fileValue = fileValues[key]
  return typeof fileValue === 'string' && fileValue.trim() ? fileValue.trim() : null
}

export function readDesktopSyncConfigWithDebug(): { config: DesktopSyncConfig; debug: DesktopSyncConfigDebug } {
  const fileValues = loadDesktopEnvFileValues()
  const enabledRaw = readEnvValue('MONEYWISE_SYNC_ENABLED', fileValues)
  const backendUrl = readEnvValue('MONEYWISE_SYNC_URL', fileValues)
  const deviceId = readEnvValue('MONEYWISE_SYNC_DEVICE_ID', fileValues)
  const enabledParsed = (enabledRaw ?? '').trim().toLowerCase() === 'true'

  return {
    config: {
      enabled: enabledParsed && Boolean(backendUrl),
      backendUrl,
      deviceId
    },
    debug: {
      enabledRaw,
      enabledParsed,
      backendUrl,
      deviceId
    }
  }
}

export function readDesktopSyncConfig(): DesktopSyncConfig {
  return readDesktopSyncConfigWithDebug().config
}
