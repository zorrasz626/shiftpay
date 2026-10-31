import { Pressable, StyleSheet, Text, View } from 'react-native';

import { tabularNums, type Colors } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

export type ChipTone = 'neutral' | 'night' | 'positive' | 'alert';

export type ChipProps = {
  readonly label: string;
  readonly tone: ChipTone;
  readonly selected?: boolean;
  readonly onPress?: () => void;
};

function toneColor(colors: Colors, tone: ChipTone): string {
  switch (tone) {
    case 'neutral':
      return colors.inkMuted;
    case 'night':
      return colors.night;
    case 'positive':
      return colors.positive;
    case 'alert':
      return colors.alert;
  }
}

/** Pill with outline + label in the tone colour; selected fills with the tone. */
export function Chip({ label, tone, selected = false, onPress }: ChipProps) {
  const { colors, typography, spacing, radius } = useTheme();
  const toneValue = toneColor(colors, tone);

  const chipStyle = [
    styles.chip,
    {
      borderColor: toneValue,
      borderRadius: radius.chip,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    selected && { backgroundColor: toneValue },
  ];
  const text = (
    <Text
      style={[typography.caption, styles.label, { color: selected ? colors.surface : toneValue }]}
    >
      {label}
    </Text>
  );

  if (onPress === undefined) {
    return (
      <View testID="chip" accessibilityState={{ selected }} style={chipStyle}>
        {text}
      </View>
    );
  }
  return (
    <Pressable
      testID="chip"
      accessibilityRole="button"
      accessibilityState={{ selected }}
      hitSlop={spacing.sm}
      onPress={onPress}
      style={chipStyle}
    >
      {text}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { borderWidth: 1, alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
  label: { fontVariant: [...tabularNums] },
});
