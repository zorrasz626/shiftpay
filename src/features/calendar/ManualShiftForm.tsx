/**
 * Add / edit a manual shift from the day sheet (SPEC §7.3). Times are London
 * wall-clock "HH:MM"; an end at or before the start ends the next day.
 * Validation and the London conversion live in `engine/manualShift.ts`.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { db } from '../../db/client';
import type { StoredJob } from '../../db/jobRepo';
import { listShiftTemplates } from '../../db/rotaRepo';
import type { StoredShift } from '../../db/shiftRepo';
import {
  type ManualShiftField,
  isValidWallClock,
  manualShiftTimes,
  shiftToForm,
} from '../../engine/manualShift';
import type { LocalDate } from '../../engine/types';
import { newId } from '../../store/onboardingStore';
import { useShiftsStore } from '../../store/shiftsStore';
import { tabularNums } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';

type FormText = { startTime: string; endTime: string; breakText: string };

const FALLBACK: FormText = { startTime: '09:00', endTime: '17:00', breakText: '0' };

export type ManualShiftFormProps = {
  readonly date: LocalDate;
  readonly job: StoredJob;
  /** The manual shift being edited; omit to add a new one. */
  readonly shift?: StoredShift;
  readonly onDone: () => void;
  readonly onCancel: () => void;
};

/** Whole minutes as typed, or NaN (reported by `manualShiftTimes`). */
function parseBreak(text: string): number {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN;
}

export function ManualShiftForm({ date, job, shift, onDone, onCancel }: ManualShiftFormProps) {
  const { colors, typography, spacing } = useTheme();
  const addManualShift = useShiftsStore((s) => s.addManualShift);
  const editShift = useShiftsStore((s) => s.editShift);
  const [text, setText] = useState<FormText | null>(() => {
    if (shift === undefined) return null;
    const f = shiftToForm(shift);
    return { startTime: f.startTime, endTime: f.endTime, breakText: String(f.unpaidBreakMinutes) };
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Adding: default to the job's first rota template, else 09:00–17:00 with no break.
  useEffect(() => {
    if (text !== null) return;
    let live = true;
    listShiftTemplates(db, job.id)
      .then((templates) => {
        const t = templates[0];
        if (live) {
          setText(
            t === undefined
              ? FALLBACK
              : {
                  startTime: t.startTime,
                  endTime: t.endTime,
                  breakText: String(t.unpaidBreakMinutes),
                },
          );
        }
      })
      .catch(() => {
        if (live) setText(FALLBACK);
      });
    return () => {
      live = false;
    };
  }, [job.id, text]);

  if (text === null) {
    return <Text style={[typography.body, { color: colors.inkMuted }]}>Loading…</Text>;
  }

  const result = manualShiftTimes({
    date,
    startTime: text.startTime,
    endTime: text.endTime,
    unpaidBreakMinutes: parseBreak(text.breakText),
  });
  const errorFor = (field: ManualShiftField): string | undefined =>
    result.ok ? undefined : result.errors.find((e) => e.field === field)?.message;
  const overnight =
    isValidWallClock(text.startTime) &&
    isValidWallClock(text.endTime) &&
    text.endTime <= text.startTime;
  const set = (patch: Partial<FormText>) => setText({ ...text, ...patch });

  const save = async () => {
    if (!result.ok) return;
    setSaving(true);
    setSaveError(null);
    try {
      const unpaidBreakMinutes = parseBreak(text.breakText);
      if (shift === undefined) {
        await addManualShift(db, {
          id: newId('shift'),
          jobId: job.id,
          date,
          start: result.start,
          end: result.end,
          unpaidBreakMinutes,
          status: 'planned',
          overtimeFlag: false,
        });
      } else {
        await editShift(db, { ...shift, start: result.start, end: result.end, unpaidBreakMinutes });
      }
      onDone();
    } catch {
      setSaveError('Could not save the shift. Try again.');
      setSaving(false);
    }
  };

  return (
    <View testID="manual-shift-form">
      <Text
        accessibilityRole="header"
        style={[typography.bodyLarge, { color: colors.ink, marginBottom: spacing.md }]}
      >
        {shift === undefined ? 'Add shift' : 'Edit shift'}
      </Text>
      <TextField
        label="Start time"
        value={text.startTime}
        onChangeText={(startTime) => set({ startTime })}
        keyboardType="numbers-and-punctuation"
        placeholder="09:00"
        error={errorFor('startTime')}
      />
      <TextField
        label="End time"
        value={text.endTime}
        onChangeText={(endTime) => set({ endTime })}
        keyboardType="numbers-and-punctuation"
        placeholder="17:00"
        error={errorFor('endTime')}
        helper={overnight ? 'Ends the next day' : undefined}
      />
      <TextField
        label="Unpaid break (minutes)"
        value={text.breakText}
        onChangeText={(breakText) => set({ breakText })}
        keyboardType="number-pad"
        placeholder="0"
        error={errorFor('unpaidBreakMinutes')}
      />
      {saveError !== null && (
        <Text
          accessibilityLiveRegion="polite"
          style={[
            typography.caption,
            styles.nums,
            { color: colors.alert, marginBottom: spacing.sm },
          ]}
        >
          {saveError}
        </Text>
      )}
      <View style={{ gap: spacing.sm }}>
        <Button label="Save shift" onPress={() => void save()} disabled={!result.ok || saving} />
        <Button label="Back" variant="secondary" onPress={onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  nums: { fontVariant: [...tabularNums] },
});
