/**
 * Bottom-navigation model, kept free of React Native imports so it can be unit
 * tested directly.
 *
 * Seven label-only tabs were cramped below the touch-target minimum, so the bar
 * carries five destinations and the rest live behind "More".
 */
export type AppTabId = 'dashboard' | 'expenses' | 'income' | 'budget' | 'goals' | 'debts' | 'settings' | 'more'

export type TabIconName = 'dashboard' | 'expenses' | 'income' | 'budget' | 'more'

export interface AppTab {
  id: AppTabId
  label: string
}

/** Destinations reachable from the "More" tab rather than the bottom bar. */
export const SECONDARY_TABS: AppTabId[] = ['goals', 'debts', 'settings']

/** The five bottom-bar destinations, in order. */
export const PRIMARY_TABS: Array<{ id: AppTabId; icon: TabIconName }> = [
  { id: 'dashboard', icon: 'dashboard' },
  { id: 'expenses', icon: 'expenses' },
  { id: 'income', icon: 'income' },
  { id: 'budget', icon: 'budget' },
  { id: 'more', icon: 'more' }
]

/** "More" stays highlighted while any of its destinations is open. */
export function resolveActivePrimaryTab(activeTab: AppTabId): AppTabId {
  return SECONDARY_TABS.includes(activeTab) ? 'more' : activeTab
}
