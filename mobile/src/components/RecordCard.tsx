import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { confirmRecordDeletion } from '../services/destructiveActions'

interface RecordCardProps {
  title: string
  subtitle: string
  value: string
  onEdit: () => void
  onDelete: () => void
}

export function RecordCard({ title, subtitle, value, onEdit, onDelete }: RecordCardProps): React.JSX.Element {
  const confirmDelete = (): void => confirmRecordDeletion(title, onDelete)
  return (
    <View style={styles.card} accessible accessibilityRole="summary" accessibilityLabel={`${title}, ${value}. ${subtitle}`}>
      <View style={styles.header}>
        <View style={styles.copy}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <Text style={styles.value}>{value}</Text>
      </View>
      <View style={styles.actions}>
        <Pressable onPress={onEdit} style={[styles.action, styles.editAction]} accessibilityRole="button" accessibilityLabel={`Edit ${title}`}>
          <Text style={styles.actionLabel}>Edit</Text>
        </Pressable>
        <Pressable onPress={confirmDelete} style={[styles.action, styles.deleteAction]} accessibilityRole="button" accessibilityLabel={`Delete ${title}`} accessibilityHint="Opens a confirmation dialog">
          <Text style={styles.actionLabel}>Delete</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    backgroundColor: '#0c1527',
    borderWidth: 1,
    borderColor: '#1c2940',
    padding: 16,
    gap: 12
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12
  },
  copy: {
    flex: 1,
    gap: 4
  },
  title: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 16
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 18
  },
  value: {
    color: '#7dd3fc',
    fontSize: 18,
    fontWeight: '800'
  },
  actions: {
    flexDirection: 'row',
    gap: 10
  },
  action: {
    borderRadius: 999,
    minWidth: 68,
    height: 36,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center'
  },
  editAction: {
    backgroundColor: '#1d4ed8'
  },
  deleteAction: {
    backgroundColor: '#991b1b'
  },
  actionLabel: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 12
  }
})
