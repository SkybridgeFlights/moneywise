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
  source: 'packaged-production' | 'development-override' | 'test-disabled'
}

export const PRODUCTION_SYNC_BACKEND_URL = 'https://moneywise-f4jh.onrender.com'

interface DesktopSyncConfigOptions {
  isPackaged?: boolean
  nodeEnv?: string
  productionBackendUrl?: string
  environment?: NodeJS.ProcessEnv
  envFileValues?: Record<string, string>
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

function readEnvValue(key: string, environment: NodeJS.ProcessEnv, fileValues: Record<string, string>): string | null {
  const processValue = environment[key]
  if (typeof processValue === 'string' && processValue.trim()) {
    return processValue.trim()
  }
  const fileValue = fileValues[key]
  return typeof fileValue === 'string' && fileValue.trim() ? fileValue.trim() : null
}

function validateProductionBackendUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('Invalid packaged production sync URL.')
  }
  if (
    parsed.protocol !== 'https:' ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('Packaged production sync URL must be an HTTPS origin without credentials, path, query, or fragment.')
  }
  return parsed.origin
}

export function readDesktopSyncConfigWithDebug(options: DesktopSyncConfigOptions = {}): { config: DesktopSyncConfig; debug: DesktopSyncConfigDebug } {
  const isPackaged = options.isPackaged === true
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? 'development'
  if (isPackaged) {
    const backendUrl = validateProductionBackendUrl(options.productionBackendUrl ?? PRODUCTION_SYNC_BACKEND_URL)
    return {
      config: { enabled: true, backendUrl, deviceId: null },
      debug: { enabledRaw: null, enabledParsed: true, backendUrl, deviceId: null, source: 'packaged-production' }
    }
  }

  if (nodeEnv === 'test') {
    return {
      config: { enabled: false, backendUrl: null, deviceId: null },
      debug: { enabledRaw: null, enabledParsed: false, backendUrl: null, deviceId: null, source: 'test-disabled' }
    }
  }

  const environment = options.environment ?? process.env
  const fileValues = options.envFileValues ?? loadDesktopEnvFileValues()
  const enabledRaw = readEnvValue('MONEYWISE_SYNC_ENABLED', environment, fileValues)
  const backendUrl = readEnvValue('MONEYWISE_SYNC_URL', environment, fileValues)
  const deviceId = readEnvValue('MONEYWISE_SYNC_DEVICE_ID', environment, fileValues)
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
      deviceId,
      source: 'development-override'
    }
  }
}

export function readDesktopSyncConfig(options: DesktopSyncConfigOptions = {}): DesktopSyncConfig {
  return readDesktopSyncConfigWithDebug(options).config
}
