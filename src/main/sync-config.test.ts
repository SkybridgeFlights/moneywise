import { describe, expect, it } from 'vitest'
import { PRODUCTION_SYNC_BACKEND_URL, readDesktopSyncConfigWithDebug } from './sync-config'

describe('desktop sync configuration', () => {
  it('enables the immutable public HTTPS endpoint for packaged clients without environment variables', () => {
    const result = readDesktopSyncConfigWithDebug({ isPackaged: true, environment: {}, envFileValues: {} })

    expect(result.config).toEqual({ enabled: true, backendUrl: PRODUCTION_SYNC_BACKEND_URL, deviceId: null })
    expect(result.debug.source).toBe('packaged-production')
    expect(new URL(result.config.backendUrl!).protocol).toBe('https:')
  })

  it('ignores packaged runtime and env-file attempts to replace or disable production sync', () => {
    const result = readDesktopSyncConfigWithDebug({
      isPackaged: true,
      environment: { MONEYWISE_SYNC_ENABLED: 'false', MONEYWISE_SYNC_URL: 'http://attacker.invalid' },
      envFileValues: { MONEYWISE_SYNC_ENABLED: 'false', MONEYWISE_SYNC_URL: 'http://localhost:8787' }
    })

    expect(result.config).toEqual({ enabled: true, backendUrl: PRODUCTION_SYNC_BACKEND_URL, deviceId: null })
  })

  it('fails closed when packaged production configuration is not a credential-free HTTPS origin', () => {
    for (const value of [
      'http://moneywise-f4jh.onrender.com',
      'https://user:password@moneywise-f4jh.onrender.com',
      'https://moneywise-f4jh.onrender.com/api',
      'not-a-url'
    ]) {
      expect(() => readDesktopSyncConfigWithDebug({ isPackaged: true, productionBackendUrl: value })).toThrow()
    }
  })

  it('keeps automated tests disabled even if their process environment contains a production-looking URL', () => {
    const result = readDesktopSyncConfigWithDebug({
      nodeEnv: 'test',
      environment: { MONEYWISE_SYNC_ENABLED: 'true', MONEYWISE_SYNC_URL: PRODUCTION_SYNC_BACKEND_URL },
      envFileValues: { MONEYWISE_SYNC_ENABLED: 'true', MONEYWISE_SYNC_URL: PRODUCTION_SYNC_BACKEND_URL }
    })

    expect(result.config).toEqual({ enabled: false, backendUrl: null, deviceId: null })
    expect(result.debug.source).toBe('test-disabled')
  })

  it('preserves explicit local development overrides', () => {
    const result = readDesktopSyncConfigWithDebug({
      nodeEnv: 'development',
      environment: { MONEYWISE_SYNC_ENABLED: 'true', MONEYWISE_SYNC_URL: 'http://127.0.0.1:8787', MONEYWISE_SYNC_DEVICE_ID: 'desktop-dev' },
      envFileValues: {}
    })

    expect(result.config).toEqual({ enabled: true, backendUrl: 'http://127.0.0.1:8787', deviceId: 'desktop-dev' })
    expect(result.debug.source).toBe('development-override')
  })
})
