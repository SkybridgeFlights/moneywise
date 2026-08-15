import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {
        moneywise: {
          syncEnabled: true,
          backendUrl: 'https://moneywise-f4jh.onrender.com'
        }
      }
    }
  }
}))

import { getMobileSyncConfig } from './config'

describe('mobile release sync configuration', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('uses the public HTTPS password-auth backend without development environment variables', () => {
    expect(getMobileSyncConfig()).toEqual({
      enabled: true,
      backendUrl: 'https://moneywise-f4jh.onrender.com',
      deviceId: null
    })
  })

  it('rejects a cleartext backend override', () => {
    vi.stubEnv('EXPO_PUBLIC_MONEYWISE_SYNC_URL', 'http://unsafe.example.test')
    expect(() => getMobileSyncConfig()).toThrow('requires an HTTPS backend URL')
  })
})
