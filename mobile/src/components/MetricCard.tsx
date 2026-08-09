import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

interface MetricCardProps {
  label: string
  value: string
  accent?: string
}

export function MetricCard({ label, value, accent = '#38bdf8' }: MetricCardProps): React.JSX.Element {
  return (
    <View style={styles.card}>
      <View style={[styles.dot, { backgroundColor: accent }]} />
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 150,
    borderRadius: 18,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 14,
    gap: 8
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 999
  },
  label: {
    color: '#94a3b8',
    fontSize: 13
  },
  value: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '700'
  }
})
