/**
 * Bottom-navigation glyphs drawn from plain Views.
 *
 * The app ships no icon font, and pulling one in would add megabytes of assets
 * for five shapes. These are geometric, crisp at any density, and inherit the
 * active/inactive colour. They support the labels beside them rather than
 * replacing them, so navigation is never icon-only.
 */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { radius } from '../theme/tokens'
import type { TabIconName } from './navigationModel'

export type { TabIconName }

export function TabIcon({ name, color }: { name: TabIconName; color: string }): React.JSX.Element {
  if (name === 'dashboard') {
    // The MoneyWise ascending-bars mark, reused at navigation scale.
    return (
      <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no">
        {[7, 12, 17, 22].map((height) => (
          <View key={height} style={[styles.bar, { height, backgroundColor: color }]} />
        ))}
      </View>
    )
  }

  if (name === 'income' || name === 'expenses') {
    // A ring with a plus or minus: money in versus money out.
    return (
      <View style={[styles.ring, { borderColor: color }]} accessibilityElementsHidden importantForAccessibility="no">
        <View style={[styles.horizontalStroke, { backgroundColor: color }]} />
        {name === 'income' ? <View style={[styles.verticalStroke, { backgroundColor: color }]} /> : null}
      </View>
    )
  }

  if (name === 'budget') {
    // A track with a filled portion: an allowance partly consumed.
    return (
      <View style={styles.budget} accessibilityElementsHidden importantForAccessibility="no">
        <View style={[styles.budgetTrack, { borderColor: color }]}>
          <View style={[styles.budgetFill, { backgroundColor: color }]} />
        </View>
        <View style={[styles.budgetTrack, { borderColor: color }]}>
          <View style={[styles.budgetFill, styles.budgetFillShort, { backgroundColor: color }]} />
        </View>
      </View>
    )
  }

  return (
    <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no">
      {[0, 1, 2].map((index) => (
        <View key={index} style={[styles.dot, { backgroundColor: color }]} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 2,
    height: 22
  },
  bar: {
    width: 3.5,
    borderRadius: radius.pill
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: radius.pill,
    marginBottom: 9
  },
  ring: {
    width: 21,
    height: 21,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center'
  },
  horizontalStroke: {
    position: 'absolute',
    width: 9,
    height: 2,
    borderRadius: radius.pill
  },
  verticalStroke: {
    position: 'absolute',
    width: 2,
    height: 9,
    borderRadius: radius.pill
  },
  budget: {
    height: 22,
    justifyContent: 'center',
    gap: 4,
    width: 22
  },
  budgetTrack: {
    height: 7,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    overflow: 'hidden'
  },
  budgetFill: {
    height: '100%',
    width: '65%',
    borderRadius: radius.pill
  },
  budgetFillShort: {
    width: '35%'
  }
})
