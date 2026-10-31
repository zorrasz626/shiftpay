/**
 * Pay rule editor: one premium or overtime rule. `id` is a rule id, or 'new'
 * with a `type` param. Edits are local until Save, which replaces the whole
 * rule; Back discards them. Delete asks for confirmation first.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../src/components/Button';
import { Chip } from '../../../src/components/Chip';
import { Disclaimer } from '../../../src/components/Disclaimer';
import { Screen } from '../../../src/components/Screen';
import { TextField } from '../../../src/components/TextField';
import { db } from '../../../src/db/client';
import {
  type RuleFormField,
  type RuleFormValues,
  formToRule,
  newRuleForm,
  ruleFormErrors,
  ruleToForm,
} from '../../../src/engine/ruleForm';
import type { DayOfWeek, PremiumRuleType } from '../../../src/engine/types';
import { useJobsStore } from '../../../src/store/jobsStore';
import { newId } from '../../../src/store/onboardingStore';
import { useRulesStore } from '../../../src/store/rulesStore';
import { useTheme } from '../../../src/theme/useTheme';
import { OVERTIME_TYPES, PREMIUM_TYPES, WEEK } from '../rules';

const THRESHOLD_LABELS: Partial<Record<PremiumRuleType, string>> = {
  overtime_daily: 'Overtime after (hours in a day)',
  overtime_weekly: 'Overtime after (hours in a week)',
  overtime_period: 'Overtime after (hours in a pay period)',
};

const ALL_TYPES = [...PREMIUM_TYPES, ...OVERTIME_TYPES];

function isRuleType(value: unknown): value is PremiumRuleType {
  return ALL_TYPES.some(([type]) => type === value);
}

function RuleForm({
  initial,
  ruleId,
  jobId,
  isNew,
}: {
  initial: RuleFormValues;
  ruleId: string;
  jobId: string;
  isNew: boolean;
}) {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const saveRule = useRulesStore((s) => s.saveRule);
  const removeRule = useRulesStore((s) => s.removeRule);

  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const errors = ruleFormErrors(values);
  const errorFor = (field: RuleFormField) => errors.find((e) => e.field === field)?.message;
  const valid = errors.length === 0;
  const set = (patch: Partial<RuleFormValues>) => setValues((v) => ({ ...v, ...patch }));
  const toggleDay = (day: DayOfWeek) =>
    setValues((v) => ({
      ...v,
      daysOfWeek: v.daysOfWeek.includes(day)
        ? v.daysOfWeek.filter((d) => d !== day)
        : [...v.daysOfWeek, day],
    }));

  async function run(action: () => Promise<void>, failure: string) {
    setBusy(true);
    setSaveError(null);
    try {
      await action();
      router.back();
    } catch {
      setSaveError(failure);
      setBusy(false);
    }
  }

  const onSave = () =>
    run(
      () => saveRule(db, formToRule(values, { id: ruleId, jobId })),
      "Your changes couldn't be saved. Try again.",
    );
  const onDelete = () =>
    run(() => removeRule(db, ruleId), "The rule couldn't be deleted. Try again.");

  const fieldTitle = (text: string) => (
    <Text style={[typography.body, { color: colors.ink, marginBottom: spacing.sm }]}>{text}</Text>
  );
  const fieldError = (field: RuleFormField) => {
    const message = errorFor(field);
    return message === undefined ? null : (
      <Text style={[typography.caption, { color: colors.alert, marginBottom: spacing.lg }]}>
        {message}
      </Text>
    );
  };
  const thresholdLabel = THRESHOLD_LABELS[values.type];
  const kind = OVERTIME_TYPES.some(([t]) => t === values.type) ? 'overtime rule' : 'premium';

  return (
    <Screen
      title={isNew ? `Add ${kind}` : `Edit ${kind}`}
      scroll
      bottomInset
      footer={
        <View style={[styles.row, { gap: spacing.md }]}>
          <View style={styles.fill}>
            <Button label="Back" variant="secondary" onPress={() => router.back()} />
          </View>
          <View style={styles.fill}>
            <Button label="Save" disabled={!valid || busy} onPress={onSave} />
          </View>
        </View>
      }
    >
      <TextField
        label="Rule name"
        value={values.name}
        onChangeText={(name) => set({ name })}
        error={errorFor('name')}
      />

      {values.type === 'time_band' && (
        <>
          <TextField
            label="Start time"
            value={values.startTime}
            onChangeText={(startTime) => set({ startTime })}
            keyboardType="numbers-and-punctuation"
            placeholder="22:00"
            error={errorFor('startTime')}
          />
          <TextField
            label="End time"
            value={values.endTime}
            onChangeText={(endTime) => set({ endTime })}
            keyboardType="numbers-and-punctuation"
            placeholder="06:00"
            error={errorFor('endTime')}
            helper={
              values.startTime === values.endTime
                ? 'Same start and end time: this rule applies all day.'
                : 'Bands that pass midnight are fine, e.g. 22:00 to 06:00.'
            }
          />
        </>
      )}

      {values.type === 'day_of_week' && (
        <>
          {fieldTitle('Which days?')}
          <View style={[styles.wrap, { gap: spacing.md, marginBottom: spacing.lg }]}>
            {WEEK.map(([day, label]) => (
              <Chip
                key={day}
                label={label}
                tone="neutral"
                selected={values.daysOfWeek.includes(day)}
                onPress={() => toggleDay(day)}
              />
            ))}
          </View>
          {fieldError('daysOfWeek')}
        </>
      )}

      {thresholdLabel !== undefined && (
        <TextField
          label={thresholdLabel}
          value={values.thresholdText}
          onChangeText={(thresholdText) => set({ thresholdText })}
          keyboardType="decimal-pad"
          error={errorFor('thresholdText')}
        />
      )}

      {values.type === 'overtime_weekly' && (
        <>
          {fieldTitle('Week starts on')}
          <View style={[styles.wrap, { gap: spacing.md, marginBottom: spacing.xl }]}>
            {WEEK.map(([day, label]) => (
              <Chip
                key={day}
                label={label}
                tone="neutral"
                selected={values.weekStartsOn === day}
                onPress={() => set({ weekStartsOn: day })}
              />
            ))}
          </View>
        </>
      )}

      {fieldTitle('How is it paid?')}
      <View style={[styles.wrap, { gap: spacing.md, marginBottom: spacing.lg }]}>
        <Chip
          label="Times base rate"
          tone="neutral"
          selected={values.rateKind === 'multiplier'}
          onPress={() => set({ rateKind: 'multiplier' })}
        />
        <Chip
          label="Extra £ per hour"
          tone="neutral"
          selected={values.rateKind === 'flat'}
          onPress={() => set({ rateKind: 'flat' })}
        />
      </View>
      {values.rateKind === 'multiplier' ? (
        <TextField
          label="Multiplier (× base rate)"
          value={values.multiplierText}
          onChangeText={(multiplierText) => set({ multiplierText })}
          keyboardType="decimal-pad"
          placeholder="1.5"
          error={errorFor('multiplierText')}
          helper="e.g. 1.5 pays one and a half times your base rate"
        />
      ) : (
        <TextField
          label="Extra (£ an hour)"
          value={values.flatText}
          onChangeText={(flatText) => set({ flatText })}
          keyboardType="decimal-pad"
          placeholder="1.50"
          error={errorFor('flatText')}
          helper="Added to your base rate for each hour"
        />
      )}

      {!isNew &&
        (confirmDelete ? (
          <View style={{ gap: spacing.sm, marginBottom: spacing.xl }}>
            <Text style={[typography.body, { color: colors.ink }]}>Delete this rule?</Text>
            <View style={[styles.row, { gap: spacing.md }]}>
              <View style={styles.fill}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  onPress={() => setConfirmDelete(false)}
                />
              </View>
              <View style={styles.fill}>
                <Button label="Delete" disabled={busy} onPress={onDelete} />
              </View>
            </View>
          </View>
        ) : (
          <View style={{ marginBottom: spacing.xl }}>
            <Button label="Delete rule" variant="quiet" onPress={() => setConfirmDelete(true)} />
          </View>
        ))}

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

export default function RuleEditorScreen() {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const { id, type } = useLocalSearchParams<{ id: string; type?: string }>();
  const job = useJobsStore((s) => s.jobs[0]);
  const rule = useRulesStore((s) => s.rules.find((r) => r.id === id));
  const [newRuleId] = useState(() => newId('rule'));

  if (job !== undefined && id === 'new' && isRuleType(type)) {
    return <RuleForm initial={newRuleForm(type)} ruleId={newRuleId} jobId={job.id} isNew />;
  }
  if (rule !== undefined) {
    return (
      <RuleForm
        key={rule.id}
        initial={ruleToForm(rule)}
        ruleId={rule.id}
        jobId={rule.jobId}
        isNew={false}
      />
    );
  }
  return (
    <Screen
      title="Rule not found"
      bottomInset
      footer={<Button label="Back" variant="secondary" onPress={() => router.back()} />}
    >
      <Text style={[typography.body, { color: colors.ink, marginBottom: spacing.lg }]}>
        This rule may have been deleted.
      </Text>
      <Disclaimer />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  fill: { flex: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
