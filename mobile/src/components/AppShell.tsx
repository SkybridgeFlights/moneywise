import React from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { TabIcon } from './TabIcon'
import { PRIMARY_TABS, SECONDARY_TABS, resolveActivePrimaryTab, type AppTab, type AppTabId } from './navigationModel'
import { palette, radius, sizing, spacing, statusPalette, typography } from '../theme/tokens'

// Re-exported so screens can import the navigation model from the shell.
export { PRIMARY_TABS, SECONDARY_TABS, resolveActivePrimaryTab }
export type { AppTab, AppTabId }

interface AppShellProps {
  title: string
  subtitle: string
  tabs: AppTab[]
  activeTab: AppTabId
  onTabChange: (tab: AppTabId) => void
  onSync: () => void
  syncEnabled: boolean
  syncPhase: 'disabled' | 'idle' | 'syncing' | 'error'
  syncLabel: string
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
  syncLabel,
  children
}: AppShellProps): React.JSX.Element {
  const insets = useSafeAreaInsets()
  const activePrimary = resolveActivePrimaryTab(activeTab)
  const labelFor = (id: AppTabId): string => tabs.find((tab) => tab.id === id)?.label ?? id
  const tone = syncPhase === 'error' ? 'negative' : syncPhase === 'syncing' ? 'warning' : syncEnabled ? 'positive' : 'neutral'
  const statusColors = statusPalette[tone]

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text accessibilityRole="header" style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Sync now. Status: ${syncLabel}`}
          accessibilityState={{ disabled: !syncEnabled || syncPhase === 'syncing', busy: syncPhase === 'syncing' }}
          onPress={onSync}
          disabled={!syncEnabled || syncPhase === 'syncing'}
          style={({ pressed }) => [
            styles.syncControl,
            { borderColor: statusColors.border, backgroundColor: statusColors.bg },
            pressed ? styles.pressed : null,
            !syncEnabled ? styles.syncControlDisabled : null
          ]}
        >
          <View style={[styles.syncDot, { backgroundColor: statusColors.fg }]} />
          <Text style={[styles.syncLabel, { color: statusColors.fg }]}>{syncLabel}</Text>
        </Pressable>
      </View>

      <View style={styles.body}>{children}</View>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        {PRIMARY_TABS.map((tab) => {
          const isActive = tab.id === activePrimary
          const color = isActive ? palette.brand : palette.textMuted
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityLabel={labelFor(tab.id)}
              accessibilityState={{ selected: isActive }}
              key={tab.id}
              onPress={() => onTabChange(tab.id)}
              style={({ pressed }) => [styles.bottomTab, pressed ? styles.pressed : null]}
            >
              <TabIcon name={tab.icon} color={color} />
              <Text style={[styles.bottomTabLabel, { color }]} numberOfLines={1}>
                {labelFor(tab.id)}
              </Text>
              {isActive ? <View style={styles.activeIndicator} /> : null}
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  header: {
    paddingHorizontal: sizing.screenPadding,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md
  },
  headerText: {
    flex: 1
  },
  title: {
    ...typography.title,
    color: palette.textPrimary
  },
  subtitle: {
    ...typography.caption,
    color: palette.textSecondary,
    marginTop: 2
  },
  syncControl: {
    minHeight: sizing.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md
  },
  syncControlDisabled: {
    opacity: 0.6
  },
  syncDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill
  },
  syncLabel: {
    ...typography.caption,
    fontWeight: '700'
  },
  pressed: {
    opacity: 0.7
  },
  body: {
    flex: 1
  },
  bottomBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
    backgroundColor: palette.surfaceSunken,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.sm
  },
  bottomTab: {
    flex: 1,
    minHeight: sizing.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    borderRadius: radius.md
  },
  bottomTabLabel: {
    ...typography.caption,
    fontWeight: '600',
    // Android clips descenders on tight line boxes without this.
    lineHeight: Platform.OS === 'android' ? 15 : 14
  },
  activeIndicator: {
    position: 'absolute',
    top: 0,
    height: 3,
    width: 26,
    borderRadius: radius.pill,
    backgroundColor: palette.brand
  }
})
