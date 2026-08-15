import Constants from 'expo-constants'

export interface MobileSyncConfig {
  enabled: boolean
  backendUrl: string | null
  deviceId: string | null
}

export function getMobileSyncConfig(): MobileSyncConfig {
  const releaseConfig = Constants.expoConfig?.extra?.moneywise as { syncEnabled?: boolean; backendUrl?: string } | undefined
  const enabled = process.env.EXPO_PUBLIC_MONEYWISE_SYNC_ENABLED
    ? process.env.EXPO_PUBLIC_MONEYWISE_SYNC_ENABLED === 'true'
    : releaseConfig?.syncEnabled === true
  const backendUrl = process.env.EXPO_PUBLIC_MONEYWISE_SYNC_URL?.trim() || releaseConfig?.backendUrl?.trim() || null
  const deviceId = process.env.EXPO_PUBLIC_MONEYWISE_SYNC_DEVICE_ID?.trim() || null

  if (backendUrl && new URL(backendUrl).protocol !== 'https:') {
    throw new Error('Mobile synchronization requires an HTTPS backend URL.')
  }

  return {
    enabled: enabled && Boolean(backendUrl),
    backendUrl,
    deviceId
  }
}
