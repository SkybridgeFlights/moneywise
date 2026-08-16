/**
 * Shared MoneyWise UI primitives.
 *
 * Every screen composes these instead of restating card, button, chip and
 * progress styling. All sizing comes from the token scale, so controls meet the
 * 44pt touch-target minimum by construction.
 */
import React from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle
} from 'react-native'
import { elevation, motion, palette, radius, sizing, spacing, statusPalette, typography, type StatusTone } from '../theme/tokens'

/* ------------------------------- motion ---------------------------------- */

/** Tracks the OS "reduce motion" setting so animations can be skipped. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false)
  React.useEffect(() => {
    let active = true
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduced(value)
    })
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced)
    return () => {
      active = false
      subscription.remove()
    }
  }, [])
  return reduced
}

/** Fades and lifts content in once. Becomes a no-op under reduced motion. */
export function FadeIn({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }): React.JSX.Element {
  const reduced = useReducedMotion()
  const progress = React.useRef(new Animated.Value(0)).current

  React.useEffect(() => {
    if (reduced) {
      progress.setValue(1)
      return
    }
    Animated.timing(progress, { toValue: 1, duration: motion.base, useNativeDriver: true }).start()
  }, [progress, reduced])

  return (
    <Animated.View
      style={[
        style,
        { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }
      ]}
    >
      {children}
    </Animated.View>
  )
}

/* -------------------------------- layout --------------------------------- */

export function Screen({ children, contentStyle }: { children: React.ReactNode; contentStyle?: StyleProp<ViewStyle> }): React.JSX.Element {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.screenContent, contentStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  )
}

export function Card({
  children,
  style,
  tone
}: {
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
  tone?: StatusTone
}): React.JSX.Element {
  const toned = tone ? { backgroundColor: statusPalette[tone].bg, borderColor: statusPalette[tone].border } : null
  return <View style={[styles.card, toned, style]}>{children}</View>
}

export function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }): React.JSX.Element {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderCopy}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  )
}

/* -------------------------------- buttons -------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  busy,
  accessibilityHint,
  style
}: {
  label: string
  onPress: () => void
  variant?: ButtonVariant
  disabled?: boolean
  busy?: boolean
  accessibilityHint?: string
  style?: StyleProp<ViewStyle>
}): React.JSX.Element {
  const inactive = Boolean(disabled) || Boolean(busy)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: Boolean(busy) }}
      onPress={onPress}
      disabled={inactive}
      // Pressed feedback is immediate so taps never feel dropped.
      style={({ pressed }) => [
        styles.button,
        variantStyles[variant],
        pressed && !inactive ? styles.buttonPressed : null,
        inactive ? styles.buttonDisabled : null,
        style
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={variant === 'secondary' || variant === 'ghost' ? palette.textPrimary : palette.textOnBrand} /> : null}
      <Text style={[styles.buttonLabel, variant === 'ghost' ? styles.buttonLabelGhost : null]}>{label}</Text>
    </Pressable>
  )
}

export function Chip({
  label,
  selected,
  onPress,
  accessibilityLabel
}: {
  label: string
  selected: boolean
  onPress: () => void
  accessibilityLabel?: string
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      // Selection is exposed to screen readers rather than implied by colour.
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected ? styles.chipSelected : null, pressed ? styles.buttonPressed : null]}
    >
      <Text style={[styles.chipLabel, selected ? styles.chipLabelSelected : null]}>{label}</Text>
    </Pressable>
  )
}

/* -------------------------------- status --------------------------------- */

/** Status pill carrying a glyph as well as colour, so colour is never the only cue. */
export function StatusPill({ tone, label }: { tone: StatusTone; label: string }): React.JSX.Element {
  const glyphs: Record<StatusTone, string> = { neutral: '•', positive: '✓', warning: '!', negative: '×', brand: '•' }
  const colors = statusPalette[tone]
  return (
    <View style={[styles.pill, { backgroundColor: colors.bg, borderColor: colors.border }]}>
      <Text style={[styles.pillGlyph, { color: colors.fg }]}>{glyphs[tone]}</Text>
      <Text style={[styles.pillLabel, { color: colors.fg }]}>{label}</Text>
    </View>
  )
}

export function ProgressBar({
  ratio,
  tone = 'brand',
  label
}: {
  ratio: number
  tone?: StatusTone
  label?: string
}): React.JSX.Element {
  const reduced = useReducedMotion()
  const clamped = Number.isFinite(ratio) ? Math.min(Math.max(ratio, 0), 1) : 0
  const width = React.useRef(new Animated.Value(reduced ? clamped : 0)).current

  React.useEffect(() => {
    if (reduced) {
      width.setValue(clamped)
      return
    }
    Animated.timing(width, { toValue: clamped, duration: motion.slow, useNativeDriver: false }).start()
  }, [clamped, reduced, width])

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={styles.progressTrack}
    >
      <Animated.View
        style={[
          styles.progressFill,
          {
            backgroundColor: statusPalette[tone].fg,
            width: width.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })
          }
        ]}
      />
    </View>
  )
}

