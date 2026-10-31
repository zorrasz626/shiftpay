/**
 * Rota: the job's shift types and its one rota pattern (free tier = one job,
 * one pattern). Tap a shift type to edit it. The pattern is edited locally
 * (first day, cycle length, what each cycle day is) and saved in one go;
 * saving re-materialises shifts from today on, leaving past and edited
 * shifts alone. No pattern yet: Save creates one.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Chip } from '../../src/components/Chip';
import { Disclaimer } from '../../src/components/Disclaimer';
import { Screen } from '../../src/components/Screen';
import { TextField } from '../../src/components/TextField';
import { db } from '../../src/db/client';
import type { StoredShiftTemplate } from '../../src/db/rotaRepo';
import {
  CYCLE_DAYS_MAX,
  CYCLE_DAYS_MIN,
  OFF_LABEL,
  type PatternFormField,
  type PatternFormValues,
  cycleDayDate,
  formToPattern,
  isValidLocalDateText,
  nextOccurrences,
  patternFormErrors,
  patternToForm,
  resizeCycle,
} from '../../src/engine/rotaForm';
import { instantToLocal } from '../../src/engine/time';
import type { LocalDate, RotaDay, RotaPattern } from '../../src/engine/types';
import { formatDayDate } from '../../src/features/home/homeView';
import { useJobsStore } from '../../src/store/jobsStore';
import { formatLongDate, newId } from '../../src/store/onboardingStore';
import { useRotaStore } from '../../src/store/rotaStore';
import { tabularNums } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/useTheme';

const PREVIEW_DAYS = 14;
const NEW_CYCLE_DAYS = 7;

/** "07:00–19:00 · 30 min break". */
function templateSummary(t: StoredShiftTemplate): string {
  const breakText = t.unpaidBreakMinutes === 0 ? 'no break' : `${t.unpaidBreakMinutes} min break`;
  return `${t.startTime}–${t.endTime} · ${breakText}`;
}

function TemplateRow({ template, onPress }: { template: StoredShiftTemplate; onPress: () => void }) {
  const { colors, typography, spacing } = useTheme();
  const summary = templateSummary(template);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${template.name}, ${summary}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row48,
        { paddingVertical: spacing.sm },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[typography.body, styles.nums, { color: colors.ink }]}>{template.name}</Text>
      <Text style={[typography.caption, styles.nums, { color: colors.inkMuted }]}>{summary}</Text>
    </Pressable>
  );
}

/** Square 48dp step button for the cycle length. */
function StepButton({
  symbol,
  label,
  disabled,
  onPress,
}: {
  symbol: string;
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors, typography, radius } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.step,
        { borderColor: colors.line, borderRadius: radius.button },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[typography.bodyMedium, { color: disabled ? colors.inkMuted : colors.ink }]}>
        {symbol}
      </Text>
    </Pressable>
  );
}

