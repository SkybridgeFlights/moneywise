import React from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'

interface LabeledInputProps {
  label: string
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  keyboardType?: 'default' | 'numeric' | 'email-address'
  secureTextEntry?: boolean
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'
  autoComplete?: 'email' | 'current-password' | 'new-password' | 'off'
  error?: string | null
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
  error
}: LabeledInputProps): React.JSX.Element {
  const errorId = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-error`
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#64748b"
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        accessibilityLabel={label}
        accessibilityHint={error ?? undefined}
        aria-describedby={error ? errorId : undefined}
        style={[styles.input, error ? styles.inputError : null]}
      />
      {error ? <Text nativeID={errorId} accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 6
  },
  label: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600'
  },
  input: {
    borderRadius: 14,
    backgroundColor: '#09111f',
    borderWidth: 1,
    borderColor: '#1e293b',
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: '#f8fafc'
  },
  inputError: {
    borderColor: '#dc2626'
  },
  error: {
    color: '#fda4af',
    fontSize: 12
  }
})
