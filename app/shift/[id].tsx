/**
 * Shift detail (SPEC §7): how one shift's expected gross is made up — base,
 * each premium rule and overtime, with hours and £ — plus its time slices.
 * Reached from the Calendar day sheet's "Pay breakdown" button.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BigNumber } from '../../src/components/BigNumber';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Disclaimer } from '../../src/components/Disclaimer';
import { Screen } from '../../src/components/Screen';
import { useBankHolidaysStore } from '../../src/store/bankHolidaysStore';
import { formatPence } from '../../src/engine/money';
import { shiftDetail } from '../../src/engine/shiftDetail';
import { instantToLocal } from '../../src/engine/time';
import type { ShiftStatus } from '../../src/engine/types';
import { daySheetTitle } from '../../src/features/calendar/DaySheet';
import { useJobsStore } from '../../src/store/jobsStore';
import { useRulesStore } from '../../src/store/rulesStore';
import { useShiftsStore } from '../../src/store/shiftsStore';
import { tabularNums } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/useTheme';

const STATUS_LABEL: Record<ShiftStatus, string> = {
  planned: 'Planned',
  worked: 'Worked',
  sick: 'Sick',
  holiday: 'Holiday',
  cancelled: 'Cancelled',
};

/** "8 h", "7.5 h", "0.33 h". Display only. */
function formatHours(hours: number): string {
  return `${Number(hours.toFixed(2))} h`;
}

function Row({ label, detail, pence }: { label: string; detail: string; pence: number }) {
  const { colors, typography, spacing } = useTheme();
  return (
    <View
      testID="breakdown-row"
      style={[
        styles.row,
        styles.divider,
        { paddingVertical: spacing.sm, borderBottomColor: colors.line },
      ]}
    >
      <View style={styles.grow}>
        <Text style={[typography.body, styles.nums, { color: colors.ink }]}>{label}</Text>
        <Text style={[typography.caption, styles.nums, { color: colors.inkMuted }]}>{detail}</Text>
      </View>
      <Text
        style={[
          typography.bodyMedium,
          styles.nums,
          styles.amount,
          { color: colors.ink, marginLeft: spacing.sm },
        ]}
      >
        {formatPence(pence)}
      </Text>
    </View>
  );
}

export default function ShiftDetailScreen() {
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const shifts = useShiftsStore((s) => s.shifts);
  const bankHolidays = useBankHolidaysStore((s) => s.lookup);
  const jobs = useJobsStore((s) => s.jobs);
  const rules = useRulesStore((s) => s.rules);

  const shift = shifts.find((s) => s.id === id);
  const job = shift === undefined ? undefined : jobs.find((j) => j.id === shift.jobId);
  const detail = useMemo(
    () =>
      shift === undefined || job === undefined
        ? null
        : shiftDetail({ shift, shifts, job, rules, bankHolidays }),
    [shift, shifts, job, rules, bankHolidays],
  );

  const back = <Button label="Back" variant="secondary" onPress={() => router.back()} />;

  if (shift === undefined || detail === null) {
    return (
      <Screen title="Shift not found" bottomInset footer={back}>
        <Text style={[typography.body, { color: colors.ink, marginBottom: spacing.lg }]}>
          This shift may have been deleted.
        </Text>
        <Disclaimer />
      </Screen>
    );
  }

  const start = instantToLocal(shift.start);
  const end = instantToLocal(shift.end);
  const gap = { height: spacing.lg };

  return (
    <Screen title={daySheetTitle(shift.date)} scroll bottomInset footer={back}>
      <Text style={[typography.bodyLarge, styles.nums, { color: colors.ink }]}>
        {`${start.time}–${end.time}`}
      </Text>
      <Text style={[typography.caption, { color: colors.inkMuted, marginBottom: spacing.lg }]}>
        {STATUS_LABEL[shift.status]}
      </Text>
      <BigNumber pence={detail.totalGrossPence} caption="Expected gross for this shift" />
      <View style={gap} />

      <View testID="breakdown">
        <Card title="Pay breakdown">
          {detail.lines.length === 0 ? (
            <Text style={[typography.body, { color: colors.inkMuted }]}>
              No pay for this shift.
            </Text>
          ) : (
            detail.lines.map((l) => (
              <Row key={l.key} label={l.label} detail={formatHours(l.hours)} pence={l.pence} />
            ))
          )}
          <View style={[styles.row, { paddingTop: spacing.sm }]}>
            <Text style={[typography.bodyMedium, styles.grow, { color: colors.ink }]}>Total</Text>
            <Text
              testID="breakdown-total"
              style={[
                typography.bodyMedium,
                styles.nums,
                styles.amount,
                { color: colors.ink, marginLeft: spacing.sm },
              ]}
            >
              {formatPence(detail.totalGrossPence)}
            </Text>
          </View>
        </Card>
      </View>
      <View style={gap} />

      {detail.slices.length > 0 && (
        <>
          <View testID="slices">
            <Card title="Time slices">
              {detail.slices.map((s, i) => (
                <Row
                  key={`${s.start}-${i}`}
                  label={`${s.localStart}–${s.localEnd}`}
                  detail={`${formatHours(s.paidMinutes / 60)} · ${s.labels.length === 0 ? 'Base' : `Base + ${s.labels.join(' + ')}`}`}
                  pence={s.totalPence}
                />
              ))}
            </Card>
          </View>
          <View style={gap} />
        </>
      )}

      <Disclaimer />
    </Screen>
  );
}

const styles = StyleSheet.create({
  nums: { fontVariant: [...tabularNums] },
  row: { flexDirection: 'row', alignItems: 'center' },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth },
  grow: { flex: 1 },
  amount: { textAlign: 'right' },
});
