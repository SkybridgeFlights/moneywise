/**
 * MoneyWise mobile design tokens.
 *
 * One source of truth for colour, spacing, radius, type, elevation and control
 * sizing. Screens compose these instead of restating hex literals, so a palette
 * change lands everywhere at once.
 *
 * The surface ramp is dark-only, matching the app's existing appearance and the
 * `theme: 'dark'` default in settings. Brand blue is the single accent.
 */

export const palette = {
  // MoneyWise brand blue — the same #208AEF carried by the launcher icon,
  // adaptive icon and splash screen.
  brand: '#208AEF',
  brandStrong: '#1272D1',
  brandSoft: '#123253',
  brandText: '#9CCDFB',

  // Surface ramp, darkest to lightest.
  canvas: '#081122',
  surface: '#0F1B2E',
  surfaceRaised: '#14243C',
  surfaceSunken: '#0A1322',
  border: '#1E3050',
  borderStrong: '#2A4166',

  // Text ramp.
  textPrimary: '#F5F8FC',
  textSecondary: '#A7B6CC',
  textMuted: '#7387A1',
  textOnBrand: '#FFFFFF',

  // Status. Each is paired with an icon or label so colour is never the only cue.
  positive: '#2BB673',
  positiveSoft: '#0E2A1E',
  negative: '#E5484D',
  negativeSoft: '#2E1215',
  warning: '#E2A03F',
  warningSoft: '#2C2011',
  neutral: '#7387A1',
  neutralSoft: '#152238'
} as const

/** 4pt spacing scale. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32
} as const

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 22,
  pill: 999
} as const

/**
 * Type scale. Body sits at 15pt and the smallest supporting size is 12pt, so no
 * text falls below a comfortably legible size on a phone.
 */
export const typography = {
  display: { fontSize: 34, fontWeight: '800', letterSpacing: -0.6 },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.2 },
  section: { fontSize: 17, fontWeight: '700' },
  body: { fontSize: 15, fontWeight: '400' },
  bodyStrong: { fontSize: 15, fontWeight: '600' },
  label: { fontSize: 13, fontWeight: '600' },
  caption: { fontSize: 12, fontWeight: '500' },
  metric: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8 }
} as const

export const elevation = {
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3
  },
  raised: {
    shadowColor: '#000000',
    shadowOpacity: 0.36,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6
  }
} as const

/** Control sizing. `minTouchTarget` is the platform accessibility minimum. */
export const sizing = {
  minTouchTarget: 44,
  controlHeight: 48,
  inputHeight: 50,
  iconSm: 16,
  iconMd: 22,
  iconLg: 28,
  screenPadding: spacing.lg,
  progressTrack: 8
} as const

export type StatusTone = 'neutral' | 'positive' | 'warning' | 'negative' | 'brand'

export const statusPalette: Record<StatusTone, { fg: string; bg: string; border: string }> = {
  neutral: { fg: palette.textSecondary, bg: palette.neutralSoft, border: palette.border },
  positive: { fg: palette.positive, bg: palette.positiveSoft, border: '#1C4733' },
  warning: { fg: palette.warning, bg: palette.warningSoft, border: '#4A3717' },
  negative: { fg: palette.negative, bg: palette.negativeSoft, border: '#5A2126' },
  brand: { fg: palette.brandText, bg: palette.brandSoft, border: '#1D4C7C' }
}

/** Motion durations. Kept short so the UI never feels like it is waiting on itself. */
export const motion = {
  fast: 120,
  base: 180,
  slow: 260
} as const
