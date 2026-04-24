export interface DesktopSyncConfig {
  enabled: boolean
  backendUrl: string | null
  deviceId: string | null
  syncEmail: string | null
  syncPassword: string | null
}

export function readDesktopSyncConfig(): DesktopSyncConfig {
  const enabled = process.env.MONEYWISE_SYNC_ENABLED === 'true'
  const backendUrl = process.env.MONEYWISE_SYNC_URL?.trim() || null
  const deviceId = process.env.MONEYWISE_SYNC_DEVICE_ID?.trim() || null
  const syncEmail = process.env.MONEYWISE_SYNC_EMAIL?.trim() || null
  const syncPassword = process.env.MONEYWISE_SYNC_PASSWORD?.trim() || null
  return {
    enabled: enabled && Boolean(backendUrl),
    backendUrl,
    deviceId,
    syncEmail,
    syncPassword
  }
}
