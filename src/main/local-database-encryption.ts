import Database from 'better-sqlite3-multiple-ciphers'
import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

const KEY_BYTES = 32
const FORMAT_VERSION = 1
const ENCRYPTED_DATABASE_NAME = 'moneywise.encrypted.sqlite'
const STAGED_DATABASE_NAME = 'moneywise.encrypted.sqlite.staged'
const KEY_DOCUMENT_NAME = 'database-key.v1.json'
const MIGRATION_STATE_NAME = 'database-encryption-migration.v1.json'

export type EncryptionMigrationStage =
  | 'detected'
  | 'key-protected'
  | 'encrypted-copy-created'
  | 'encrypted-copy-verified'
  | 'activated'
  | 'post-activation-verified'
  | 'completed'

export interface DatabaseKeyProtector {
  protect(key: Buffer): string
  unprotect(protectedKey: string): Buffer
}

export interface EncryptedDatabaseOptions {
  directory: string
  plaintextFilename: string
  profileId: string
  keyProtector: DatabaseKeyProtector
  injectFailure?: (stage: EncryptionMigrationStage) => void
}

interface KeyDocument {
  formatVersion: 1
  profileId: string
  protectedKey: string
}

interface MigrationState {
  formatVersion: 1
  profileId: string
  sourceFilename: string | null
  stage: EncryptionMigrationStage
}

interface DatabaseFingerprint {
  tables: Array<{ name: string; sql: string; rows: number; contentSha256: string }>
}

