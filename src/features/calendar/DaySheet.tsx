/**
 * Day sheet (SPEC §7.3): opened by tapping a Calendar day. Lists that day's
 * shifts with one-tap status actions and an overtime toggle, and adds or
 * edits manual shifts. Pattern shifts can be cancelled but never deleted.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Chip } from '../../components/Chip';
import { Disclaimer } from '../../components/Disclaimer';
import { db } from '../../db/client';
import type { StoredShift } from '../../db/shiftRepo';
import { DAY_SHORT, MONDAY_FIRST, MONTH_NAMES } from '../../engine/calendarMonth';
import { instantToLocal, localDaysBetween } from '../../engine/time';
import type { LocalDate, ShiftStatus } from '../../engine/types';
import { STATUS_CHIP } from '../shifts/statusChip';
import { useJobsStore } from '../../store/jobsStore';
import { useShiftsStore } from '../../store/shiftsStore';
import { tabularNums } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { ManualShiftForm } from './ManualShiftForm';

/** A known Monday, for weekday arithmetic without `Date#getDay`. */
const REFERENCE_MONDAY: LocalDate = '2001-01-01';
const NIGHT_START = '18:00';

const ACTIONS: readonly { status: Exclude<ShiftStatus, 'planned'>; label: string }[] = [
  { status: 'worked', label: 'Worked' },
  { status: 'sick', label: 'Sick' },
  { status: 'holiday', label: 'Holiday' },
  { status: 'cancelled', label: 'Cancel shift' },
];

/** "Sat 25 Oct" for a London date. */
export function daySheetTitle(date: LocalDate): string {
  const weekday = ((localDaysBetween(REFERENCE_MONDAY, date) % 7) + 7) % 7;
  const month = MONTH_NAMES[Number(date.slice(5, 7)) - 1].slice(0, 3);
  return `${DAY_SHORT[MONDAY_FIRST[weekday]]} ${Number(date.slice(8, 10))} ${month}`;
}

const SELECTED_BORDER = 2;

type Mode = { kind: 'list' } | { kind: 'add' } | { kind: 'edit'; shift: StoredShift };

export type DaySheetProps = {
  /** The London date shown; null hides the sheet. */
  readonly date: LocalDate | null;
  readonly onClose: () => void;
};

function SegmentButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, typography, spacing, radius } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.segment,
        {
          borderRadius: radius.button,
          // Selected also gets a thicker ink border, so the state does not rely on the
          // signal fill colour (WCAG 1.4.11); padding absorbs the extra width.
          borderColor: selected ? colors.ink : colors.line,
          borderWidth: selected ? SELECTED_BORDER : 1,
          backgroundColor: selected ? colors.signal : colors.surface,
          paddingHorizontal: selected ? spacing.md - (SELECTED_BORDER - 1) : spacing.md,
        },
        pressed && styles.pressed,
      ]}
    >
      <Text
        style={[
          typography.bodyMedium,
          styles.nums,
          { color: selected ? colors.onSignal : colors.ink },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ShiftCard({
  shift,
  onEdit,
  onBreakdown,
  onError,
}: {
  shift: StoredShift;
  onEdit: () => void;
  onBreakdown: () => void;
  onError: (message: string | null) => void;
}) {
  const { colors, typography, spacing, radius } = useTheme();
  const setStatus = useShiftsStore((s) => s.setStatus);
  const editShift = useShiftsStore((s) => s.editShift);
  const removeManualShift = useShiftsStore((s) => s.removeManualShift);
  const start = instantToLocal(shift.start);
  const end = instantToLocal(shift.end);
  const night = end.date > shift.date || start.time >= NIGHT_START;
  const kind = `${night ? 'Night' : 'Day'} shift, ${shift.source === 'manual' ? 'added by you' : 'from your rota'}`;
  const chip = STATUS_CHIP[shift.status];
  const breakText =
    shift.unpaidBreakMinutes > 0 ? `, ${shift.unpaidBreakMinutes} min unpaid break` : '';

  const run = async (action: () => Promise<void>) => {
    onError(null);
    try {
      await action();
    } catch {
      onError('Could not save the change. Try again.');
    }
  };
  // Tapping the current status again puts the shift back to planned.
  const choose = (status: ShiftStatus) =>
    void run(() => setStatus(db, shift.id, shift.status === status ? 'planned' : status));

  return (
    <View testID={`shift-${shift.id}`} style={{ marginBottom: spacing.md }}>
      <Card>
        <Text style={[typography.bodyLarge, styles.nums, { color: colors.ink }]}>
          {`${start.time}–${end.time}`}
        </Text>
        <Text style={[typography.caption, styles.nums, { color: colors.inkMuted }]}>
          {`${kind}${breakText}`}
        </Text>
        <View style={{ marginTop: spacing.sm }}>
          <Chip label={chip.label} tone={chip.tone} selected />
        </View>
        <View style={[styles.wrap, { gap: spacing.sm, marginTop: spacing.md }]}>
          {ACTIONS.map((a) => (
            <SegmentButton
              key={a.status}
              label={a.label}
              selected={shift.status === a.status}
              onPress={() => choose(a.status)}
            />
          ))}
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="Overtime"
          accessibilityState={{ checked: shift.overtimeFlag }}
          onPress={() =>
            void run(() => editShift(db, { ...shift, overtimeFlag: !shift.overtimeFlag }))
          }
          style={({ pressed }) => [
            styles.toggle,
            {
              marginTop: spacing.md,
              borderColor: colors.line,
              borderRadius: radius.button,
              paddingHorizontal: spacing.md,
            },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[typography.body, styles.grow, { color: colors.ink }]}>Overtime</Text>
          <View
            style={[
              styles.track,
              {
                borderRadius: radius.chip,
                borderColor: shift.overtimeFlag ? colors.signal : colors.line,
                backgroundColor: shift.overtimeFlag ? colors.signal : colors.board,
                alignItems: shift.overtimeFlag ? 'flex-end' : 'flex-start',
              },
            ]}
          >
            <View
              style={[
                styles.thumb,
                {
                  borderRadius: radius.chip,
                  backgroundColor: shift.overtimeFlag ? colors.onSignal : colors.inkMuted,
                },
              ]}
            />
          </View>
          <Text style={[typography.body, { color: colors.ink, marginLeft: spacing.sm }]}>
            {shift.overtimeFlag ? 'On' : 'Off'}
          </Text>
        </Pressable>
        <View style={{ marginTop: spacing.md }}>
          <Button label="Pay breakdown" variant="secondary" onPress={onBreakdown} />
        </View>
        {shift.source === 'manual' && (
          <View style={[styles.row, { gap: spacing.sm, marginTop: spacing.md }]}>
            <View style={styles.grow}>
              <Button label="Edit" variant="secondary" onPress={onEdit} />
            </View>
            <View style={styles.grow}>
              <Button
                label="Delete"
                variant="secondary"
                onPress={() =>
                  Alert.alert('Delete this shift?', 'This removes the shift you added.', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () => void run(() => removeManualShift(db, shift.id)),
                    },
                  ])
                }
              />
            </View>
          </View>
        )}
      </Card>
    </View>
  );
}

export function DaySheet({ date, onClose }: DaySheetProps) {
  const { colors, typography, spacing, radius } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const job = useJobsStore((s) => s.jobs[0]);
  const allShifts = useShiftsStore((s) => s.shifts);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setMode({ kind: 'list' });
    setError(null);
    onClose();
  };

  // The sheet is a Modal: close it first, then open the shift's breakdown.
  const openBreakdown = (id: string) => {
    close();
    router.push({ pathname: '/shift/[id]', params: { id } });
  };

  if (date === null || job === undefined) return null;
  const dayShifts = allShifts
    .filter((s) => s.date === date)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const back = () => setMode({ kind: 'list' });

  return (
    <Modal visible transparent animationType="none" onRequestClose={close}>
      <View style={[styles.overlay, { backgroundColor: colors.board }]}>
        <View
          testID="day-sheet"
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderColor: colors.line,
              borderTopLeftRadius: radius.card,
              borderTopRightRadius: radius.card,
              padding: spacing.lg,
              // Edge-to-edge: keep the last content (the disclaimer) off the gesture bar.
              paddingBottom: spacing.lg + insets.bottom,
            },
          ]}
        >
          <Text
            accessibilityRole="header"
            style={[typography.title, styles.nums, { color: colors.ink, marginBottom: spacing.md }]}
          >
            {daySheetTitle(date)}
          </Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            {mode.kind === 'list' ? (
              <>
                {dayShifts.length === 0 && (
                  <Text
                    style={[typography.body, { color: colors.inkMuted, marginBottom: spacing.md }]}
                  >
                    No shifts on this day.
                  </Text>
                )}
                {dayShifts.map((s) => (
                  <ShiftCard
                    key={s.id}
                    shift={s}
                    onEdit={() => setMode({ kind: 'edit', shift: s })}
                    onBreakdown={() => openBreakdown(s.id)}
                    onError={setError}
                  />
                ))}
                {error !== null && (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={[typography.caption, { color: colors.alert, marginBottom: spacing.sm }]}
                  >
                    {error}
                  </Text>
                )}
                <View style={{ gap: spacing.sm }}>
                  <Button
                    label="Add shift"
                    variant="secondary"
                    onPress={() => setMode({ kind: 'add' })}
                  />
                  <Button label="Close" onPress={close} />
                </View>
              </>
            ) : (
              <ManualShiftForm
                key={mode.kind === 'edit' ? mode.shift.id : 'new'}
                date={date}
                job={job}
                shift={mode.kind === 'edit' ? mode.shift : undefined}
                onDone={back}
                onCancel={back}
              />
            )}
            <View style={{ marginTop: spacing.lg }}>
              <Disclaimer />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  nums: { fontVariant: [...tabularNums] },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '90%', borderWidth: 1, borderBottomWidth: 0 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  row: { flexDirection: 'row' },
  grow: { flex: 1 },
  segment: {
    minHeight: 48,
    minWidth: 48,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggle: { minHeight: 48, borderWidth: 1, flexDirection: 'row', alignItems: 'center' },
  track: { width: 44, height: 24, borderWidth: 1, padding: 2, justifyContent: 'center' },
  thumb: { width: 18, height: 18 },
  pressed: { opacity: 0.8 },
});
