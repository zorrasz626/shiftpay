import { Pressable, StyleSheet, Text } from 'react-native';

import { tabularNums, type Colors } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet';

export type ButtonProps = {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: ButtonVariant;
  readonly disabled?: boolean;
};

type VariantColors = {
  readonly background?: string;
  readonly border?: string;
  readonly text: string;
};

function variantColors(colors: Colors, variant: ButtonVariant, disabled: boolean): VariantColors {
  switch (variant) {
    case 'primary':
      return disabled
        ? { background: colors.line, text: colors.inkMuted }
        : { background: colors.signal, text: colors.onSignal };
    case 'secondary':
      return { border: colors.line, text: disabled ? colors.inkMuted : colors.ink };
    case 'quiet':
      return { text: disabled ? colors.inkMuted : colors.ink };
  }
}

/** Button with primary (signal fill), secondary (line border) and quiet (text only) variants. */
export function Button({ label, onPress, variant = 'primary', disabled = false }: ButtonProps) {
  const { colors, typography, spacing, radius } = useTheme();
  const v = variantColors(colors, variant, disabled);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          borderRadius: radius.button,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
        },
        v.background !== undefined && { backgroundColor: v.background },
        v.border !== undefined && { borderWidth: 1, borderColor: v.border },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[typography.bodyMedium, styles.label, { color: v.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  label: { fontVariant: [...tabularNums] },
  pressed: { opacity: 0.8 },
});
