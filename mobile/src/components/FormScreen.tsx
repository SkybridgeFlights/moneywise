/**
 * Scroll container for screens whose primary content is a form.
 *
 * KeyboardAvoidingView keeps the focused field and the primary action above the
 * keyboard instead of letting the layout jump, and `keyboardShouldPersistTaps`
 * means the first tap on a button registers rather than only dismissing the
 * keyboard.
 */
import React from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { sizing, spacing } from '../theme/tokens'

export function FormScreen({
  children,
  contentStyle
}: {
  children: React.ReactNode
  contentStyle?: StyleProp<ViewStyle>
}): React.JSX.Element {
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, contentStyle]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: {
    flex: 1
  },
  content: {
    paddingHorizontal: sizing.screenPadding,
    paddingTop: spacing.xs,
    // Room for the keyboard toolbar and the bottom bar beneath the scroll view.
    paddingBottom: spacing.xxxl * 2,
    gap: spacing.md
  }
})
