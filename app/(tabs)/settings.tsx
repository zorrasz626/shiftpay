import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Disclaimer } from '../../src/components/Disclaimer';
import { useTheme } from '../../src/theme/useTheme';

export default function SettingsScreen() {
  const { colors, typography, spacing } = useTheme();
  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.container, { backgroundColor: colors.board, padding: spacing.gutter }]}
    >
      <Text style={[typography.title, { color: colors.ink, marginBottom: spacing.sm }]}>Settings</Text>
      <Text style={[typography.body, { color: colors.inkMuted, marginBottom: spacing.xl }]}>
        Jobs, pay rates, reminders and holiday settings will appear here.
      </Text>
      <Disclaimer />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
