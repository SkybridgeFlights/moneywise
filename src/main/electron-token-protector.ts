import { safeStorage } from 'electron'
import type { TokenProtector } from './desktop-sync-state'

export function createElectronTokenProtector(): TokenProtector {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Operating-system credential protection is unavailable. Synchronization credentials cannot be stored safely.')
  }
  return {
    encrypt(value) {
      return safeStorage.encryptString(value).toString('base64')
    },
    decrypt(value) {
      return safeStorage.decryptString(Buffer.from(value, 'base64'))
    }
  }
}
