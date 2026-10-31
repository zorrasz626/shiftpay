import { StyleSheet, Text, View } from 'react-native';

import { formatPence } from '../engine/money';
import { tabularNums } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

export type BigNumberProps = {
  /** Integer pence. */
  readonly pence: number;
  readonly caption?: string;
};

/** Money figure: pounds at money size, ".pp" at title size, baseline-aligned. */
export function BigNumber({ pence, caption }: BigNumberProps) {
  const { colors, typography, spacing } = useTheme();
  const formatted = formatPence(pence);
  const dot = formatted.lastIndexOf('.');
  const pounds = formatted.slice(0, dot);
  const fraction = formatted.slice(dot);

  return (
    <View>
      <View style={styles.row} accessible accessibilityLabel={formatted}>
        <Text style={[typography.money, styles.figure, { color: colors.ink }]}>{pounds}</Text>
        <Text style={[typography.title, styles.figure, { color: colors.ink }]}>{fraction}</Text>
      </View>
      {caption !== undefined && (
        <Text
          style={[
            typography.caption,
            styles.figure,
            { color: colors.inkMuted, marginTop: spacing.xs },
          ]}
        >
          {caption}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline' },
  figure: { fontVariant: [...tabularNums] },
});
