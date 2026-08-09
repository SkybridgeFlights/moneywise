import React, { useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
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
  syncMessage: string
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
  syncMessage,
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

  async function submitAuth(mode: 'login' | 'register'): Promise<void> {
    setAuthError(null)
    try {
      await (mode === 'login' ? onLogin(email.trim(), password) : onRegister(email.trim(), password))
      setPassword('')
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Authentication failed')
    }
  }

  const languageOptions: Array<{ label: string; value: Settings['language']; locale: string; rtl: boolean }> = [
    { label: 'English', value: 'en', locale: 'en-US', rtl: false },
    { label: 'Arabic', value: 'ar', locale: 'ar', rtl: true }
  ]
  const currencyOptions = ['USD', 'EUR', 'GBP', 'SAR', 'AED', 'EGP', 'JOD']

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <NoticeCard
        title={syncEnabled ? 'Sync status' : 'Local-first mode'}
        description={
          syncEnabled
            ? `${syncMessage}. Last sync: ${formatDateTime(syncState.lastSyncAt)}. Pending local changes: ${pendingChanges}.`
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
        {syncState.lastError ? <NoticeCard title="Last sync error" description={syncState.lastError} tone="error" /> : null}
        {syncEnabled && !syncState.userId ? (
          <View style={styles.authForm}>
            <LabeledInput label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
            <LabeledInput label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="current-password" />
            {authError ? <NoticeCard title="Authentication failed" description={authError} tone="error" /> : null}
            <View style={styles.actions}>
              <Pressable accessibilityRole="button" onPress={() => void submitAuth('login')} style={styles.primaryButton} disabled={!email.trim() || password.length < 8}>
                <Text style={styles.primaryButtonText}>Sign in</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => void submitAuth('register')} style={styles.secondaryButton} disabled={!email.trim() || password.length < 8}>
                <Text style={styles.secondaryButtonText}>Create account</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        <View style={styles.actions}>
          <Pressable onPress={onSyncNow} style={[styles.primaryButton, (!syncEnabled || syncState.paused || syncPhase === 'syncing') && styles.buttonDisabled]} disabled={!syncEnabled || syncState.paused || syncPhase === 'syncing'}>
            <Text style={styles.primaryButtonText}>{syncPhase === 'syncing' ? 'Syncing...' : 'Sync now'}</Text>
          </Pressable>
          <Pressable onPress={() => onTogglePaused(!syncState.paused)} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>{syncState.paused ? 'Resume sync' : 'Pause sync'}</Text>
          </Pressable>
        </View>
        {syncState.userId ? (
          <Pressable accessibilityRole="button" onPress={() => void onLogout()} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Sign out / switch account</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Preferences</Text>
        <Text style={styles.cardSubtitle}>Stored locally and synced when available.</Text>
        <Text style={styles.sectionLabel}>Language</Text>
        <View style={styles.chips}>
          {languageOptions.map((option) => (
            <Pressable
              key={option.value}
              onPress={() => onUpdateSettings({ language: option.value, locale: option.locale, rtl: option.rtl })}
              style={[styles.chip, settings.language === option.value ? styles.chipActive : null]}
            >
              <Text style={[styles.chipText, settings.language === option.value ? styles.chipTextActive : null]}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.sectionLabel}>Currency</Text>
        <View style={styles.chips}>
          {currencyOptions.map((currency) => (
            <Pressable
              key={currency}
              onPress={() => onUpdateSettings({ currency })}
              style={[styles.chip, settings.currency === currency ? styles.chipActive : null]}
            >
              <Text style={[styles.chipText, settings.currency === currency ? styles.chipTextActive : null]}>{currency}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Planning</Text>
        <Text style={styles.cardSubtitle}>Open debt planning without crowding the main bottom navigation.</Text>
        <Pressable onPress={onOpenDebts} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Open debts</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Safety</Text>
        <Text style={styles.cardSubtitle}>Destructive actions require confirmation.</Text>
        <Pressable
          onPress={() =>
            Alert.alert('Reset local data?', 'This clears local finance and sync state on this device. Remote data is not deleted.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Reset', style: 'destructive', onPress: onResetData }
            ])
          }
          style={styles.dangerButton}
        >
          <Text style={styles.dangerButtonText}>Reset local device data</Text>
        </Pressable>
      </View>
    </ScrollView>
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
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 16,
    gap: 12
  },
  cardTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700'
  },
  cardSubtitle: {
    color: '#94a3b8',
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
    color: '#94a3b8',
    fontSize: 13,
    flex: 1
  },
  metricValue: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right'
  },
  actions: {
    flexDirection: 'row',
    gap: 10
  },
  authForm: { gap: 10 },
  primaryButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#0f766e'
  },
  primaryButtonText: {
    color: '#f8fafc',
    fontWeight: '700'
  },
  secondaryButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#334155'
  },
  secondaryButtonText: {
    color: '#f8fafc',
    fontWeight: '700'
  },
  buttonDisabled: {
    opacity: 0.5
  },
  sectionLabel: {
    color: '#cbd5e1',
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
    backgroundColor: '#111827'
  },
  chipActive: {
    backgroundColor: '#1d4ed8'
  },
  chipText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '600'
  },
  chipTextActive: {
    color: '#eff6ff'
  },
  dangerButton: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#991b1b'
  },
  dangerButtonText: {
    color: '#fff1f2',
    fontWeight: '700'
  }
})
