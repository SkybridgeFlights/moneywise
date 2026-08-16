import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Button } from './ui'
import { palette, radius, spacing, statusPalette, typography, type StatusTone } from '../theme/tokens'

interface NoticeCardProps {
  title: string
  description: string
  tone?: 'neutral' | 'success' | 'warning' | 'error'
  actionLabel?: string
  onAction?: () => void
}

/** Legacy tone names map onto the shared status scale. */
const toneMap: Record<NonNullable<NoticeCardProps['tone']>, StatusTone> = {
  neutral: 'neutral',
  success: 'positive',
  warning: 'warning',
  error: 'negative'
}

/** A glyph accompanies the colour so status never depends on hue alone. */
const glyphMap: Record<StatusTone, string> = { neutral: 'i', positive: '✓', warning: '!', negative: '×', brand: 'i' }

export function NoticeCard({ title, description, tone = 'neutral', actionLabel, onAction }: NoticeCardProps): React.JSX.Element {
  const status = toneMap[tone]
  const colors = statusPalette[status]
  return (
    <View
      accessible
      accessibilityRole={tone === 'error' ? 'alert' : 'summary'}
      accessibilityLabel={`${title}. ${description}`}
      style={[styles.card, { backgroundColor: colors.bg, borderColor: colors.border }]}
    >
      <View style={styles.headerRow}>
        <View style={[styles.glyph, { borderColor: colors.border }]}>
          <Text style={[styles.glyphText, { color: colors.fg }]}>{glyphMap[status]}</Text>
        </View>
        <Text style={[styles.title, { color: colors.fg }]}>{title}</Text>
      </View>
      <Text style={styles.description}>{description}</Text>
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} variant="secondary" /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.sm
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  glyph: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  glyphText: {
    ...typography.caption,
    fontWeight: '800'
  },
  title: {
    ...typography.bodyStrong,
    flex: 1
  },
  description: {
    ...typography.body,
    color: palette.textSecondary,
    lineHeight: 21
  }
})
