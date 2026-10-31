import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '../../src/theme/useTheme';

export default function CalendarScreen() {
  const { colors, typography, spacing } = useTheme();
  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.container, { backgroundColor: colors.board, padding: spacing.gutter }]}
    >
      <Text style={[typography.title, { color: colors.ink, marginBottom: spacing.sm }]}>Calendar</Text>
      <Text style={[typography.body, { color: colors.inkMuted }]}>
        Your rota by month: shifts, nights and bank holidays will appear here.
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
