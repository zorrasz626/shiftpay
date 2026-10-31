import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { tabularNums } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

export type CardProps = {
  readonly title?: string;
  readonly children?: ReactNode;
};

/** Flat surface with a 1px line border (no shadow) and an optional title. */
export function Card({ title, children }: CardProps) {
  const { colors, typography, spacing, radius } = useTheme();
  return (
    <View
      testID="card"
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.line,
          borderRadius: radius.card,
          padding: spacing.lg,
        },
      ]}
    >
      {title !== undefined && (
        <Text
          accessibilityRole="header"
          style={[typography.title, styles.title, { color: colors.ink, marginBottom: spacing.sm }]}
        >
          {title}
        </Text>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  title: { fontVariant: [...tabularNums] },
});
