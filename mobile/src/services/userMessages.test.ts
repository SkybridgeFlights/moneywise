import { describe, expect, it } from 'vitest'
import { describeAuthError, describeSyncError, describeSyncPhase } from './userMessages'

// The sync layer throws messages like "[500] db unavailable" and keeps them on
// SyncState.lastError. Those strings are diagnostics, not UI copy.
const RAW_ERRORS = [
  '[401] Access token expired',
  '[403] forbidden',
  '[409] version conflict on expense:abc',
  '[429] rate limited by upstream',
  '[500] libsql: connection refused',
  '[503] upstream unavailable at moneywise-f4jh.onrender.com',
  'Network request failed',
  'Sync request failed with 500',
  'Invalid backend session response.'
]

describe('sync error copy', () => {
  it('never leaks status codes, hosts or backend wording', () => {
    for (const raw of RAW_ERRORS) {
      const message = describeSyncError(raw)
      expect(message).not.toBeNull()
      const rendered = `${message!.title} ${message!.description}`
      expect(rendered).not.toMatch(/\[\d{3}\]/)
      expect(rendered).not.toMatch(/\b[45]\d{2}\b/)
      expect(rendered.toLowerCase()).not.toContain('libsql')
      expect(rendered.toLowerCase()).not.toContain('onrender.com')
      expect(rendered.toLowerCase()).not.toContain('token')
      expect(rendered.toLowerCase()).not.toContain('upstream')
    }
  })

  it('returns nothing when there is no error', () => {
    expect(describeSyncError(null)).toBeNull()
    expect(describeSyncError(undefined)).toBeNull()
    expect(describeSyncError('')).toBeNull()
  })

  it('treats connectivity failures as offline rather than a fault', () => {
    const message = describeSyncError('Network request failed')
    expect(message?.title).toBe('No connection')
    expect(message?.tone).toBe('warning')
    expect(message?.retryable).toBe(true)
  })

  it('asks the user to sign in again when the session expired', () => {
    expect(describeSyncError('[401] Access token expired')?.title).toBe('Sign in again')
    expect(describeSyncError('[401] Access token expired')?.retryable).toBe(false)
  })

  it('does not offer a retry for rate limiting', () => {
    expect(describeSyncError('[429] slow down')?.retryable).toBe(false)
  })
})

describe('auth error copy', () => {
  it('never leaks status codes or backend wording', () => {
    for (const raw of ['[400] invalid credentials', '[401] bad password hash', '[409] user exists', '[500] bcrypt failure']) {
      const message = describeAuthError(raw)
      const rendered = `${message!.title} ${message!.description}`
      expect(rendered).not.toMatch(/\[\d{3}\]/)
      expect(rendered.toLowerCase()).not.toContain('bcrypt')
      expect(rendered.toLowerCase()).not.toContain('hash')
    }
  })

  it('distinguishes a wrong password from an existing account', () => {
    expect(describeAuthError('[401] nope')?.title).toBe('Check your details')
    expect(describeAuthError('[409] exists')?.title).toBe('Account already exists')
  })
})

describe('sync phase label', () => {
  it('reports the paused state ahead of the phase', () => {
    expect(describeSyncPhase('idle', true)).toBe('Paused')
    expect(describeSyncPhase('syncing', false)).toBe('Syncing')
    expect(describeSyncPhase('error', false)).toBe('Offline')
    expect(describeSyncPhase('disabled', false)).toBe('On device')
    expect(describeSyncPhase('idle', false)).toBe('Synced')
  })
})
