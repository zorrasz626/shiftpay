import { StyleSheet, Text } from 'react-native';

import { tabularNums } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

export const DISCLAIMER =
  'Estimates only — not financial or tax advice. Always check with your employer/payroll.';

/** The standard estimates-only disclaimer: caption size, inkMuted, left-aligned. */
export function Disclaimer() {
  const { colors, typography } = useTheme();
  return (
    <Text style={[typography.caption, styles.text, { color: colors.inkMuted }]}>{DISCLAIMER}</Text>
  );
}

const styles = StyleSheet.create({
  text: { textAlign: 'left', fontVariant: [...tabularNums] },
});
