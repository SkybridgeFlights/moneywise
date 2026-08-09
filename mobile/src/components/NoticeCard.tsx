import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

interface NoticeCardProps {
  title: string
  description: string
  tone?: 'neutral' | 'success' | 'warning' | 'error'
}

const toneStyles = {
  neutral: { backgroundColor: '#0f172a', borderColor: '#1e293b', titleColor: '#f8fafc', bodyColor: '#94a3b8' },
  success: { backgroundColor: '#052e16', borderColor: '#166534', titleColor: '#dcfce7', bodyColor: '#86efac' },
  warning: { backgroundColor: '#3f2a05', borderColor: '#a16207', titleColor: '#fef3c7', bodyColor: '#fcd34d' },
  error: { backgroundColor: '#3f0f1d', borderColor: '#9f1239', titleColor: '#ffe4e6', bodyColor: '#fda4af' }
} as const

export function NoticeCard({ title, description, tone = 'neutral' }: NoticeCardProps): React.JSX.Element {
  const palette = toneStyles[tone]
  return (
    <View style={[styles.card, { backgroundColor: palette.backgroundColor, borderColor: palette.borderColor }]}>
      <Text style={[styles.title, { color: palette.titleColor }]}>{title}</Text>
      <Text style={[styles.description, { color: palette.bodyColor }]}>{description}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 6
  },
  title: {
    fontSize: 15,
    fontWeight: '700'
  },
  description: {
    fontSize: 13,
    lineHeight: 18
  }
})
