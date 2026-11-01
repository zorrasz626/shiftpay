import { StyleSheet, Text, View } from 'react-native';

import { tabularNums } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

export type Bar = {
  readonly key: string;
  /** Short label beside the bar, e.g. "Mar 2026". */
  readonly label: string;
  /** Bar length relative to the largest value (≥ 0). */
  readonly value: number;
  /** Shown after the bar, e.g. "£1,234.56". */
  readonly valueLabel: string;
  /** Read by screen readers, e.g. "March 2026, £1,234.56". */
  readonly accessibilityLabel: string;
};

export type BarChartProps = {
  readonly bars: readonly Bar[];
  readonly testID?: string;
};

const BAR_HEIGHT = 12;
const LABEL_WIDTH = 72;
const BAR_OUTLINE = 1;

/**
 * Horizontal bar chart from plain Views (no native chart dependency): one
 * row per bar with its label, a bar scaled to the largest value, and the
 * value as text, so it stays readable for 1–12 bars in light and dark mode.
 */
export function BarChart({ bars, testID }: BarChartProps) {
  const { colors, typography, spacing, radius } = useTheme();
  const max = bars.reduce((m, b) => Math.max(m, b.value), 0);
  const text = [typography.caption, styles.nums, { color: colors.ink }];

  return (
    <View testID={testID} style={{ gap: spacing.sm }}>
      {bars.map((bar) => {
        const ratio = max > 0 ? Math.max(0, bar.value) / max : 0;
        return (
          <View
            key={bar.key}
            testID="bar"
            accessible
            accessibilityLabel={bar.accessibilityLabel}
            style={[styles.row, { gap: spacing.sm }]}
          >
            <Text style={[text, styles.label, { color: colors.inkMuted }]}>{bar.label}</Text>
            <View
              style={[styles.track, { backgroundColor: colors.line, borderRadius: radius.chip }]}
            >
              <View
                testID="bar-fill"
                style={[
                  styles.fill,
                  {
                    width: `${ratio * 100}%`,
                    backgroundColor: colors.signal,
                    borderRadius: radius.chip,
                  },
                  // The light signal yellow is below 3:1 on the track, so an ink outline
                  // gives the bar its 3:1 boundary (WCAG 1.4.11). An empty bar stays empty.
                  ratio > 0 && { borderWidth: BAR_OUTLINE, borderColor: colors.ink },
                ]}
              />
            </View>
            <Text testID="bar-value" style={[text, styles.value]}>
              {bar.valueLabel}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  nums: { fontVariant: [...tabularNums] },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 24 },
  label: { width: LABEL_WIDTH },
  track: { flex: 1, height: BAR_HEIGHT, overflow: 'hidden' },
  fill: { height: BAR_HEIGHT },
  value: { minWidth: 80, textAlign: 'right' },
});
