import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../../src/components/Button';
import { Chip } from '../../src/components/Chip';
import { Disclaimer } from '../../src/components/Disclaimer';
import { Screen } from '../../src/components/Screen';
import { TextField } from '../../src/components/TextField';
import { db } from '../../src/db/client';
import type { PayFrequency } from '../../src/engine/types';
import { instantToLocal } from '../../src/engine/time';
import {
  FIX_HINT,
  formatLongDate,
  payStepErrors,
  useOnboardingStore,
  useStepErrors,
} from '../../src/store/onboardingStore';
import { useTheme } from '../../src/theme/useTheme';

const FREQUENCIES: [PayFrequency, string][] = [
  ['weekly', 'Weekly'],
  ['fortnightly', 'Fortnightly'],
  ['four_weekly', 'Every 4 weeks'],
  ['monthly', 'Monthly'],
];

/** Onboarding step 2: pay frequency, next pay date and the period it pays for. */
export default function OnboardingPayScreen() {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const draft = useOnboardingStore();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { errors, valid, touch, showAll } = useStepErrors(payStepErrors, draft);
  const monthly = draft.payFrequency === 'monthly';
  const payDateWords = formatLongDate(draft.nextPayDate);
  const endDateWords = formatLongDate(draft.periodEndDate);

  async function onContinue() {
    if (!valid) {
      showAll();
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const today = instantToLocal(new Date().toISOString()).date;
      await draft.finishPayStep(db, today);
      router.push('/onboarding/rota');
    } catch {
      setSaveError("Your job couldn't be saved. Check the details and try again.");
      setSaving(false);
    }
  }

  return (
    <Screen
      title="When you get paid"
      scroll
      bottomInset
      footer={
        <View style={[styles.row, { gap: spacing.md }]}>
          <View style={styles.fill}>
            <Button label="Back" variant="secondary" onPress={() => router.back()} />
          </View>
          <View style={styles.fill}>
            <Button
              label="Continue"
              disabled={saving}
              accessibilityHint={valid ? undefined : FIX_HINT}
              onPress={onContinue}
            />
          </View>
        </View>
      }
    >
      <Text style={[typography.caption, { color: colors.inkMuted, marginBottom: spacing.lg }]}>
        Step 2 of 4
      </Text>

      <Text style={[typography.body, { color: colors.ink, marginBottom: spacing.sm }]}>
        How often are you paid?
      </Text>
      <View style={[styles.wrap, { gap: spacing.md, marginBottom: spacing.xl }]}>
        {FREQUENCIES.map(([value, label]) => (
          <Chip
            key={value}
            label={label}
            tone="neutral"
            selected={draft.payFrequency === value}
            onPress={() => draft.setPayFrequency(value)}
          />
        ))}
      </View>

      <TextField
        label="Next pay date"
        value={draft.nextPayDate}
        onChangeText={draft.setNextPayDate}
        keyboardType="numbers-and-punctuation"
        placeholder="YYYY-MM-DD"
        error={errors.nextPayDate}
        onBlur={() => touch('nextPayDate')}
        helper={payDateWords ?? 'For example, 2026-11-06'}
      />

      {monthly ? (
        <TextField
          label="Cut-off day of the month (1–31)"
          value={draft.periodCutoffDay}
          onChangeText={draft.setPeriodCutoffDay}
          keyboardType="number-pad"
          placeholder="31"
          error={errors.periodCutoffDay}
          onBlur={() => touch('periodCutoffDay')}
          helper="The last day of each month's pay period. Use 31 for the end of the month."
        />
      ) : (
        <TextField
          label="Last day of the period it pays for"
          value={draft.periodEndDate}
          onChangeText={draft.setPeriodEndDate}
          keyboardType="numbers-and-punctuation"
          placeholder="YYYY-MM-DD"
          error={errors.periodEndDate}
          onBlur={() => touch('periodEndDate')}
          helper={endDateWords ?? 'Often the same as the pay date, or a few days before it.'}
        />
      )}

      {saveError !== null && (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.body, { color: colors.alert, marginBottom: spacing.lg }]}
        >
          {saveError}
        </Text>
      )}
      <Disclaimer />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  fill: { flex: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
