import React, { useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'
import { FormScreen } from '../components/FormScreen'
import { Button, Chip } from '../components/ui'
import { describeAuthError, describeSyncError } from '../services/userMessages'
import { palette, spacing } from '../theme/tokens'
import { NoticeCard } from '../components/NoticeCard'
import { LabeledInput } from '../components/LabeledInput'
import type { Settings, SyncState } from '../models/types'

type SyncPhase = 'disabled' | 'idle' | 'syncing' | 'error'

interface SettingsScreenProps {
  settings: Settings
  syncEnabled: boolean
  backendUrl: string | null
  syncState: SyncState
  syncPhase: SyncPhase
  pendingChanges: number
  onSyncNow: () => void
  onTogglePaused: (paused: boolean) => void
  onLogin: (email: string, password: string) => Promise<void>
  onRegister: (email: string, password: string) => Promise<void>
  onLogout: () => Promise<void>
  onUpdateSettings: (patch: Partial<Settings>) => void
  onResetData: () => void
  onOpenDebts: () => void
}

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'Never'
}

function toneForSync(phase: SyncPhase, paused: boolean): 'neutral' | 'success' | 'warning' | 'error' {
  if (paused) return 'warning'
  if (phase === 'error') return 'error'
  if (phase === 'syncing') return 'warning'
  if (phase === 'disabled') return 'neutral'
  return 'success'
}

