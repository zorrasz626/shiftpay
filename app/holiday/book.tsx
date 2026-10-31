/**
 * Book holiday: the Calendar on the root stack, pushed from the Holiday
 * screen. Pushing the Calendar tab instead would switch to the tabs below
 * Holiday, so Back would land on Home; here Back returns to Holiday.
 */
import { useRouter } from 'expo-router';
import { Text } from 'react-native';

import { Button } from '../../src/components/Button';
import { useTheme } from '../../src/theme/useTheme';
import { CalendarView } from '../(tabs)/calendar';

export default function BookHolidayScreen() {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  return (
    <CalendarView
      title="Book holiday"
      intro={
        <Text style={[typography.body, { color: colors.inkMuted, marginBottom: spacing.md }]}>
          Tap a shift day, then set its status to Holiday.
        </Text>
      }
      footer={<Button label="Back" variant="secondary" onPress={() => router.back()} />}
    />
  );
}
