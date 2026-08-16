import React from 'react'
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native'
import { palette, radius, sizing, spacing, typography } from '../theme/tokens'

interface LabeledInputProps {
  label: string
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  /**
   * `money` selects the decimal keypad and the input mode that shows a decimal
   * separator, which the plain numeric keyboard omits on Android.
   */
  keyboardType?: 'default' | 'numeric' | 'money' | 'email-address'
  secureTextEntry?: boolean
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'
  autoComplete?: 'email' | 'current-password' | 'new-password' | 'off'
  error?: string | null
  hint?: string
  onSubmitEditing?: () => void
  returnKeyType?: 'done' | 'next' | 'go'
}

export function LabeledInput({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  secureTextEntry,
  autoCapitalize,
  autoComplete,
  error,
  hint,
  onSubmitEditing,
  returnKeyType
}: LabeledInputProps): React.JSX.Element {
  const [focused, setFocused] = React.useState(false)
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const errorId = `${slug}-error`
  const hintId = `${slug}-hint`
  const isMoney = keyboardType === 'money'

  return (
    <View style={styles.container}>
      <Text nativeID={`${slug}-label`} style={styles.label}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.textMuted}
        keyboardType={isMoney ? (Platform.OS === 'ios' ? 'decimal-pad' : 'numeric') : keyboardType}
        inputMode={isMoney ? 'decimal' : undefined}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={onSubmitEditing}
        returnKeyType={returnKeyType}
        accessibilityLabel={label}
        accessibilityLabelledBy={`${slug}-label`}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        aria-invalid={Boolean(error)}
        style={[styles.input, focused ? styles.inputFocused : null, error ? styles.inputError : null]}
      />
      {error ? (
        <View style={styles.messageRow}>
          <Text style={styles.errorGlyph}>!</Text>
          <Text nativeID={errorId} accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        </View>
      ) : hint ? (
        <Text nativeID={hintId} style={styles.hint}>
          {hint}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs + 2
  },
  label: {
    ...typography.label,
    color: palette.textSecondary
  },
  input: {
    minHeight: sizing.inputHeight,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSunken,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: palette.textPrimary,
    ...typography.body
  },
  inputFocused: {
    borderColor: palette.brand
  },
  inputError: {
    borderColor: palette.negative
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs
  },
  errorGlyph: {
    ...typography.caption,
    fontWeight: '800',
    color: palette.negative
  },
  error: {
    ...typography.caption,
    color: palette.negative,
    flex: 1
  },
  hint: {
    ...typography.caption,
    color: palette.textMuted
  }
})
