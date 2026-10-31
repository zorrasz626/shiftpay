/**
 * Pay period detail (SPEC §7 item 5): one period's expected gross, its
 * per-rule breakdown and its shifts. Reached from a Pay tab row; the route
 * param is the period's start date.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BigNumber } from '../../src/components/BigNumber';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Chip, type ChipTone } from '../../src/components/Chip';
import { Disclaimer } from '../../src/components/Disclaimer';
import { Screen } from '../../src/components/Screen';
import { bankHolidays } from '../../src/config/bankHolidays';
import { formatPence } from '../../src/engine/money';
import { periodContaining } from '../../src/engine/payPeriods';
import { periodDetail, type PeriodDetailShift } from '../../src/engine/periodList';
import { instantToLocal } from '../../src/engine/time';
import type { ShiftStatus } from '../../src/engine/types';
import { formatDayDate } from '../../src/features/home/homeView';
import { formatHours, payDayLine, periodRangeLabel } from '../../src/features/pay/payView';
import { useJobsStore } from '../../src/store/jobsStore';
import { payslipForPeriod, usePayslipsStore } from '../../src/store/payslipsStore';
import { useRulesStore } from '../../src/store/rulesStore';
import { useShiftsStore } from '../../src/store/shiftsStore';
import { tabularNums } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/useTheme';

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

const STATUS_CHIP: Record<Exclude<ShiftStatus, 'planned'>, { label: string; tone: ChipTone }> = {
  worked: { label: 'Worked', tone: 'positive' },
  sick: { label: 'Sick', tone: 'alert' },
  holiday: { label: 'Holiday', tone: 'positive' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

function Amount({ pence, testID }: { pence: number; testID?: string }) {
  const { colors, typography, spacing } = useTheme();
  return (
    <Text
      testID={testID}
      style={[
        typography.bodyMedium,
        styles.nums,
        styles.amount,
        { color: colors.ink, marginLeft: spacing.sm },
      ]}
    >
      {formatPence(pence)}
    </Text>
  );
}

function LineRow({ label, hours, pence }: { label: string; hours: number; pence: number }) {
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
        <Text style={[typography.body, { color: colors.ink }]}>{label}</Text>
        <Text style={[typography.caption, styles.nums, { color: colors.inkMuted }]}>
          {formatHours(hours)}
        </Text>
      </View>
      <Amount pence={pence} />
    </View>
  );
}

function ShiftRow({ shift }: { shift: PeriodDetailShift }) {
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const date = formatDayDate(shift.date);
  const times = `${instantToLocal(shift.start).time}–${instantToLocal(shift.end).time}`;
  const chip = shift.status === 'planned' ? null : STATUS_CHIP[shift.status];

  return (
    <Pressable
      testID="shift-row"
      accessibilityRole="button"
      accessibilityLabel={`${date} ${times}, ${formatPence(shift.totalGrossPence)}`}
      onPress={() => router.push({ pathname: '/shift/[id]', params: { id: shift.id } })}
      style={[
        styles.row,
        styles.divider,
        { paddingVertical: spacing.sm, borderBottomColor: colors.line },
      ]}
    >
      <View style={styles.grow}>
        <Text style={[typography.body, styles.nums, { color: colors.ink }]}>{date}</Text>
        <Text style={[typography.caption, styles.nums, { color: colors.inkMuted }]}>{times}</Text>
        {chip !== null && (
          <View style={{ marginTop: spacing.xs }}>
            <Chip label={chip.label} tone={chip.tone} />
          </View>
        )}
      </View>
      <Amount pence={shift.totalGrossPence} />
    </Pressable>
  );
}

export default function PeriodDetailScreen() {
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const { start } = useLocalSearchParams<{ start: string }>();
  const job = useJobsStore((s) => s.jobs[0]);
  const shifts = useShiftsStore((s) => s.shifts);
  const range = useShiftsStore((s) => s.range);
  const rules = useRulesStore((s) => s.rules);
  const payslips = usePayslipsStore((s) => s.payslips);
  const today = instantToLocal(new Date().toISOString()).date;

  // Only a real period start whose whole period is loaded (else totals would be partial).
  const period = useMemo(() => {
    if (job === undefined || range === null || typeof start !== 'string') return null;
    if (!LOCAL_DATE.test(start)) return null;
    const p = periodContaining(start, job);
    return p.start === start && p.start >= range.start && p.end <= range.end ? p : null;
  }, [job, range, start]);

  const detail = useMemo(
    () =>
      job === undefined || period === null
        ? null
        : periodDetail({
            shifts,
            job,
            rules: rules.filter((r) => r.jobId === job.id),
            bankHolidays,
            period,
          }),
    [job, period, shifts, rules],
  );

  const back = <Button label="Back" variant="secondary" onPress={() => router.back()} />;

  if (period === null || detail === null) {
    return (
      <Screen title="Period not found" bottomInset footer={back}>
        <Text style={[typography.body, { color: colors.ink, marginBottom: spacing.lg }]}>
          This pay period is not available.
        </Text>
        <Disclaimer />
      </Screen>
    );
  }

  const gap = { height: spacing.lg };
  const payslip = job === undefined ? undefined : payslipForPeriod(payslips, job.id, period.start);

  return (
    <Screen title={periodRangeLabel(period.start, period.end)} scroll bottomInset footer={back}>
      <BigNumber pence={detail.totalGrossPence} caption="Expected gross for this period" />
      <Text style={[typography.body, styles.nums, { color: colors.ink, marginTop: spacing.md }]}>
        {payDayLine(detail.payDate, today)}
      </Text>
      <View style={gap} />

      <View testID="breakdown">
        <Card title="Breakdown">
          {detail.lines.length === 0 ? (
            <Text style={[typography.body, { color: colors.inkMuted }]}>
              No pay for this period.
            </Text>
          ) : (
            detail.lines.map((l) => (
              <LineRow key={l.key} label={l.label} hours={l.hours} pence={l.pence} />
            ))
          )}
          <View style={[styles.row, { paddingTop: spacing.sm }]}>
            <Text style={[typography.bodyMedium, styles.grow, { color: colors.ink }]}>Total</Text>
            <Amount pence={detail.totalGrossPence} testID="breakdown-total" />
          </View>
        </Card>
      </View>
      <View style={gap} />

      <View testID="shifts">
        <Card title="Shifts">
          {detail.shifts.length === 0 ? (
            <Text style={[typography.body, { color: colors.inkMuted }]}>
              No shifts in this period.
            </Text>
          ) : (
            detail.shifts.map((s) => <ShiftRow key={s.id} shift={s} />)
          )}
        </Card>
      </View>
      <View style={gap} />

      <Button
        label={payslip === undefined ? 'Check payslip' : 'Edit payslip'}
        variant="secondary"
        onPress={() =>
          router.push({ pathname: '/payslip/[start]', params: { start: period.start } })
        }
      />
      {payslip !== undefined && (
        <Text
          style={[
            typography.caption,
            styles.center,
            styles.nums,
            { color: colors.inkMuted, marginTop: spacing.xs },
          ]}
        >
          {`Payslip entered: ${formatPence(payslip.grossPaidPence)} gross`}
        </Text>
      )}
      <View style={gap} />

      <Disclaimer />
    </Screen>
  );
}

const styles = StyleSheet.create({
  nums: { fontVariant: [...tabularNums] },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth },
  grow: { flex: 1 },
  amount: { textAlign: 'right' },
  center: { textAlign: 'center' },
});
