import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { afterEach, describe, expect, it } from 'vitest'
import { FinanceDatabase } from './database'
import type { DatabaseKeyProtector } from './local-database-encryption'
import type { RemoteSyncRecord } from './sync-types'

const directories: string[] = []

class PerformanceKeyProtector implements DatabaseKeyProtector {
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

function records(count: number): RemoteSyncRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    entityType: 'income',
    recordId: `performance-${count}-${index}`,
    payload: {
      id: `performance-${count}-${index}`,
      name: `Encrypted performance record ${index}`,
      groupName: 'Performance',
      amount: index + 0.25,
      date: '2026-08-15',
      type: 'variable',
      recurring: false,
      notes: `Sensitive note ${index}`
    },
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
    deletedAt: null,
    version: 1,
    lastModifiedByDeviceId: 'performance-device'
  }))
}

afterEach(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
})

describe('encrypted local database performance sanity', () => {
  for (const count of [100, 1_000]) {
    it(`writes, reads, restarts, and switches an account with ${count} records`, () => {
      const dataDir = mkdtempSync(join(tmpdir(), `moneywise-encrypted-performance-${count}-`))
      directories.push(dataDir)
      const keyProtector = new PerformanceKeyProtector()
      const startupStarted = performance.now()
      let database = new FinanceDatabase('performance-a', { dataDir, keyProtector })
      const startupMs = performance.now() - startupStarted
      const writeStarted = performance.now()
      database.applyRemoteSyncChanges(records(count))
      const writeMs = performance.now() - writeStarted
      const readStarted = performance.now()
      expect(database.getDomainState().incomes).toHaveLength(count)
      const readMs = performance.now() - readStarted
      database.switchAccountProfile('performance-b')
      database.switchAccountProfile('performance-a')
      expect(database.getDomainState().incomes).toHaveLength(count)
      database.close()
      const restartStarted = performance.now()
      database = new FinanceDatabase('performance-a', { dataDir, keyProtector })
      const restartMs = performance.now() - restartStarted
      expect(database.getDomainState().incomes).toHaveLength(count)
      database.close()
      console.info(`H2_PERFORMANCE records=${count} startup_ms=${startupMs.toFixed(1)} write_ms=${writeMs.toFixed(1)} read_ms=${readMs.toFixed(1)} restart_ms=${restartMs.toFixed(1)}`)
      expect(writeMs).toBeLessThan(15_000)
      expect(restartMs).toBeLessThan(5_000)
    })
  }
})
