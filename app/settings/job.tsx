/**
 * Job settings: name, base rate, bank holiday region (D5), monthly cut-off day
 * (D6, monthly pay only) and overtime on a premium hour (D1). Edits are local
 * until Save, which replaces the whole job; Back discards them.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../../src/components/Button';
import { Chip } from '../../src/components/Chip';
import { Disclaimer } from '../../src/components/Disclaimer';
import { Screen } from '../../src/components/Screen';
import { TextField } from '../../src/components/TextField';
import { BANK_HOLIDAY_REGION_OPTIONS } from '../../src/config/bankHolidayRegions';
import { db } from '../../src/db/client';
import type { StoredJob } from '../../src/db/jobRepo';
import { validatePaySchedule } from '../../src/engine/paySchedule';
import type { OvertimePremiumMode } from '../../src/engine/types';
import { useJobsStore } from '../../src/store/jobsStore';
import {
  type FieldErrors,
  MESSAGES,
  parseRateToPence,
  penceToRateText,
} from '../../src/store/onboardingStore';
import { useTheme } from '../../src/theme/useTheme';

/** D1 choices, each with a one-line explanation (same wording as onboarding). */
const OVERTIME_MODES: [OvertimePremiumMode, string, string][] = [
  ['highest', 'Use the higher rate', 'Overtime on a premium hour pays whichever rate is higher.'],
  ['replace', 'Overtime rate only', 'Overtime on a premium hour pays the overtime rate only.'],
  [
    'stack',
    'Add them together',
    'Both extras are added, e.g. 1.5 + 0.25 = 1.75 times your base rate.',
  ],
];

const CUTOFF_RE = /^\d{1,2}$/;

type JobField = 'name' | 'baseRate' | 'periodCutoffDay';

/** The cut-off day as typed, or null unless a whole day from 1 to 31. */
function parseCutoffDay(text: string, job: StoredJob): number | null {
  const trimmed = text.trim();
  if (!CUTOFF_RE.test(trimmed)) return null;
  const day = Number(trimmed);
  // For monthly pay only the cut-off day is checked; the dates just need to be valid.
  const errors = validatePaySchedule({
    payFrequency: 'monthly',
    nextPayDate: job.payPeriodAnchorDate,
    periodEndDate: job.payPeriodAnchorDate,
    periodCutoffDay: day,
  });
  return errors.length === 0 ? day : null;
}

function JobForm({ job }: { job: StoredJob }) {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const saveJob = useJobsStore((s) => s.saveJob);
  const monthly = job.payFrequency === 'monthly';

  const [name, setName] = useState(job.name);
  const [rateText, setRateText] = useState(penceToRateText(job.baseRatePence));
  const [region, setRegion] = useState(job.bankHolidayRegion);
  const [cutoffText, setCutoffText] = useState(String(job.periodCutoffDay));
  const [mode, setMode] = useState(job.overtimePremiumMode);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const ratePence = parseRateToPence(rateText);
  const cutoffDay = monthly ? parseCutoffDay(cutoffText, job) : job.periodCutoffDay;
  const errors: FieldErrors<JobField> = {};
  if (name.trim() === '') errors.name = MESSAGES.nameRequired;
  if (ratePence === null) errors.baseRate = MESSAGES.rate;
  if (cutoffDay === null) errors.periodCutoffDay = MESSAGES.cutoff;
  const valid = Object.keys(errors).length === 0;

  async function onSave() {
    if (ratePence === null || cutoffDay === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveJob(db, {
        ...job,
        name: name.trim(),
        baseRatePence: ratePence,
        bankHolidayRegion: region,
        periodCutoffDay: cutoffDay,
        overtimePremiumMode: mode,
      });
      router.back();
    } catch {
      setSaveError("Your changes couldn't be saved. Try again.");
      setSaving(false);
    }
  }

  return (
    <Screen
      title="Job settings"
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
      <TextField label="Job name" value={name} onChangeText={setName} error={errors.name} />
      <TextField
        label="Base rate (£ an hour)"
        value={rateText}
        onChangeText={setRateText}
        keyboardType="decimal-pad"
        placeholder="12.21"
        error={errors.baseRate}
        helper="Your normal hourly rate before any extras"
      />

      {monthly && (
        <TextField
          label="Cut-off day of the month (1–31)"
          value={cutoffText}
          onChangeText={setCutoffText}
          keyboardType="number-pad"
          placeholder="31"
          error={errors.periodCutoffDay}
          helper="The last day of each month's pay period. Use 31 for the end of the month."
        />
      )}

      <Text style={[typography.body, { color: colors.ink, marginBottom: spacing.sm }]}>
        Which bank holidays apply to you?
      </Text>
      <View style={[styles.wrap, { gap: spacing.md, marginBottom: spacing.xl }]}>
        {BANK_HOLIDAY_REGION_OPTIONS.map(([value, label]) => (
          <Chip
            key={value}
            label={label}
            tone="neutral"
            selected={region === value}
            onPress={() => setRegion(value)}
          />
        ))}
      </View>

      <Text style={[typography.body, { color: colors.ink, marginBottom: spacing.sm }]}>
        Overtime on a premium hour
      </Text>
      <View style={{ gap: spacing.md, marginBottom: spacing.xl }}>
        {OVERTIME_MODES.map(([value, label, explanation]) => (
          <View key={value} style={[styles.row, styles.center, { gap: spacing.md }]}>
            <Chip
              label={label}
              tone="neutral"
              selected={mode === value}
              onPress={() => setMode(value)}
            />
            <Text style={[typography.caption, styles.fill, { color: colors.inkMuted }]}>
              {explanation}
            </Text>
          </View>
        ))}
      </View>

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

export default function JobSettingsScreen() {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const job = useJobsStore((s) => s.jobs[0]);

  if (job === undefined) {
    return (
      <Screen
        title="Job settings"
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
  return <JobForm key={job.id} job={job} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  center: { alignItems: 'center' },
  fill: { flex: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
