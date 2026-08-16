/**
 * Turns internal sync/auth failures into concise user-facing copy.
 *
 * The sync service keeps raw diagnostics (HTTP status, backend text) on
 * SyncState.lastError because the sync contract and logs depend on them. Those
 * strings must not reach the screen: they expose status codes and backend
 * wording that mean nothing to a person and leak service detail. This module is
 * the single translation point, applied at render time only.
 */

export type UserFacingTone = 'neutral' | 'warning' | 'negative'

export interface UserMessage {
  title: string
  description: string
  tone: UserFacingTone
  /** True when retrying is a sensible next step for the user. */
  retryable: boolean
}

const NETWORK_HINTS = ['network request failed', 'failed to fetch', 'timeout', 'timed out', 'econnrefused', 'enotfound', 'offline']

function statusOf(message: string): number | null {
  const match = /\[(\d{3})\]/.exec(message)
  return match ? Number(match[1]) : null
}

/** Maps a thrown sync error to copy that is safe and useful to display. */
export function describeSyncError(raw: string | null | undefined): UserMessage | null {
  if (!raw) return null
  const message = raw.toLowerCase()
  const status = statusOf(raw)

  if (NETWORK_HINTS.some((hint) => message.includes(hint))) {
    return {
      title: 'No connection',
      description: 'Your changes are saved on this device and will sync automatically once you are back online.',
      tone: 'warning',
      retryable: true
    }
  }
  if (status === 401 || status === 403 || message.includes('sign in is required')) {
    return {
      title: 'Sign in again',
      description: 'Your session expired. Sign in to resume syncing with your other devices.',
      tone: 'warning',
      retryable: false
    }
  }
  if (status === 409) {
    return {
      title: 'Changes were merged',
      description: 'Another device updated the same records. The newest version has been kept.',
      tone: 'neutral',
      retryable: true
    }
  }
  if (status === 429) {
    return {
      title: 'Too many requests',
      description: 'Syncing is briefly rate limited. It will resume on its own in a moment.',
      tone: 'warning',
      retryable: false
    }
  }
  if (status !== null && status >= 500) {
    return {
      title: 'Sync unavailable',
      description: 'The service is not responding right now. Your data is safe on this device and will sync later.',
      tone: 'warning',
      retryable: true
    }
  }
  return {
    title: 'Sync did not finish',
    description: 'Your data is safe on this device. Try syncing again in a moment.',
    tone: 'warning',
    retryable: true
  }
}

/** Maps a login/registration failure to copy without echoing backend text. */
export function describeAuthError(raw: string | null | undefined): UserMessage | null {
  if (!raw) return null
  const message = raw.toLowerCase()
  const status = statusOf(raw)

  if (NETWORK_HINTS.some((hint) => message.includes(hint))) {
    return {
      title: 'No connection',
      description: 'Check your connection and try again. You can keep using MoneyWise offline in the meantime.',
      tone: 'warning',
      retryable: true
    }
  }
  if (status === 401 || status === 400) {
    return { title: 'Check your details', description: 'That email and password combination did not match an account.', tone: 'negative', retryable: true }
  }
  if (status === 409) {
    return { title: 'Account already exists', description: 'An account with this email already exists. Sign in instead.', tone: 'warning', retryable: false }
  }
  if (status === 429) {
    return { title: 'Too many attempts', description: 'Please wait a moment before trying again.', tone: 'warning', retryable: false }
  }
  if (status !== null && status >= 500) {
    return { title: 'Service unavailable', description: 'We could not reach the account service. Try again shortly.', tone: 'warning', retryable: true }
  }
  return { title: 'Could not sign in', description: 'Something went wrong. Please try again.', tone: 'negative', retryable: true }
}

/** Short status text for the header badge. */
export function describeSyncPhase(phase: 'disabled' | 'idle' | 'syncing' | 'error', paused: boolean): string {
  if (paused) return 'Paused'
  if (phase === 'syncing') return 'Syncing'
  if (phase === 'error') return 'Offline'
  if (phase === 'disabled') return 'On device'
  return 'Synced'
}
