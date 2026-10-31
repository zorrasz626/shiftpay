import { StyleSheet, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { tabularNums } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

export type TextFieldProps = {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly keyboardType?: KeyboardTypeOptions;
  readonly placeholder?: string;
  /** Shown below the input in the alert colour; also turns the border alert. */
  readonly error?: string;
  /** Hint shown below the input in inkMuted caption (hidden while there is an error). */
  readonly helper?: string;
  readonly accessibilityHint?: string;
};

/** Labelled text input on a surface with a 1px line border; min height 48. */
export function TextField({
  label,
  value,
  onChangeText,
  keyboardType,
  placeholder,
  error,
  helper,
  accessibilityHint,
}: TextFieldProps) {
  const { colors, typography, spacing, radius } = useTheme();
  const hasError = error !== undefined && error !== '';

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={[typography.body, { color: colors.ink, marginBottom: spacing.xs }]}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={colors.inkMuted}
        cursorColor={colors.ink}
        selectionColor={colors.line}
        style={[
          typography.body,
          styles.input,
          {
            color: colors.ink,
            backgroundColor: colors.surface,
            borderColor: hasError ? colors.alert : colors.line,
            borderRadius: radius.button,
            paddingHorizontal: spacing.md,
          },
        ]}
      />
      {hasError ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.caption, { color: colors.alert, marginTop: spacing.xs }]}
        >
          {error}
        </Text>
      ) : (
        helper !== undefined && (
          <Text style={[typography.caption, { color: colors.inkMuted, marginTop: spacing.xs }]}>
            {helper}
          </Text>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 48, borderWidth: 1, fontVariant: [...tabularNums] },
});
