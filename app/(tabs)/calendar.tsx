import { Text } from 'react-native';

import { Screen } from '../../src/components/Screen';
import { useTheme } from '../../src/theme/useTheme';

export default function CalendarScreen() {
  const { colors, typography } = useTheme();
  return (
    <Screen title="Calendar">
      <Text style={[typography.body, { color: colors.inkMuted }]}>
        Your rota by month: shifts, nights and bank holidays will appear here.
      </Text>
    </Screen>
  );
}
