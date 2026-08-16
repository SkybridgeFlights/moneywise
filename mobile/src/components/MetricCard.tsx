import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { elevation, palette, radius, sizing, spacing, statusPalette, typography, type StatusTone } from '../theme/tokens'

interface MetricCardProps {
  label: string
  value: string
  /** Optional supporting line, e.g. what the figure is measured against. */
  hint?: string
  tone?: StatusTone
  onPress?: () => void
}

export function MetricCard({ label, value, hint, tone = 'brand', onPress }: MetricCardProps): React.JSX.Element {
  const accent = statusPalette[tone].fg
  const content = (
    <>
      <View style={[styles.accent, { backgroundColor: accent }]} />
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {value}
      </Text>
      {hint ? (
        <Text style={styles.hint} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </>
  )

  if (!onPress) {
    return (
      <View accessible accessibilityRole="text" accessibilityLabel={`${label}: ${value}${hint ? `. ${hint}` : ''}`} style={styles.card}>
        {content}
      </View>
    )
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}${hint ? `. ${hint}` : ''}`}
      accessibilityHint="Opens the related screen"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      {content}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 0,
    minHeight: 96,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.xs,
    justifyContent: 'center',
    ...elevation.card
  },
  pressed: {
    opacity: 0.75
  },
  accent: {
    width: sizing.iconSm + 6,
    height: 3,
    borderRadius: radius.pill,
    marginBottom: spacing.xs
  },
  label: {
    ...typography.caption,
    color: palette.textSecondary
  },
  value: {
    ...typography.metric,
    color: palette.textPrimary
  },
  hint: {
    ...typography.caption,
    color: palette.textMuted
  }
})
