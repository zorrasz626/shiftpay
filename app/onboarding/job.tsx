import { useRouter } from 'expo-router';
import { Text } from 'react-native';

import { Button } from '../../src/components/Button';
import { Disclaimer } from '../../src/components/Disclaimer';
import { Screen } from '../../src/components/Screen';
import { TextField } from '../../src/components/TextField';
import {
  FIX_HINT,
  jobStepErrors,
  useOnboardingStore,
  useStepErrors,
} from '../../src/store/onboardingStore';
import { useTheme } from '../../src/theme/useTheme';

/** Onboarding step 1: job name and base hourly rate. */
export default function OnboardingJobScreen() {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const draft = useOnboardingStore();
  const { errors, valid, touch, showAll } = useStepErrors(jobStepErrors, draft);

  function onContinue() {
    if (!valid) {
      showAll();
      return;
    }
    router.push('/onboarding/pay');
  }

  return (
    <Screen
      title="Your job"
      scroll
      bottomInset
      footer={
        <Button
          label="Continue"
          accessibilityHint={valid ? undefined : FIX_HINT}
          onPress={onContinue}
        />
      }
    >
      <Text style={[typography.caption, { color: colors.inkMuted, marginBottom: spacing.lg }]}>
        Step 1 of 4
      </Text>
      <TextField
        label="Job name"
        value={draft.name}
        onChangeText={draft.setName}
        placeholder="For example, day job"
        error={errors.name}
        onBlur={() => touch('name')}
      />
      <TextField
        label="Base rate per hour (£)"
        value={draft.baseRateText}
        onChangeText={draft.setBaseRateText}
        keyboardType="decimal-pad"
        placeholder="12.21"
        error={errors.baseRate}
        onBlur={() => touch('baseRate')}
        helper="Your normal hourly rate before tax, without any premiums."
      />
      <Disclaimer />
    </Screen>
  );
}
