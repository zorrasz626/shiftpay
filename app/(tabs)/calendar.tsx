import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { bankHolidays } from '../../src/config/bankHolidays';
import { Button } from '../../src/components/Button';
import { Disclaimer } from '../../src/components/Disclaimer';
import { Screen } from '../../src/components/Screen';
import {
  type CalendarDay,
  type CalendarShiftKind,
  MONTH_NAMES,
  addMonths,
  calendarMonth,
  monthRange,
} from '../../src/engine/calendarMonth';
import { instantToLocal } from '../../src/engine/time';
import { useJobsStore } from '../../src/store/jobsStore';
import { useShiftsStore } from '../../src/store/shiftsStore';
import { type Colors, tabularNums } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/useTheme';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;
const MAX_CODES = 2;

const LEGEND: readonly { kind: CalendarShiftKind; code: string; label: string }[] = [
  { kind: 'day', code: 'D', label: 'Day' },
  { kind: 'night', code: 'N', label: 'Night' },
  { kind: 'overtime', code: 'OT', label: 'Overtime' },
  { kind: 'holiday', code: 'H', label: 'Holiday' },
  { kind: 'sick', code: 'S', label: 'Sick' },
  { kind: 'cancelled', code: 'X', label: 'Cancelled' },
];

type YearMonth = { year: number; month: number };

function parseYearMonth(date: string): YearMonth {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

/** Text + fill colours per shift kind; tokens only. */
function codeStyle(colors: Colors, kind: CalendarShiftKind) {
  switch (kind) {
    case 'day':
      return { color: colors.ink };
    case 'night':
      return { color: colors.night };
    case 'holiday':
      return { color: colors.positive };
    case 'sick':
      return { color: colors.alert };
    case 'cancelled':
      return { color: colors.inkMuted, textDecorationLine: 'line-through' as const };
    case 'overtime':
      return { color: colors.onSignal, backgroundColor: colors.signal };
  }
}

function ShiftCode({ kind, code }: { kind: CalendarShiftKind; code: string }) {
  const { colors, typography, spacing, radius } = useTheme();
  return (
    <Text
      style={[
        typography.caption,
        styles.nums,
        styles.code,
        { borderRadius: radius.chip, paddingHorizontal: spacing.xs },
        codeStyle(colors, kind),
      ]}
    >
      {code}
    </Text>
  );
}

function dayLabel(day: CalendarDay, column: number): string {
  const parts = [`${WEEKDAY_NAMES[column]} ${day.dayOfMonth} ${MONTH_NAMES[Number(day.date.slice(5, 7)) - 1]}`];
  if (day.isToday) parts.push('today');
  if (day.isBankHoliday) parts.push('bank holiday');
  if (day.shifts.length === 0) parts.push('no shifts');
  for (const s of day.shifts) parts.push(s.label);
  return parts.join(', ');
}

function DayCell({ day, column }: { day: CalendarDay; column: number }) {
  const { colors, typography, spacing } = useTheme();
  const extra = day.shifts.length - MAX_CODES;
  const numberColor = day.isToday ? colors.onSignal : day.inMonth ? colors.ink : colors.inkMuted;
  return (
    <View
      testID={`day-${day.date}`}
      accessible
      accessibilityLabel={dayLabel(day, column)}
      style={[styles.cell, { borderTopColor: colors.line, paddingVertical: spacing.xs }]}
    >
      <View
        testID={day.isToday ? 'today-marker' : undefined}
        style={[styles.dateMarker, day.isToday && { backgroundColor: colors.signal }]}
      >
        <Text style={[typography.body, styles.nums, { color: numberColor }]}>{day.dayOfMonth}</Text>
      </View>
      {day.isBankHoliday && (
        <Text style={[typography.caption, { color: day.inMonth ? colors.ink : colors.inkMuted }]}>
          BH
        </Text>
      )}
      {day.shifts.slice(0, MAX_CODES).map((s) => (
        <ShiftCode key={s.id} kind={s.kind} code={s.code} />
      ))}
      {extra > 0 && (
        <Text style={[typography.caption, styles.nums, { color: colors.inkMuted }]}>{`+${extra}`}</Text>
      )}
    </View>
  );
}

function NavButton({
  glyph,
  label,
  disabled,
  onPress,
}: {
  glyph: string;
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
        styles.nav,
        { borderColor: colors.line, borderRadius: radius.button },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[typography.bodyLarge, { color: disabled ? colors.inkMuted : colors.ink }]}>
        {glyph}
      </Text>
    </Pressable>
  );
}

