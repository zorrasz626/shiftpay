import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../../src/components/Button';
import { Chip } from '../../src/components/Chip';
import { Disclaimer } from '../../src/components/Disclaimer';
import { Screen } from '../../src/components/Screen';
import { TextField } from '../../src/components/TextField';
import { ROTA_PRESETS } from '../../src/engine/presets';
import { instantToLocal } from '../../src/engine/time';
import type { DayOfWeek } from '../../src/engine/types';
import {
  endsNextDay,
  formatLongDate,
  isRotaStepValid,
  rotaPreview,
  rotaStepErrors,
  useOnboardingStore,
} from '../../src/store/onboardingStore';
import { useTheme } from '../../src/theme/useTheme';

/** Monday first, as UK rotas are usually written. */
const WEEK: [DayOfWeek, string][] = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [0, 'Sun'],
];

/** Onboarding step 3: rota preset, shift times, unpaid break and the first day on. */
export default function OnboardingRotaScreen() {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const draft = useOnboardingStore();
  const today = instantToLocal(new Date().toISOString()).date;
  const errors = rotaStepErrors(draft);
  const valid = isRotaStepValid(draft);
  const custom = draft.rotaPreset === 'custom_weekly';
  const overnight = endsNextDay(draft.shiftStart, draft.shiftEnd);
  const firstDayWords = formatLongDate(draft.firstDayOn);
  const preview = rotaPreview(draft, today);
  const { firstDayOn, setFirstDayOn } = draft;

  useEffect(() => {
    if (firstDayOn === '') setFirstDayOn(today);
    // Pre-fill once on arrival; clearing the field later must not refill it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen
      title="Your rota"
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
              disabled={!valid}
              onPress={() => router.push('/onboarding/premiums')}
            />
          </View>
        </View>
      }
    >
      <Text style={[typography.caption, { color: colors.inkMuted, marginBottom: spacing.lg }]}>
        Step 3 of 4
      </Text>

      <Text style={[typography.body, { color: colors.ink, marginBottom: spacing.sm }]}>
        How does your rota repeat?
      </Text>
      <View style={[styles.wrap, { gap: spacing.md, marginBottom: spacing.xl }]}>
        {ROTA_PRESETS.map(({ id, label }) => (
          <Chip
            key={id}
            label={label}
            tone="neutral"
            selected={draft.rotaPreset === id}
            onPress={() => draft.setRotaPreset(id)}
          />
        ))}
      </View>

      {custom && (
        <View style={{ marginBottom: spacing.xl }}>
          <Text style={[typography.body, { color: colors.ink, marginBottom: spacing.sm }]}>
            Which days do you work?
          </Text>
          <View style={[styles.wrap, { gap: spacing.md }]}>
            {WEEK.map(([day, label]) => (
              <Chip
                key={day}
                label={label}
                tone="neutral"
                selected={draft.daysOfWeek.includes(day)}
                onPress={() => draft.toggleDayOfWeek(day)}
              />
            ))}
          </View>
          {errors.daysOfWeek !== undefined && (
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.caption, { color: colors.alert, marginTop: spacing.sm }]}
            >
              {errors.daysOfWeek}
            </Text>
          )}
        </View>
      )}

      <TextField
        label="Shift starts (HH:MM)"
        value={draft.shiftStart}
        onChangeText={draft.setShiftStart}
        keyboardType="numbers-and-punctuation"
        placeholder="09:00"
        error={errors.shiftStart}
        helper="24-hour clock, for example 07:00 or 19:00"
      />
      <TextField
        label="Shift ends (HH:MM)"
        value={draft.shiftEnd}
        onChangeText={draft.setShiftEnd}
        keyboardType="numbers-and-punctuation"
        placeholder="17:00"
        error={errors.shiftEnd}
        helper={overnight ? 'Ends next day' : undefined}
      />
      <TextField
        label="Unpaid break (minutes)"
        value={draft.unpaidBreakText}
        onChangeText={draft.setUnpaidBreakText}
        keyboardType="number-pad"
        placeholder="30"
        error={errors.unpaidBreak}
        helper="Use 0 if your breaks are paid"
      />
      <TextField
        label="First day on"
        value={draft.firstDayOn}
        onChangeText={draft.setFirstDayOn}
        keyboardType="numbers-and-punctuation"
        placeholder="YYYY-MM-DD"
        error={errors.firstDayOn}
        helper={firstDayWords ?? 'The first day of your rota, for example 2026-11-02'}
      />

      {preview !== null && (
        <View style={{ marginBottom: spacing.lg }}>
          <Text style={[typography.caption, { color: colors.inkMuted }]}>Next 14 days</Text>
          <Text style={[typography.body, { color: colors.ink }]}>{preview}</Text>
        </View>
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
