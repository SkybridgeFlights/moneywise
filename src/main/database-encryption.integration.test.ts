import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { FinanceDatabase } from './database'
import type { DatabaseKeyProtector } from './local-database-encryption'
import type { RemoteSyncRecord } from './sync-types'

const directories: string[] = []

class IntegrationKeyProtector implements DatabaseKeyProtector {
  private readonly wrappingKey = randomBytes(32)

  protect(key: Buffer): string {
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.wrappingKey, nonce)
    const ciphertext = Buffer.concat([cipher.update(key), cipher.final()])
    return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64')
  }

  unprotect(value: string): Buffer {
    const envelope = Buffer.from(value, 'base64')
    const decipher = createDecipheriv('aes-256-gcm', this.wrappingKey, envelope.subarray(0, 12))
    decipher.setAuthTag(envelope.subarray(12, 28))
    return Buffer.concat([decipher.update(envelope.subarray(28)), decipher.final()])
  }
}

function temporaryDataDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'moneywise-finance-encrypted-'))
  directories.push(directory)
  return directory
}

function profileDirectory(dataDir: string, userId: string): string {
  const profileId = createHash('sha256').update(`moneywise-desktop-profile:${userId}`).digest('hex')
  return join(dataDir, 'profiles', profileId)
}

function allProfileBytes(directory: string): Buffer {
  return Buffer.concat(
    readdirSync(directory)
      .filter((name) => /\.sqlite(?:-(?:wal|shm))?$/.test(name))
      .map((name) => readFileSync(join(directory, name)))
  )
}

afterEach(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
})

