import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Card, Screen, SectionHeader, StatusPill } from '../components/ui'
import type { AppTabId } from '../components/AppShell'
import { elevation, palette, radius, sizing, spacing, typography } from '../theme/tokens'

interface MoreScreenProps {
  onNavigate: (tab: AppTabId) => void
  accountEmail: string | null
  syncSummary: string
  pendingChanges: number
}

interface Destination {
  id: AppTabId
  title: string
  description: string
}

const destinations: Destination[] = [
  { id: 'goals', title: 'Goals', description: 'Track what you are saving towards and how much is left.' },
  { id: 'debts', title: 'Debts', description: 'Plan instalments and see what is still outstanding.' },
  { id: 'settings', title: 'Settings', description: 'Account, sync, language, currency and device data.' }
]

export function MoreScreen({ onNavigate, accountEmail, syncSummary, pendingChanges }: MoreScreenProps): React.JSX.Element {
  return (
    <Screen>
      <Card>
        <SectionHeader title="Account" subtitle={accountEmail ?? 'Not signed in on this device'} />
        <View style={styles.accountRow}>
          <StatusPill tone={pendingChanges > 0 ? 'warning' : 'positive'} label={syncSummary} />
          {pendingChanges > 0 ? (
            <Text style={styles.pendingText}>
              {pendingChanges} change{pendingChanges === 1 ? '' : 's'} waiting to sync
            </Text>
          ) : null}
        </View>
      </Card>

      <View style={styles.list}>
        {destinations.map((destination) => (
          <Pressable
            key={destination.id}
            accessibilityRole="button"
            accessibilityLabel={destination.title}
            accessibilityHint={destination.description}
            onPress={() => onNavigate(destination.id)}
            style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
          >
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{destination.title}</Text>
              <Text style={styles.rowDescription}>{destination.description}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flexWrap: 'wrap'
  },
  pendingText: {
    ...typography.caption,
    color: palette.textSecondary
  },
  list: {
    gap: spacing.md
  },
  row: {
    minHeight: sizing.minTouchTarget + 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    ...elevation.card
  },
  pressed: {
    opacity: 0.75
  },
  rowCopy: {
    flex: 1,
    gap: spacing.xs
  },
  rowTitle: {
    ...typography.bodyStrong,
    color: palette.textPrimary
  },
  rowDescription: {
    ...typography.caption,
    color: palette.textSecondary,
    lineHeight: 17
  },
  chevron: {
    fontSize: 26,
    color: palette.textMuted,
    lineHeight: 28
  }
})
