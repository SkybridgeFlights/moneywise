import Database from 'better-sqlite3-multiple-ciphers'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  localDatabaseEncryptionFiles,
  openEncryptedDatabase,
  type DatabaseKeyProtector,
  type EncryptionMigrationStage
} from './local-database-encryption'

const CANARY = 'H2-PLAINTEXT-CANARY-9d10d6f9'
const cleanupDirectories: string[] = []

function createDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'moneywise-h2-'))
  cleanupDirectories.push(directory)
  return directory
}

class TestKeyProtector implements DatabaseKeyProtector {
  constructor(private readonly wrappingKey = randomBytes(32)) {}

  protect(key: Buffer): string {
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.wrappingKey, nonce)
    const ciphertext = Buffer.concat([cipher.update(key), cipher.final()])
    return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64')
  }

  unprotect(protectedKey: string): Buffer {
    const envelope = Buffer.from(protectedKey, 'base64')
    if (envelope.length !== 60) throw new Error('corrupt protected key')
    const decipher = createDecipheriv('aes-256-gcm', this.wrappingKey, envelope.subarray(0, 12))
    decipher.setAuthTag(envelope.subarray(12, 28))
    return Buffer.concat([decipher.update(envelope.subarray(28)), decipher.final()])
  }
}

function createPlaintextDatabase(directory: string): string {
  const filePath = join(directory, 'moneywise.sqlite')
  const database = new Database(filePath)
  database.pragma('journal_mode=WAL')
  database.exec('CREATE TABLE finance (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE related (id TEXT PRIMARY KEY, finance_id TEXT NOT NULL REFERENCES finance(id));')
  database.prepare('INSERT INTO finance VALUES (?, ?)').run('record-1', CANARY)
  database.prepare('INSERT INTO related VALUES (?, ?)').run('related-1', 'record-1')
  database.pragma('wal_checkpoint(TRUNCATE)')
  database.close()
  return filePath
}

function open(directory: string, protector: DatabaseKeyProtector, injectFailure?: (stage: EncryptionMigrationStage) => void) {
  return openEncryptedDatabase({ directory, plaintextFilename: 'moneywise.sqlite', profileId: 'profile-a', keyProtector: protector, injectFailure })
}

function containsCanary(filePath: string): boolean {
  return existsSync(filePath) && readFileSync(filePath).includes(Buffer.from(CANARY))
}

