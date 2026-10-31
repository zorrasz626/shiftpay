import { Text } from 'react-native';

import { Screen } from '../../src/components/Screen';
import { useTheme } from '../../src/theme/useTheme';

export default function PayScreen() {
  const { colors, typography } = useTheme();
  return (
    <Screen title="Pay">
      <Text style={[typography.body, { color: colors.inkMuted }]}>
        Expected pay for each period and payslip checks will appear here.
      </Text>
    </Screen>
  );
}