export default function CalendarScreen() {
  const { colors, typography, spacing } = useTheme();
  const job = useJobsStore((s) => s.jobs[0]);
  const shifts = useShiftsStore((s) => s.shifts);
  const range = useShiftsStore((s) => s.range);
  const today = instantToLocal(new Date().toISOString()).date;
  const current = parseYearMonth(today);
  const [shown, setShown] = useState<YearMonth>(current);

  const grid = useMemo(
    () =>
      job === undefined
        ? null
        : calendarMonth({
            year: shown.year,
            month: shown.month,
            shifts,
            bankHolidays,
            region: job.bankHolidayRegion,
            today,
          }),
    [job, shifts, shown, today],
  );

  if (job === undefined || grid === null) {
    return (
      <Screen title="Calendar">
        <Disclaimer />
      </Screen>
    );
  }

  /** True if the month `n` away overlaps the loaded shift range. */
  const canGo = (n: number): boolean => {
    if (range === null) return false;
    const target = addMonths(shown.year, shown.month, n);
    const { start, end } = monthRange(target.year, target.month);
    return end >= range.start && start <= range.end;
  };
  const go = (n: number) => setShown(addMonths(shown.year, shown.month, n));
  const onCurrent = shown.year === current.year && shown.month === current.month;
  const muted = [typography.caption, { color: colors.inkMuted }];

  return (
    <Screen title="Calendar" scroll>
      <View style={styles.header}>
        <NavButton glyph="‹" label="Previous month" disabled={!canGo(-1)} onPress={() => go(-1)} />
        <Text
          accessibilityRole="header"
          style={[typography.bodyLarge, styles.nums, styles.title, { color: colors.ink }]}
        >
          {grid.title}
        </Text>
        <NavButton glyph="›" label="Next month" disabled={!canGo(1)} onPress={() => go(1)} />
      </View>
      {!onCurrent && (
        <View style={[styles.today, { marginTop: spacing.sm }]}>
          <Button label="Today" variant="secondary" onPress={() => setShown(current)} />
        </View>
      )}

      <View style={[styles.row, { marginTop: spacing.md }]}>
        {WEEKDAYS.map((d) => (
          <Text key={d} style={[muted, styles.weekday]}>
            {d}
          </Text>
        ))}
      </View>
      {grid.weeks.map((week) => (
        <View key={week[0].date} style={styles.row}>
          {week.map((day, column) => (
            <DayCell key={day.date} day={day} column={column} />
          ))}
        </View>
      ))}

      <View testID="legend" style={[styles.legend, { marginTop: spacing.lg, gap: spacing.md }]}>
        {LEGEND.map((item) => (
          <View key={item.kind} style={[styles.legendItem, { gap: spacing.xs }]}>
            <ShiftCode kind={item.kind} code={item.code} />
            <Text style={muted}>{item.label}</Text>
          </View>
        ))}
        <View style={[styles.legendItem, { gap: spacing.xs }]}>
          <Text style={[typography.caption, { color: colors.ink }]}>BH</Text>
          <Text style={muted}>Bank holiday</Text>
        </View>
      </View>
      <View style={{ height: spacing.xl }} />

      <Disclaimer />
    </Screen>
  );
}

const styles = StyleSheet.create({
  nums: { fontVariant: [...tabularNums] },
  header: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1, textAlign: 'center' },
  nav: { minWidth: 48, minHeight: 48, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.8 },
  today: { alignSelf: 'flex-start' },
  row: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center' },
  cell: { flex: 1, minHeight: 64, alignItems: 'center', borderTopWidth: 1 },
  dateMarker: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  code: { overflow: 'hidden', marginTop: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
});
