/**
 * Holiday settings: fixed hours or 12.07% accrual, the yearly entitlement
 * (fixed only) and the first day of the holiday year. Edits are local until
 * Save, which replaces the whole job; Back discards them.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../../src/components/Button';
import { Chip } from '../../src/components/Chip';
import { Disclaimer } from '../../src/components/Disclaimer';
import { Screen } from '../../src/components/Screen';
import { TextField } from '../../src/components/TextField';
import { db } from '../../src/db/client';
import type { StoredJob } from '../../src/db/jobRepo';
import {
  type HolidayFormField,
  formToHolidaySettings,
  holidayFormErrors,
  jobToHolidayForm,
} from '../../src/engine/holidayForm';
import type { HolidayMode } from '../../src/engine/types';
import { useJobsStore } from '../../src/store/jobsStore';
import { useTheme } from '../../src/theme/useTheme';

const MODES: [HolidayMode, string][] = [
  ['fixed', 'Fixed hours'],
  ['accrual', 'Accrual (12.07%)'],
];

function HolidayForm({ job }: { job: StoredJob }) {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const saveJob = useJobsStore((s) => s.saveJob);

  const [values, setValues] = useState(() => jobToHolidayForm(job));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const errors = holidayFormErrors(values);
  const errorFor = (field: HolidayFormField) => errors.find((e) => e.field === field)?.message;
  const valid = errors.length === 0;

  async function onSave() {
    if (!valid) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveJob(db, { ...job, ...formToHolidaySettings(values, job) });
      router.back();
    } catch {
      setSaveError("Your changes couldn't be saved. Try again.");
      setSaving(false);
    }
  }

  return (
    <Screen
      title="Holiday settings"
      scroll
      bottomInset
      footer={
        <View style={[styles.row, { gap: spacing.md }]}>
          <View style={styles.fill}>
            <Button label="Back" variant="secondary" onPress={() => router.back()} />
          </View>
          <View style={styles.fill}>
            <Button label="Save" disabled={!valid || saving} onPress={onSave} />
          </View>
        </View>
      }
    >
      <Text style={[typography.body, { color: colors.ink, marginBottom: spacing.sm }]}>
        How do you get paid holiday?
      </Text>
      <View style={[styles.wrap, { gap: spacing.md, marginBottom: spacing.sm }]}>
        {MODES.map(([value, label]) => (
          <Chip
            key={value}
            label={label}
            tone="neutral"
            selected={values.mode === value}
            onPress={() => setValues((v) => ({ ...v, mode: value }))}
          />
        ))}
      </View>
      <Text style={[typography.caption, { color: colors.inkMuted, marginBottom: spacing.xl }]}>
        Accrual is for irregular-hours and part-year workers: you build up 12.07% of the hours you
        work.
      </Text>

      {values.mode === 'fixed' && (
        <TextField
          label="Holiday entitlement (hours)"
          value={values.entitlementText}
          onChangeText={(t) => setValues((v) => ({ ...v, entitlementText: t }))}
          keyboardType="decimal-pad"
          placeholder="210"
          error={errorFor('entitlementText')}
          helper="Hours of paid holiday a year"
        />
      )}
      <TextField
        label="Holiday year start"
        value={values.yearStartText}
        onChangeText={(t) => setValues((v) => ({ ...v, yearStartText: t }))}
        placeholder="2026-04-01"
        error={errorFor('yearStartText')}
        helper="First day of your holiday year"
      />

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

export default function HolidaySettingsScreen() {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const job = useJobsStore((s) => s.jobs[0]);

  if (job === undefined) {
    return (
      <Screen
        title="Holiday settings"
        bottomInset
        footer={<Button label="Back" variant="secondary" onPress={() => router.back()} />}
      >
        <Text style={[typography.body, { color: colors.ink, marginBottom: spacing.lg }]}>
          No job set up yet.
        </Text>
        <Disclaimer />
      </Screen>
    );
  }
  return <HolidayForm key={job.id} job={job} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  fill: { flex: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
