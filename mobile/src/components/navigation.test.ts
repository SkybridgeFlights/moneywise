import { describe, expect, it } from 'vitest'
import { PRIMARY_TABS, SECONDARY_TABS, resolveActivePrimaryTab } from './navigationModel'

describe('bottom navigation model', () => {
  it('keeps the bottom bar to five destinations', () => {
    // Seven label-only tabs were cramped and fell below the touch-target
    // minimum; goals, debts and settings moved behind "More".
    expect(PRIMARY_TABS).toHaveLength(5)
    expect(PRIMARY_TABS.map((tab) => tab.id)).toEqual(['dashboard', 'expenses', 'income', 'budget', 'more'])
  })

  it('gives every primary destination its own icon', () => {
    const icons = PRIMARY_TABS.map((tab) => tab.icon)
    expect(new Set(icons).size).toBe(icons.length)
  })

  it('highlights More while a secondary destination is open', () => {
    for (const tab of SECONDARY_TABS) {
      expect(resolveActivePrimaryTab(tab)).toBe('more')
    }
  })

  it('highlights a primary destination directly', () => {
    expect(resolveActivePrimaryTab('dashboard')).toBe('dashboard')
    expect(resolveActivePrimaryTab('expenses')).toBe('expenses')
    expect(resolveActivePrimaryTab('more')).toBe('more')
  })

  it('never lists a secondary destination in the bottom bar', () => {
    const primaryIds = PRIMARY_TABS.map((tab) => tab.id)
    for (const secondary of SECONDARY_TABS) {
      expect(primaryIds).not.toContain(secondary)
    }
  })
})
