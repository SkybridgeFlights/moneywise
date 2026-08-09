import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

export interface AppTab {
  id: 'dashboard' | 'expenses' | 'income' | 'budget' | 'goals' | 'debts' | 'settings'
  label: string
}

interface AppShellProps {
  title: string
  subtitle: string
  tabs: AppTab[]
  activeTab: AppTab['id']
  onTabChange: (tab: AppTab['id']) => void
  onSync: () => void
  syncEnabled: boolean
  syncPhase: 'disabled' | 'idle' | 'syncing' | 'error'
  children: React.ReactNode
}

export function AppShell({
  title,
  subtitle,
  tabs,
  activeTab,
  onTabChange,
  onSync,
  syncEnabled,
  syncPhase,
  children
}: AppShellProps): React.JSX.Element {
  const syncLabel = syncPhase === 'syncing' ? 'Syncing' : syncPhase === 'error' ? 'Offline' : syncPhase === 'disabled' ? 'Local' : 'Synced'
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <View style={styles.headerActions}>
          <View style={styles.syncBadge}>
            <View style={[styles.syncDot, syncPhase === 'error' ? styles.syncDotError : syncPhase === 'syncing' ? styles.syncDotBusy : syncEnabled ? styles.syncDotReady : styles.syncDotDisabled]} />
            <Text style={styles.syncBadgeText}>{syncLabel}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={onSync}
            style={[styles.syncButton, syncEnabled ? styles.syncButtonEnabled : styles.syncButtonDisabled]}
            disabled={!syncEnabled || syncPhase === 'syncing'}
          >
            <Text style={styles.syncButtonText}>Sync</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.body}>{children}</View>
      <View style={styles.bottomBar}>
        {tabs.map((tab) => (
          <Pressable
            accessibilityRole="button"
            key={tab.id}
            onPress={() => onTabChange(tab.id)}
            style={[styles.bottomTab, tab.id === activeTab ? styles.bottomTabActive : null]}
          >
            <Text style={[styles.bottomTabLabel, tab.id === activeTab ? styles.bottomTabLabelActive : null]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  headerText: {
    flex: 1,
    paddingRight: 12
  },
  title: {
    color: '#f8fafc',
    fontSize: 25,
    fontWeight: '800'
  },
  subtitle: {
    color: '#94a3b8',
    marginTop: 4,
    fontSize: 13
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  syncBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#0c1527',
    borderWidth: 1,
    borderColor: '#22314b',
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  syncDot: {
    width: 8,
    height: 8,
    borderRadius: 99
  },
  syncDotReady: {
    backgroundColor: '#22c55e'
  },
  syncDotBusy: {
    backgroundColor: '#f59e0b'
  },
  syncDotError: {
    backgroundColor: '#ef4444'
  },
  syncDotDisabled: {
    backgroundColor: '#64748b'
  },
  syncBadgeText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '700'
  },
  syncButton: {
    borderRadius: 999,
    minWidth: 52,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center'
  },
  syncButtonEnabled: {
    backgroundColor: '#0f766e'
  },
  syncButtonDisabled: {
    backgroundColor: '#1e293b'
  },
  syncButtonText: {
    color: '#f8fafc',
    fontWeight: '800',
    fontSize: 12
  },
  body: {
    flex: 1
  },
  bottomBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#1d2b42',
    backgroundColor: '#09111f',
    paddingBottom: 18,
    paddingTop: 10,
    paddingHorizontal: 8,
    gap: 6
  },
  bottomTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 16
  },
  bottomTabActive: {
    backgroundColor: '#13233b'
  },
  bottomTabLabel: {
    color: '#7b8aa0',
    fontSize: 11,
    fontWeight: '700'
  },
  bottomTabLabelActive: {
    color: '#f8fafc'
  }
})
