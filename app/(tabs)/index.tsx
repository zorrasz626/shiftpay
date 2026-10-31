import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Disclaimer } from '../../src/components/Disclaimer';
import { useTheme } from '../../src/theme/useTheme';

export default function HomeScreen() {
  const { colors, typography, spacing } = useTheme();
  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.container, { backgroundColor: colors.board, padding: spacing.gutter }]}
    >
      <Text style={[typography.title, { color: colors.ink, marginBottom: spacing.md }]}>
        ShiftPay
      </Text>
      <Disclaimer />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
