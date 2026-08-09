export interface MobileSyncConfig {
  enabled: boolean
  backendUrl: string | null
  deviceId: string | null
}

export function getMobileSyncConfig(): MobileSyncConfig {
  const enabled = process.env.EXPO_PUBLIC_MONEYWISE_SYNC_ENABLED === 'true'
  const backendUrl = process.env.EXPO_PUBLIC_MONEYWISE_SYNC_URL?.trim() || null
  const deviceId = process.env.EXPO_PUBLIC_MONEYWISE_SYNC_DEVICE_ID?.trim() || null

  return {
    enabled: enabled && Boolean(backendUrl),
    backendUrl,
    deviceId
  }
}