function RotaForm({
  initial,
  patternId,
  jobId,
  templates,
  today,
}: {
  initial: PatternFormValues;
  patternId: string;
  jobId: string;
  templates: StoredShiftTemplate[];
  today: LocalDate;
}) {
  const { colors, typography, spacing } = useTheme();
  const savePattern = useRotaStore((s) => s.savePattern);
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; failed: boolean } | null>(null);

  const templateIds = templates.map((t) => t.id);
  const errors = patternFormErrors(values, templateIds);
  const errorFor = (field: PatternFormField) => errors.find((e) => e.field === field)?.message;
  const valid = errors.length === 0;
  const startValid = isValidLocalDateText(values.startDate);
  const n = values.days.length;
  const preview: RotaPattern | null = valid ? formToPattern(values, { id: patternId, jobId }) : null;

  const edit = (patch: Partial<PatternFormValues>) => {
    setStatus(null);
    setValues((v) => ({ ...v, ...patch }));
  };
  const setDay = (i: number, day: RotaDay) =>
    edit({ days: values.days.map((d, j) => (j === i ? day : d)) });
  const resize = (next: number) => edit({ days: resizeCycle(values.days, next) });

  async function onSave() {
    // Template ids are checked here: formToPattern can't, and the store
    // writes the pattern before materialising.
    if (patternFormErrors(values, templateIds).length > 0) return;
    setBusy(true);
    setStatus(null);
    try {
      await savePattern(db, formToPattern(values, { id: patternId, jobId }), today);
      setStatus({ text: 'Rota saved.', failed: false });
    } catch {
      setStatus({ text: "Your rota couldn't be saved. Try again.", failed: true });
    }
    setBusy(false);
  }

  const daysError = errorFor('days');

  return (
    <>
      <Card title="Rota">
        <TextField
          label="First day of the cycle"
          value={values.startDate}
          onChangeText={(startDate) => edit({ startDate })}
          keyboardType="numbers-and-punctuation"
          placeholder="YYYY-MM-DD"
          error={errorFor('startDate')}
          helper={formatLongDate(values.startDate) ?? 'For example 2026-11-02'}
        />

        <Text style={[typography.body, { color: colors.ink, marginBottom: spacing.sm }]}>
          Cycle length
        </Text>
        <View style={[styles.line, { gap: spacing.md, marginBottom: spacing.lg }]}>
          <StepButton
            symbol="−"
            label="Shorter cycle"
            disabled={n <= CYCLE_DAYS_MIN}
            onPress={() => resize(n - 1)}
          />
          <Text style={[typography.body, styles.nums, { color: colors.ink }]}>
            {n === 1 ? '1 day' : `${n} days`}
          </Text>
          <StepButton
            symbol="+"
            label="Longer cycle"
            disabled={n >= CYCLE_DAYS_MAX}
            onPress={() => resize(n + 1)}
          />
        </View>

        {values.days.map((day, i) => {
          const title = startValid
            ? `Day ${i + 1} · ${formatDayDate(cycleDayDate(values.startDate, i))}`
            : `Day ${i + 1}`;
          return (
            <View key={i} testID={`rota-day-${i}`} style={{ marginBottom: spacing.md }}>
              <Text
                style={[typography.body, styles.nums, { color: colors.ink, marginBottom: spacing.sm }]}
              >
                {title}
              </Text>
              <View style={[styles.wrap, { gap: spacing.md }]}>
                {templates.map((t) => (
                  <Chip
                    key={t.id}
                    label={t.name}
                    tone="neutral"
                    selected={day !== 'OFF' && day.shiftTemplateId === t.id}
                    onPress={() => setDay(i, { shiftTemplateId: t.id })}
                  />
                ))}
                <Chip
                  label={OFF_LABEL}
                  tone="neutral"
                  selected={day === 'OFF'}
                  onPress={() => setDay(i, 'OFF')}
                />
              </View>
            </View>
          );
        })}
        {daysError !== undefined && (
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.caption, { color: colors.alert, marginBottom: spacing.md }]}
          >
            {daysError}
          </Text>
        )}
      </Card>
      <View style={{ height: spacing.lg }} />

      {preview !== null && (
        <>
          <Card title="Next 14 days">
            {nextOccurrences(preview, templates, today, PREVIEW_DAYS).map(({ date, label }) => (
              <View key={date} style={[styles.line, styles.between, { paddingVertical: spacing.xs }]}>
                <Text style={[typography.body, styles.nums, { color: colors.ink }]}>
                  {formatDayDate(date)}
                </Text>
                <Text
                  style={[
                    typography.body,
                    styles.nums,
                    { color: label === OFF_LABEL ? colors.inkMuted : colors.ink },
                  ]}
                >
                  {label}
                </Text>
              </View>
            ))}
          </Card>
          <View style={{ height: spacing.lg }} />
        </>
      )}

      <Text style={[typography.caption, { color: colors.inkMuted, marginBottom: spacing.md }]}>
        Saving changes shifts from today on. Past shifts and ones you&apos;ve edited stay as they
        are.
      </Text>
      <View style={{ marginBottom: spacing.lg }}>
        <Button label="Save rota" disabled={!valid || busy} onPress={onSave} />
      </View>
      {status !== null && (
        <Text
          accessibilityLiveRegion="polite"
          style={[
            typography.body,
            { color: status.failed ? colors.alert : colors.ink, marginBottom: spacing.lg },
          ]}
        >
          {status.text}
        </Text>
      )}
    </>
  );
}

export default function RotaScreen() {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const job = useJobsStore((s) => s.jobs[0]);
  const allTemplates = useRotaStore((s) => s.templates);
  const allPatterns = useRotaStore((s) => s.patterns);
  const [newPatternId] = useState(() => newId('pat'));
  const today = instantToLocal(new Date().toISOString()).date;
  const back = <Button label="Back" variant="secondary" onPress={() => router.back()} />;

  if (job === undefined) {
    return (
      <Screen title="Rota" bottomInset footer={back}>
        <Text style={[typography.body, { color: colors.ink, marginBottom: spacing.lg }]}>
          No job set up yet.
        </Text>
        <Disclaimer />
      </Screen>
    );
  }

  const templates = allTemplates.filter((t) => t.jobId === job.id);
  const pattern = allPatterns.find((p) => p.jobId === job.id);
  const openTemplate = (id: string) =>
    router.push({ pathname: '/settings/template/[id]', params: { id } });

  return (
    <Screen title="Rota" scroll bottomInset footer={back}>
      <Card title="Shift types">
        {templates.length === 0 && (
          <Text style={[typography.body, { color: colors.inkMuted, marginBottom: spacing.sm }]}>
            No shift types yet.
          </Text>
        )}
        {templates.map((t) => (
          <TemplateRow key={t.id} template={t} onPress={() => openTemplate(t.id)} />
        ))}
        <View style={{ height: spacing.sm }} />
        <Button label="Add shift type" variant="secondary" onPress={() => openTemplate('new')} />
      </Card>
      <View style={{ height: spacing.lg }} />

      <RotaForm
        key={pattern?.id ?? newPatternId}
        initial={
          pattern !== undefined
            ? patternToForm(pattern)
            : { startDate: today, days: resizeCycle([], NEW_CYCLE_DAYS) }
        }
        patternId={pattern?.id ?? newPatternId}
        jobId={job.id}
        templates={templates}
        today={today}
      />
      <Disclaimer />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row48: { minHeight: 48, justifyContent: 'center' },
  step: {
    minWidth: 48,
    minHeight: 48,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  line: { flexDirection: 'row', alignItems: 'center' },
  between: { justifyContent: 'space-between' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  nums: { fontVariant: [...tabularNums] },
  pressed: { opacity: 0.8 },
});
