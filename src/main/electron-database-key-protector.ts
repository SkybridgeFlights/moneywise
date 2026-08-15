import { safeStorage } from 'electron'
import type { DatabaseKeyProtector } from './local-database-encryption'

export function createElectronDatabaseKeyProtector(): DatabaseKeyProtector {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Operating-system credential protection is unavailable. Local financial data cannot be opened safely.')
  }
  return {
    protect(key) {
      return safeStorage.encryptString(key.toString('base64')).toString('base64')
    },
    unprotect(protectedKey) {
      return Buffer.from(safeStorage.decryptString(Buffer.from(protectedKey, 'base64')), 'base64')
    }
  }
}