/* ------------------------- empty / loading / error ------------------------ */

export type ScreenStateKind = 'empty' | 'loading' | 'error' | 'offline'

/** Deliberate UI for the states a screen can be in besides "has content". */
export function StateView({
  kind,
  title,
  description,
  actionLabel,
  onAction
}: {
  kind: ScreenStateKind
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}): React.JSX.Element {
  const glyphs: Record<ScreenStateKind, string> = { empty: '＋', loading: '', error: '!', offline: '⇅' }
  const tone: Record<ScreenStateKind, StatusTone> = { empty: 'brand', loading: 'neutral', error: 'negative', offline: 'warning' }
  const colors = statusPalette[tone[kind]]

  return (
    <Card style={styles.stateCard}>
      <View style={[styles.stateGlyph, { backgroundColor: colors.bg, borderColor: colors.border }]}>
        {kind === 'loading' ? <ActivityIndicator color={palette.brand} /> : <Text style={[styles.stateGlyphText, { color: colors.fg }]}>{glyphs[kind]}</Text>}
      </View>
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateDescription}>{description}</Text>
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} variant="secondary" style={styles.stateAction} /> : null}
    </Card>
  )
}

/** Placeholder block used while first-load data is hydrating. */
export function Skeleton({ height = 18, width = '100%' }: { height?: number; width?: number | `${number}%` }): React.JSX.Element {
  const reduced = useReducedMotion()
  const pulse = React.useRef(new Animated.Value(0.4)).current

  React.useEffect(() => {
    if (reduced) return
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.85, duration: 620, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 620, useNativeDriver: true })
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [pulse, reduced])

  return <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.skeleton, { height, width, opacity: pulse }]} />
}

/* -------------------------------- styles --------------------------------- */

const styles = StyleSheet.create({
  screen: {
    flex: 1
  },
  screenContent: {
    paddingHorizontal: sizing.screenPadding,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxxl,
    gap: spacing.md
  },
  card: {
    borderRadius: radius.xl,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.lg,
    gap: spacing.md,
    ...elevation.card
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md
  },
  sectionHeaderCopy: {
    flex: 1,
    gap: spacing.xs
  },
  sectionTitle: {
    ...typography.section,
    color: palette.textPrimary
  },
  sectionSubtitle: {
    ...typography.caption,
    color: palette.textSecondary,
    lineHeight: 17
  },
  button: {
    minHeight: sizing.controlHeight,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm
  },
  buttonPressed: {
    opacity: 0.75
  },
  buttonDisabled: {
    opacity: 0.45
  },
  buttonLabel: {
    ...typography.bodyStrong,
    color: palette.textOnBrand
  },
  buttonLabelGhost: {
    color: palette.brandText
  },
  chip: {
    minHeight: sizing.minTouchTarget,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    backgroundColor: palette.surfaceSunken,
    borderWidth: 1,
    borderColor: palette.border
  },
  chipSelected: {
    backgroundColor: palette.brandSoft,
    borderColor: palette.brand
  },
  chipLabel: {
    ...typography.label,
    color: palette.textSecondary
  },
  chipLabelSelected: {
    color: palette.textPrimary
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2
  },
  pillGlyph: {
    ...typography.caption,
    fontWeight: '800'
  },
  pillLabel: {
    ...typography.caption,
    fontWeight: '700'
  },
  progressTrack: {
    height: sizing.progressTrack,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceSunken,
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.pill
  },
  stateCard: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.sm
  },
  stateGlyph: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs
  },
  stateGlyphText: {
    fontSize: 22,
    fontWeight: '700'
  },
  stateTitle: {
    ...typography.section,
    color: palette.textPrimary,
    textAlign: 'center'
  },
  stateDescription: {
    ...typography.body,
    color: palette.textSecondary,
    textAlign: 'center',
    lineHeight: 21
  },
  stateAction: {
    marginTop: spacing.sm,
    alignSelf: 'stretch'
  },
  skeleton: {
    borderRadius: radius.sm,
    backgroundColor: palette.surfaceRaised
  }
})

const variantStyles = StyleSheet.create({
  primary: {
    backgroundColor: palette.brand
  },
  secondary: {
    backgroundColor: palette.surfaceRaised,
    borderWidth: 1,
    borderColor: palette.border
  },
  ghost: {
    backgroundColor: 'transparent'
  },
  danger: {
    backgroundColor: palette.negative
  }
})