function atomicWriteJson(filePath: string, value: unknown): void {
  const temporaryPath = `${filePath}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  const descriptor = openSync(temporaryPath, 'r+')
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  renameSync(temporaryPath, filePath)
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T
}

function validateKey(key: Buffer): Buffer {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new Error('Local database key is missing, corrupt, or has an invalid length.')
  }
  return key
}

function configureCipher(database: InstanceType<typeof Database>, key: Buffer): void {
  const keyHex = validateKey(key).toString('hex')
  database.pragma("cipher='sqlcipher'")
  database.pragma(`hexkey='${keyHex}'`)
  database.pragma('memory_security=ON')
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function databaseFingerprint(database: InstanceType<typeof Database>): DatabaseFingerprint {
  const tables = database
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string; sql: string }>
  return {
    tables: tables.map((table) => {
      const columns = (database.pragma(`table_info(${quoteIdentifier(table.name)})`) as Array<{ name: string }>).map((column) => column.name)
      const order = columns.map(quoteIdentifier).join(', ')
      const rows = database.prepare(`SELECT * FROM ${quoteIdentifier(table.name)}${order ? ` ORDER BY ${order}` : ''}`).all() as Array<Record<string, unknown>>
      const hash = createHash('sha256')
      hash.update(JSON.stringify(columns))
      for (const row of rows) {
        hash.update(JSON.stringify(columns.map((column) => {
          const value = row[column]
          if (Buffer.isBuffer(value)) return ['blob', value.toString('hex')]
          if (typeof value === 'bigint') return ['bigint', value.toString()]
          if (typeof value === 'number') return ['number', Object.is(value, -0) ? '-0' : String(value)]
          if (typeof value === 'string') return ['string', value]
          if (value === null) return ['null']
          return [typeof value, String(value)]
        })))
      }
      return { name: table.name, sql: table.sql, rows: rows.length, contentSha256: hash.digest('hex') }
    })
  }
}

function verifyEncryptedDatabase(filePath: string, key: Buffer): InstanceType<typeof Database> {
  const database = new Database(filePath)
  try {
    configureCipher(database, key)
    if (database.pragma('integrity_check', { simple: true }) !== 'ok') {
      throw new Error('Encrypted local database failed integrity verification.')
    }
    database.pragma('wal_checkpoint(TRUNCATE)')
    return database
  } catch (error) {
    database.close()
    throw new Error('Encrypted local database authentication or integrity verification failed.', { cause: error })
  }
}

function readKeyDocument(filePath: string, profileId: string, keyProtector: DatabaseKeyProtector): Buffer {
  if (!existsSync(filePath)) {
    throw new Error('Encrypted local data exists but its OS-protected database key is missing.')
  }
  let document: KeyDocument
  try {
    document = readJson<KeyDocument>(filePath)
  } catch (error) {
    throw new Error('The OS-protected local database key document is corrupt.', { cause: error })
  }
  if (document.formatVersion !== FORMAT_VERSION || document.profileId !== profileId || typeof document.protectedKey !== 'string') {
    throw new Error('The OS-protected local database key document is invalid for this account.')
  }
  try {
    return validateKey(keyProtector.unprotect(document.protectedKey))
  } catch (error) {
    throw new Error('The OS-protected local database key cannot be decrypted in this operating-system context.', { cause: error })
  }
}

function removeDatabaseGeneration(filePath: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    rmSync(`${filePath}${suffix}`, { force: true })
  }
}

function writeState(filePath: string, state: MigrationState, injectFailure?: (stage: EncryptionMigrationStage) => void): void {
  atomicWriteJson(filePath, state)
  injectFailure?.(state.stage)
}

function createProtectedKey(filePath: string, profileId: string, keyProtector: DatabaseKeyProtector): Buffer {
  const key = randomBytes(KEY_BYTES)
  const protectedKey = keyProtector.protect(key)
  if (!protectedKey) throw new Error('Operating-system key protection returned an empty database key blob.')
  atomicWriteJson(filePath, { formatVersion: FORMAT_VERSION, profileId, protectedKey } satisfies KeyDocument)
  return key
}

function createEncryptedStage(stagedPath: string, plaintextPath: string | null, key: Buffer): DatabaseFingerprint | null {
  removeDatabaseGeneration(stagedPath)
  if (plaintextPath) {
    const plaintext = new Database(plaintextPath)
    let fingerprint: DatabaseFingerprint
    try {
      plaintext.pragma('wal_checkpoint(TRUNCATE)')
      if (plaintext.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Legacy plaintext database failed integrity verification.')
      fingerprint = databaseFingerprint(plaintext)
    } finally {
      plaintext.close()
    }
    copyFileSync(plaintextPath, stagedPath)
    const staged = new Database(stagedPath)
    try {
      staged.pragma("cipher='sqlcipher'")
      staged.pragma(`hexrekey='${key.toString('hex')}'`)
    } finally {
      staged.close()
    }
    return fingerprint
  } else {
    const staged = new Database(stagedPath)
    try {
      configureCipher(staged, key)
      staged.exec('CREATE TABLE IF NOT EXISTS local_encryption_bootstrap (format_version INTEGER NOT NULL)')
      staged.prepare('INSERT INTO local_encryption_bootstrap (format_version) VALUES (?)').run(FORMAT_VERSION)
      staged.exec('DROP TABLE local_encryption_bootstrap')
    } finally {
      staged.close()
    }
    return null
  }
}

export function openEncryptedDatabase(options: EncryptedDatabaseOptions): InstanceType<typeof Database> {
  mkdirSync(options.directory, { recursive: true })
  const encryptedPath = join(options.directory, ENCRYPTED_DATABASE_NAME)
  const stagedPath = join(options.directory, STAGED_DATABASE_NAME)
  const keyPath = join(options.directory, KEY_DOCUMENT_NAME)
  const statePath = join(options.directory, MIGRATION_STATE_NAME)
  const plaintextPath = join(options.directory, options.plaintextFilename)

  if (existsSync(encryptedPath)) {
    const key = readKeyDocument(keyPath, options.profileId, options.keyProtector)
    const database = verifyEncryptedDatabase(encryptedPath, key)
    try {
      const existingState = existsSync(statePath) ? readJson<MigrationState>(statePath) : null
      if (existsSync(plaintextPath) || existingState?.stage !== 'completed') {
        if (existsSync(plaintextPath)) {
          const plaintext = new Database(plaintextPath, { readonly: true })
          try {
            if (JSON.stringify(databaseFingerprint(plaintext)) !== JSON.stringify(databaseFingerprint(database))) {
              throw new Error('Activated encrypted database does not match the legacy plaintext generation.')
            }
          } finally {
            plaintext.close()
          }
        }
        writeState(statePath, { formatVersion: FORMAT_VERSION, profileId: options.profileId, sourceFilename: existsSync(plaintextPath) ? options.plaintextFilename : null, stage: 'post-activation-verified' }, options.injectFailure)
        removeDatabaseGeneration(plaintextPath)
        removeDatabaseGeneration(stagedPath)
        writeState(statePath, { formatVersion: FORMAT_VERSION, profileId: options.profileId, sourceFilename: null, stage: 'completed' }, options.injectFailure)
      }
      return database
    } catch (error) {
      database.close()
      throw error
    }
  }

  let state: MigrationState
  if (existsSync(statePath)) {
    state = readJson<MigrationState>(statePath)
    if (state.formatVersion !== FORMAT_VERSION || state.profileId !== options.profileId) {
      throw new Error('Local database encryption migration state is corrupt or belongs to another account.')
    }
  } else {
    state = {
      formatVersion: FORMAT_VERSION,
      profileId: options.profileId,
      sourceFilename: existsSync(plaintextPath) ? options.plaintextFilename : null,
      stage: 'detected'
    }
    writeState(statePath, state, options.injectFailure)
  }

  let key: Buffer
  if (existsSync(keyPath)) {
    key = readKeyDocument(keyPath, options.profileId, options.keyProtector)
  } else {
    if (!['detected'].includes(state.stage)) {
      throw new Error('Local database encryption migration lost its protected key and cannot continue safely.')
    }
    key = createProtectedKey(keyPath, options.profileId, options.keyProtector)
  }
  state = { ...state, stage: 'key-protected' }
  writeState(statePath, state, options.injectFailure)

  const sourcePath = state.sourceFilename ? join(options.directory, state.sourceFilename) : null
  if (!existsSync(stagedPath)) {
    if (sourcePath && !existsSync(sourcePath)) throw new Error('Legacy plaintext database disappeared before encrypted migration completed.')
    createEncryptedStage(stagedPath, sourcePath, key)
  }
  state = { ...state, stage: 'encrypted-copy-created' }
  writeState(statePath, state, options.injectFailure)

  const staged = verifyEncryptedDatabase(stagedPath, key)
  try {
    if (sourcePath) {
      const plaintext = new Database(sourcePath, { readonly: true })
      try {
        if (JSON.stringify(databaseFingerprint(plaintext)) !== JSON.stringify(databaseFingerprint(staged))) {
          throw new Error('Encrypted migration copy does not match the legacy plaintext generation.')
        }
      } finally {
        plaintext.close()
      }
    }
  } finally {
    staged.close()
  }
  state = { ...state, stage: 'encrypted-copy-verified' }
  writeState(statePath, state, options.injectFailure)

  renameSync(stagedPath, encryptedPath)
  state = { ...state, stage: 'activated' }
  writeState(statePath, state, options.injectFailure)

  const database = verifyEncryptedDatabase(encryptedPath, key)
  try {
    state = { ...state, stage: 'post-activation-verified' }
    writeState(statePath, state, options.injectFailure)

    if (sourcePath) removeDatabaseGeneration(sourcePath)
    writeState(statePath, { ...state, sourceFilename: null, stage: 'completed' }, options.injectFailure)
    return database
  } catch (error) {
    database.close()
    throw error
  }
}

export const localDatabaseEncryptionFiles = {
  encryptedDatabase: ENCRYPTED_DATABASE_NAME,
  protectedKey: KEY_DOCUMENT_NAME,
  migrationState: MIGRATION_STATE_NAME
} as const
