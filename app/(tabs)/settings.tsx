import { Text } from 'react-native';

import { Disclaimer } from '../../src/components/Disclaimer';
import { Screen } from '../../src/components/Screen';
import { useTheme } from '../../src/theme/useTheme';

export default function SettingsScreen() {
  const { colors, typography, spacing } = useTheme();
  return (
    <Screen title="Settings">
      <Text style={[typography.body, { color: colors.inkMuted, marginBottom: spacing.xl }]}>
        Jobs, pay rates, reminders and holiday settings will appear here.
      </Text>
      <Disclaimer />
    </Screen>
  );
}