describe('FinanceDatabase encrypted profiles', () => {
  it('retains the authoritative legacy root database until encrypted activation succeeds', () => {
    const dataDir = temporaryDataDirectory()
    const legacyPath = join(dataDir, 'moneywise.sqlite')
    const legacy = new Database(legacyPath)
    legacy.exec('CREATE TABLE legacy_recovery_canary (value TEXT NOT NULL)')
    legacy.prepare('INSERT INTO legacy_recovery_canary (value) VALUES (?)').run('LEGACY-ROOT-CRASH-CANARY')
    legacy.close()
    const keyProtector = new IntegrationKeyProtector()

    expect(() => new FinanceDatabase('legacy-owner', {
      dataDir,
      keyProtector,
      injectEncryptionMigrationFailure(stage) {
        if (stage === 'encrypted-copy-verified') throw new Error('simulated activation crash')
      }
    })).toThrow('simulated activation crash')
    expect(existsSync(legacyPath)).toBe(true)
    const preserved = new Database(legacyPath, { readonly: true })
    expect((preserved.prepare('SELECT value FROM legacy_recovery_canary').get() as { value: string }).value).toBe('LEGACY-ROOT-CRASH-CANARY')
    preserved.close()

    const recovered = new FinanceDatabase('legacy-owner', { dataDir, keyProtector })
    recovered.close()
    expect(existsSync(legacyPath)).toBe(false)
    expect(allProfileBytes(profileDirectory(dataDir, 'legacy-owner')).includes(Buffer.from('LEGACY-ROOT-CRASH-CANARY'))).toBe(false)
  })

  it('preserves account switching, restart, deletes, exports, and encrypted-at-rest canaries', async () => {
    const dataDir = temporaryDataDirectory()
    const keyProtector = new IntegrationKeyProtector()
    const userA = 'user-a'
    const userB = 'user-b'
    const canaryA = 'ACCOUNT-A-SECRET-INCOME-7f62'
    const canaryB = 'ACCOUNT-B-SECRET-INCOME-2a91'
    let database = new FinanceDatabase(userA, { dataDir, keyProtector })

    database.saveIncome({ id: 'income-a', name: canaryA, groupName: 'Primary', amount: 123.45, date: '2026-08-15', type: 'fixed', recurring: false, notes: `${canaryA}-NOTES` })
    database.switchAccountProfile(userB)
    expect(database.getDomainState().incomes.some((entry) => entry.name === canaryA)).toBe(false)
    database.saveIncome({ id: 'income-b', name: canaryB, groupName: 'Primary', amount: 67.89, date: '2026-08-15', type: 'variable', recurring: false, notes: '' })
    database.switchAccountProfile(userA)
    expect(database.getDomainState().incomes.find((entry) => entry.id === 'income-a')?.name).toBe(canaryA)
    database.saveCategory({ id: 'category-a', name: 'Encrypted export category', type: 'custom', color: '#123456', icon: 'wallet', monthlyLimit: null })
    database.saveExpense({ id: 'expense-a', title: `${canaryA}-EXPENSE`, amount: 4.56, date: '2026-08-15', categoryId: 'category-a', paymentMethod: 'card', type: 'variable', recurring: false, notes: '', tags: ['encrypted-export'] })

    const jsonExportPath = join(dataDir, 'user-requested-export.json')
    const csvExportPath = join(dataDir, 'user-requested-export.csv')
    const spreadsheetExportPath = join(dataDir, 'user-requested-export.xlsx')
    await database.exportData('json', jsonExportPath)
    await database.exportData('csv', csvExportPath)
    await database.exportData('xlsx', spreadsheetExportPath)
    const jsonExport = readFileSync(jsonExportPath, 'utf8')
    const csvExport = readFileSync(csvExportPath, 'utf8')
    const spreadsheetSize = statSync(spreadsheetExportPath).size
    database.close()
    expect(jsonExport).toContain(canaryA)
    expect(csvExport).toContain(canaryA)
    expect(jsonExport).not.toMatch(/protectedKey|database-key|encryptionKey/i)
    expect(csvExport).not.toMatch(/protectedKey|database-key|encryptionKey/i)
    expect(spreadsheetSize).toBeGreaterThan(0)
    expect(allProfileBytes(profileDirectory(dataDir, userA)).includes(Buffer.from(canaryA))).toBe(false)
    expect(allProfileBytes(profileDirectory(dataDir, userB)).includes(Buffer.from(canaryB))).toBe(false)

    database = new FinanceDatabase(userA, { dataDir, keyProtector })
    expect(database.getDomainState().incomes.find((entry) => entry.id === 'income-a')?.amount).toBe(123.45)
    rmSync(profileDirectory(dataDir, userB), { recursive: true, force: true })
    expect(database.getDomainState().incomes.find((entry) => entry.id === 'income-a')?.name).toBe(canaryA)
    database.deleteIncome('income-a')
    expect(database.getDomainState().incomes.find((entry) => entry.id === 'income-a')).toBeUndefined()
    database.close()
    expect(allProfileBytes(profileDirectory(dataDir, userA)).includes(Buffer.from(canaryA))).toBe(false)
  })

  it('decrypts remote sync payloads only in main-process memory and stores them encrypted locally', () => {
    const dataDir = temporaryDataDirectory()
    const keyProtector = new IntegrationKeyProtector()
    const userId = 'sync-user'
    const remoteCanary = 'REMOTE-TURSO-PAYLOAD-CANARY-491e'
    const database = new FinanceDatabase(userId, { dataDir, keyProtector })
    const change: RemoteSyncRecord = {
      entityType: 'income',
      recordId: 'remote-income',
      payload: { id: 'remote-income', name: remoteCanary, groupName: 'Remote', amount: 900, date: '2026-08-15', type: 'fixed', recurring: false, notes: '' },
      createdAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:00.000Z',
      deletedAt: null,
      version: 1,
      lastModifiedByDeviceId: 'remote-device'
    }

    database.applyRemoteSyncChanges([change])
    expect(database.getDomainState().incomes.find((entry) => entry.id === 'remote-income')?.name).toBe(remoteCanary)
    database.close()
    expect(allProfileBytes(profileDirectory(dataDir, userId)).includes(Buffer.from(remoteCanary))).toBe(false)
  })

  it('rebuilds synchronized financial state after only a disposable local encrypted profile and key are destroyed', () => {
    const dataDir = temporaryDataDirectory()
    const keyProtector = new IntegrationKeyProtector()
    const userId = 'rebuild-user'
    const record: RemoteSyncRecord = {
      entityType: 'income', recordId: 'server-record',
      payload: { id: 'server-record', name: 'SERVER-RECOVERY-CANARY', groupName: 'Remote', amount: 321, date: '2026-08-15', type: 'fixed', recurring: false, notes: '' },
      createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z', deletedAt: null, version: 3, lastModifiedByDeviceId: 'server'
    }
    let database = new FinanceDatabase(userId, { dataDir, keyProtector })
    database.applyRemoteSyncChanges([record])
    database.close()

    const disposableProfile = profileDirectory(dataDir, userId)
    expect(existsSync(disposableProfile)).toBe(true)
    rmSync(disposableProfile, { recursive: true, force: true })
    database = new FinanceDatabase(userId, { dataDir, keyProtector })
    expect(database.getDomainState().incomes.find((entry) => entry.id === 'server-record')).toBeUndefined()
    database.applyRemoteSyncChanges([record])
    expect(database.getDomainState().incomes.find((entry) => entry.id === 'server-record')?.name).toBe('SERVER-RECOVERY-CANARY')
    database.close()
  })
})
