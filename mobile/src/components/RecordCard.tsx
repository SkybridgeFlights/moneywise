import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { confirmRecordDeletion } from '../services/destructiveActions'
import { elevation, palette, radius, sizing, spacing, typography } from '../theme/tokens'

interface RecordCardProps {
  title: string
  subtitle: string
  value: string
  /** Optional trailing meta, e.g. a category or status word. */
  meta?: string
  onEdit: () => void
  onDelete: () => void
}

export function RecordCard({ title, subtitle, value, meta, onEdit, onDelete }: RecordCardProps): React.JSX.Element {
  const confirmDelete = (): void => confirmRecordDeletion(title, onDelete)
  return (
    <View style={styles.card}>
      <View accessible accessibilityRole="summary" accessibilityLabel={`${title}, ${value}. ${subtitle}`} style={styles.header}>
        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
          {meta ? <Text style={styles.meta}>{meta}</Text> : null}
        </View>
        <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
          {value}
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={onEdit}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${title}`}
          style={({ pressed }) => [styles.action, styles.editAction, pressed ? styles.pressed : null]}
        >
          <Text style={styles.editLabel}>Edit</Text>
        </Pressable>
        <Pressable
          onPress={confirmDelete}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${title}`}
          accessibilityHint="Opens a confirmation dialog"
          style={({ pressed }) => [styles.action, styles.deleteAction, pressed ? styles.pressed : null]}
        >
          <Text style={styles.deleteLabel}>Delete</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.lg,
    gap: spacing.md,
    ...elevation.card
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md
  },
  copy: {
    flex: 1,
    gap: spacing.xs
  },
  title: {
    ...typography.bodyStrong,
    color: palette.textPrimary
  },
  subtitle: {
    ...typography.caption,
    color: palette.textSecondary,
    lineHeight: 17
  },
  meta: {
    ...typography.caption,
    color: palette.textMuted
  },
  value: {
    ...typography.metric,
    color: palette.textPrimary,
    flexShrink: 0,
    maxWidth: '45%',
    textAlign: 'right'
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm
  },
  action: {
    flex: 1,
    minHeight: sizing.minTouchTarget,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1
  },
  pressed: {
    opacity: 0.7
  },
  editAction: {
    backgroundColor: palette.surfaceRaised,
    borderColor: palette.border
  },
  editLabel: {
    ...typography.label,
    color: palette.textPrimary
  },
  // Destructive action reads differently from the neutral one: outlined in the
  // negative colour rather than another solid block.
  deleteAction: {
    backgroundColor: 'transparent',
    borderColor: palette.negative
  },
  deleteLabel: {
    ...typography.label,
    color: palette.negative
  }
})
