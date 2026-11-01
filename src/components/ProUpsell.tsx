import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../theme/useTheme';
import { Button } from './Button';

export type ProUpsellProps = {
  /** What Pro adds, e.g. "More pay rules". */
  readonly text: string;
  /** Optional line above, e.g. "Free includes 2 pay rules." */
  readonly detail?: string;
};

/** A small row: "<text> — available with ShiftPay Pro" and a "See Pro" button to the paywall. */
export function ProUpsell({ text, detail }: ProUpsellProps) {
  const router = useRouter();
  const { colors, typography, spacing, radius } = useTheme();
  const message = `${text} — available with ShiftPay Pro`;
  return (
    <View
      testID="pro-upsell"
      style={[
        styles.box,
        {
          borderColor: colors.line,
          borderRadius: radius.card,
          padding: spacing.md,
          gap: spacing.sm,
        },
      ]}
    >
      {detail !== undefined && (
        <Text style={[typography.caption, { color: colors.inkMuted }]}>{detail}</Text>
      )}
      <Text style={[typography.body, { color: colors.ink }]}>{message}</Text>
      <Button
        label="See Pro"
        variant="secondary"
        accessibilityLabel={`See ShiftPay Pro: ${text}`}
        onPress={() => router.push('/paywall')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1 },
});