afterEach(() => {
  while (cleanupDirectories.length) rmSync(cleanupDirectories.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
})

describe('encrypted local database migration', () => {
  it.each<EncryptionMigrationStage>([
    'detected',
    'key-protected',
    'encrypted-copy-created',
    'encrypted-copy-verified',
    'activated',
    'post-activation-verified',
    'completed'
  ])('recovers after a crash at %s with either the original or fully encrypted data', (failureStage) => {
    const directory = createDirectory()
    const plaintextPath = createPlaintextDatabase(directory)
    const protector = new TestKeyProtector()

    expect(() => open(directory, protector, (stage) => {
      if (stage === failureStage) throw new Error(`crash:${stage}`)
    })).toThrow(`crash:${failureStage}`)

    const originalStillValid = existsSync(plaintextPath) && (() => {
      const database = new Database(plaintextPath, { readonly: true })
      try {
        return database.prepare('SELECT value FROM finance WHERE id = ?').pluck().get('record-1') === CANARY
      } finally {
        database.close()
      }
    })()

    const recovered = open(directory, protector)
    expect(recovered.prepare('SELECT value FROM finance WHERE id = ?').pluck().get('record-1')).toBe(CANARY)
    expect(recovered.pragma('foreign_key_check')).toEqual([])
    recovered.close()
    expect(originalStillValid || existsSync(join(directory, localDatabaseEncryptionFiles.encryptedDatabase))).toBe(true)
    expect(existsSync(plaintextPath)).toBe(false)
  })

  it('is idempotent and leaves no plaintext in the database, WAL, SHM, or migration files', () => {
    const directory = createDirectory()
    createPlaintextDatabase(directory)
    const protector = new TestKeyProtector()
    let database = open(directory, protector)
    database.pragma('journal_mode=WAL')
    database.prepare('UPDATE finance SET value = ? WHERE id = ?').run(`${CANARY}-EDITED`, 'record-1')

    const encryptedPath = join(directory, localDatabaseEncryptionFiles.encryptedDatabase)
    for (const suffix of ['', '-wal', '-shm']) expect(containsCanary(`${encryptedPath}${suffix}`)).toBe(false)
    database.pragma('wal_checkpoint(TRUNCATE)')
    database.close()

    database = open(directory, protector)
    expect(database.prepare('SELECT value FROM finance').pluck().get()).toBe(`${CANARY}-EDITED`)
    database.close()
    for (const file of readdirSync(directory)) expect(containsCanary(join(directory, file))).toBe(false)
  })

  it('rejects ciphertext modification and never returns corrupted plaintext', () => {
    const directory = createDirectory()
    createPlaintextDatabase(directory)
    const protector = new TestKeyProtector()
    open(directory, protector).close()
    const encryptedPath = join(directory, localDatabaseEncryptionFiles.encryptedDatabase)
    const bytes = readFileSync(encryptedPath)
    bytes[Math.floor(bytes.length / 2)] ^= 0xff
    writeFileSync(encryptedPath, bytes)
    expect(() => open(directory, protector)).toThrow(/authentication or integrity/i)
  })

  it('fails closed for the wrong, missing, or corrupt protected key', () => {
    const directory = createDirectory()
    createPlaintextDatabase(directory)
    const protector = new TestKeyProtector()
    open(directory, protector).close()
    expect(() => open(directory, new TestKeyProtector())).toThrow(/cannot be decrypted/i)

    const keyPath = join(directory, localDatabaseEncryptionFiles.protectedKey)
    const keyDocument = readFileSync(keyPath)
    unlinkSync(keyPath)
    expect(() => open(directory, protector)).toThrow(/key is missing/i)
    writeFileSync(keyPath, Buffer.from('{"corrupt":true}'))
    expect(() => open(directory, protector)).toThrow(/key document is invalid/i)
    writeFileSync(keyPath, keyDocument)
    const recovered = open(directory, protector)
    recovered.close()
  })

  it('uses independent account keys and preserves A to B to A access', () => {
    const root = createDirectory()
    const protector = new TestKeyProtector()
    const directoryA = join(root, 'a')
    const directoryB = join(root, 'b')
    const openProfile = (directory: string, profileId: string) => openEncryptedDatabase({ directory, plaintextFilename: 'moneywise.sqlite', profileId, keyProtector: protector })

    let database = openProfile(directoryA, 'profile-a')
    database.exec('CREATE TABLE finance (value TEXT NOT NULL)')
    database.prepare('INSERT INTO finance VALUES (?)').run('ACCOUNT-A-ONLY')
    database.close()

    database = openProfile(directoryB, 'profile-b')
    database.exec('CREATE TABLE finance (value TEXT NOT NULL)')
    database.prepare('INSERT INTO finance VALUES (?)').run('ACCOUNT-B-ONLY')
    database.close()

    const keyA = readFileSync(join(directoryA, localDatabaseEncryptionFiles.protectedKey), 'utf8')
    const keyB = readFileSync(join(directoryB, localDatabaseEncryptionFiles.protectedKey), 'utf8')
    expect(keyA).not.toBe(keyB)
    database = openProfile(directoryA, 'profile-a')
    expect(database.prepare('SELECT value FROM finance').pluck().get()).toBe('ACCOUNT-A-ONLY')
    database.close()
  })

  it('creates distinct ciphertext generations for identical content', () => {
    const root = createDirectory()
    const protector = new TestKeyProtector()
    const encrypted: Buffer[] = []
    for (const name of ['one', 'two']) {
      const directory = join(root, name)
      const database = openEncryptedDatabase({ directory, plaintextFilename: 'moneywise.sqlite', profileId: name, keyProtector: protector })
      database.exec('CREATE TABLE finance (value TEXT NOT NULL)')
      database.prepare('INSERT INTO finance VALUES (?)').run(CANARY)
      database.pragma('wal_checkpoint(TRUNCATE)')
      database.close()
      encrypted.push(readFileSync(join(directory, localDatabaseEncryptionFiles.encryptedDatabase)))
    }
    expect(encrypted[0].equals(encrypted[1])).toBe(false)
  })
})
