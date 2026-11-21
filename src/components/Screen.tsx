import type { ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme/useTheme';
import { useKeyboardVisible } from './useKeyboardVisible';

export type ScreenProps = {
  readonly children?: ReactNode;
  readonly title?: string;
  /** Wrap the content in a ScrollView (taps on inputs/buttons still work with the keyboard up). */
  readonly scroll?: boolean;
  /** Pinned at the bottom, above the keyboard: where primary actions go (bottom third). */
  readonly footer?: ReactNode;
  /**
   * Pad the footer by the bottom safe-area inset. Use on screens outside the
   * tabs (the tab bar supplies the inset there), e.g. onboarding. Dropped
   * while the keyboard is up: the keyboard already covers the inset.
   */
  readonly bottomInset?: boolean;
};

/** Screen wrapper: top safe area, board background, 16dp gutter, optional title and footer. */
export function Screen({
  children,
  title,
  scroll = false,
  footer,
  bottomInset = false,
}: ScreenProps) {
  const { colors, typography, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  // The KeyboardAvoidingView already lifts the footer onto the keyboard's top edge.
  const footerBottom = spacing.gutter + (bottomInset && !keyboardVisible ? insets.bottom : 0);
  const gutter = { padding: spacing.gutter };

  const header = title !== undefined && (
    <Text
      accessibilityRole="header"
      style={[typography.title, { color: colors.ink, marginBottom: spacing.sm }]}
    >
      {title}
    </Text>
  );

  return (
    <SafeAreaView
      testID="screen"
      edges={['top']}
      style={[styles.fill, { backgroundColor: colors.board }]}
    >
      {/* Edge-to-edge Android no longer resizes the window for the keyboard, so pad on both platforms. */}
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
        {scroll ? (
          <ScrollView
            testID="screen-scroll"
            keyboardShouldPersistTaps="handled"
            style={styles.fill}
            contentContainerStyle={gutter}
          >
            {header}
            {children}
          </ScrollView>
        ) : (
          <View testID="screen-content" style={[styles.fill, gutter]}>
            {header}
            {children}
          </View>
        )}
        {footer !== undefined && (
          <View
            testID="screen-footer"
            style={{ paddingHorizontal: spacing.gutter, paddingBottom: footerBottom }}
          >
            {footer}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