export function SettingsScreen({
  settings,
  syncEnabled,
  backendUrl,
  syncState,
  syncPhase,
  pendingChanges,
  onSyncNow,
  onTogglePaused,
  onLogin,
  onRegister,
  onLogout,
  onUpdateSettings,
  onResetData,
  onOpenDebts
}: SettingsScreenProps): React.JSX.Element {
  const syncTone = toneForSync(syncPhase, syncState.paused)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  // syncState.lastError / authError keep raw diagnostics; only the mapped copy
  // is ever rendered, so status codes and backend wording stay internal.
  const syncErrorMessage = describeSyncError(syncState.lastError)
  const authMessage = describeAuthError(authError)

  async function submitAuth(mode: 'login' | 'register'): Promise<void> {
    setAuthError(null)
    try {
      await (mode === 'login' ? onLogin(email.trim(), password) : onRegister(email.trim(), password))
      setPassword('')
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Authentication failed')
    }
  }

  const canSubmitAuth = Boolean(email.trim()) && password.length >= 8
  const languageOptions: Array<{ label: string; value: Settings['language']; locale: string; rtl: boolean }> = [
    { label: 'English', value: 'en', locale: 'en-US', rtl: false },
    { label: 'Arabic', value: 'ar', locale: 'ar', rtl: true }
  ]
  const currencyOptions = ['USD', 'EUR', 'GBP', 'SAR', 'AED', 'EGP', 'JOD']

  return (
    <FormScreen>
      <NoticeCard
        title={syncEnabled ? 'Sync status' : 'Local-first mode'}
        description={
          syncEnabled
            ? `Last sync ${formatDateTime(syncState.lastSyncAt)}. ${pendingChanges} change${pendingChanges === 1 ? '' : 's'} waiting to upload.`
            : 'Sync is disabled. The app continues to work fully from local storage on this device.'
        }
        tone={syncTone}
      />

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Sync & account</Text>
        <Text style={styles.cardSubtitle}>Clear visibility without blocking local use when the backend is unavailable.</Text>
        <View style={styles.metrics}>
          <MetricLine label="Backend" value={backendUrl ?? 'Not configured'} />
          <MetricLine label="Connection" value={syncEnabled ? (syncState.paused ? 'Paused on device' : syncPhase === 'error' ? 'Needs attention' : syncPhase === 'syncing' ? 'Syncing now' : 'Ready') : 'Disabled'} />
          <MetricLine label="Last sync" value={formatDateTime(syncState.lastSyncAt)} />
          <MetricLine label="Pending changes" value={String(pendingChanges)} />
          <MetricLine label="Account" value={syncState.accountEmail ?? 'Not signed in'} />
          <MetricLine label="Auth mode" value={syncState.authMode === 'password' ? 'Email + password' : syncState.authMode === 'dev-session' ? 'Developer session' : 'Not available'} />
        </View>
        {syncErrorMessage ? (
          <NoticeCard
            title={syncErrorMessage.title}
            description={syncErrorMessage.description}
            tone={syncErrorMessage.tone === 'negative' ? 'error' : syncErrorMessage.tone === 'warning' ? 'warning' : 'neutral'}
            actionLabel={syncErrorMessage.retryable ? 'Try again' : undefined}
            onAction={syncErrorMessage.retryable ? onSyncNow : undefined}
          />
        ) : null}
        {syncEnabled && !syncState.userId ? (
          <View style={styles.authForm}>
            <LabeledInput label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
            <LabeledInput
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
              hint="At least 8 characters."
            />
            {authMessage ? <NoticeCard title={authMessage.title} description={authMessage.description} tone={authMessage.tone === 'warning' ? 'warning' : 'error'} /> : null}
            <View style={styles.actions}>
              <Button label="Sign in" onPress={() => void submitAuth('login')} disabled={!canSubmitAuth} style={styles.grow} />
              <Button label="Create account" onPress={() => void submitAuth('register')} variant="secondary" disabled={!canSubmitAuth} style={styles.grow} />
            </View>
          </View>
        ) : null}
        <View style={styles.actions}>
          <Button
            label={syncPhase === 'syncing' ? 'Syncing' : 'Sync now'}
            onPress={onSyncNow}
            busy={syncPhase === 'syncing'}
            disabled={!syncEnabled || syncState.paused}
            style={styles.grow}
          />
          <Button
            label={syncState.paused ? 'Resume sync' : 'Pause sync'}
            onPress={() => onTogglePaused(!syncState.paused)}
            variant="secondary"
            style={styles.grow}
          />
        </View>
        {syncState.userId ? (
          <Button label="Sign out / switch account" onPress={() => void onLogout()} variant="secondary" />
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Preferences</Text>
        <Text style={styles.cardSubtitle}>Stored locally and synced when available.</Text>
        <Text style={styles.sectionLabel}>Language</Text>
        <View style={styles.chips}>
          {languageOptions.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={settings.language === option.value}
              onPress={() => onUpdateSettings({ language: option.value, locale: option.locale, rtl: option.rtl })}
            />
          ))}
        </View>
        <Text style={styles.sectionLabel}>Currency</Text>
        <View style={styles.chips}>
          {currencyOptions.map((currency) => (
            <Chip key={currency} label={currency} selected={settings.currency === currency} onPress={() => onUpdateSettings({ currency })} />
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Planning</Text>
        <Text style={styles.cardSubtitle}>Open debt planning without crowding the main bottom navigation.</Text>
        <Button label="Open debts" onPress={onOpenDebts} variant="secondary" />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Safety</Text>
        <Text style={styles.cardSubtitle}>Destructive actions require confirmation.</Text>
        <Button
          label="Reset local device data"
          variant="danger"
          accessibilityHint="Opens a confirmation dialog"
          onPress={() =>
            Alert.alert('Reset local data?', 'This clears local finance and sync state on this device. Remote data is not deleted.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Reset', style: 'destructive', onPress: onResetData }
            ])
          }
        />
      </View>
    </FormScreen>
  )
}

function MetricLine({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.metricLine}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 14
  },
  card: {
    borderRadius: 20,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 16,
    gap: 12
  },
  cardTitle: {
    color: palette.textPrimary,
    fontSize: 18,
    fontWeight: '700'
  },
  cardSubtitle: {
    color: palette.textSecondary,
    fontSize: 13,
    lineHeight: 18
  },
  metrics: {
    gap: 8
  },
  metricLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12
  },
  metricLabel: {
    color: palette.textSecondary,
    fontSize: 13,
    flex: 1
  },
  metricValue: {
    color: palette.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right'
  },
  actions: {
    flexDirection: 'row',
    gap: 10
  },
  authForm: { gap: spacing.md },
  grow: { flex: 1 },
  primaryButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: palette.positive
  },
  primaryButtonText: {
    color: palette.textPrimary,
    fontWeight: '700'
  },
  secondaryButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: palette.surfaceRaised
  },
  secondaryButtonText: {
    color: palette.textPrimary,
    fontWeight: '700'
  },
  buttonDisabled: {
    opacity: 0.5
  },
  sectionLabel: {
    color: palette.textSecondary,
    fontSize: 13,
    fontWeight: '600'
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: palette.surfaceSunken
  },
  chipActive: {
    backgroundColor: palette.brand
  },
  chipText: {
    color: palette.textSecondary,
    fontSize: 12,
    fontWeight: '600'
  },
  chipTextActive: {
    color: palette.textPrimary
  },
  dangerButton: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: palette.negative
  },
  dangerButtonText: {
    color: palette.textOnBrand,
    fontWeight: '700'
  }
})
