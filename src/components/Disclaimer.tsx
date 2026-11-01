import { StyleSheet, Text } from 'react-native';

import { DISCLAIMER } from '../config/disclaimer';
import { tabularNums } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

export { DISCLAIMER };

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
