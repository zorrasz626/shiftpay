/**
 * Pay tab (SPEC §7 item 5): the pay periods, newest first, each with its
 * expected gross from the engine. A row opens the period detail.
 */
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Chip } from '../../src/components/Chip';
import { Disclaimer } from '../../src/components/Disclaimer';
import { Screen } from '../../src/components/Screen';
import { useBankHolidaysStore } from '../../src/store/bankHolidaysStore';
import { formatPence } from '../../src/engine/money';
import { payPeriodList, type PayPeriodListItem } from '../../src/engine/periodList';
import { instantToLocal } from '../../src/engine/time';
import { hoursAndShifts, payDayLine, periodRangeLabel } from '../../src/features/pay/payView';
import { useJobsStore } from '../../src/store/jobsStore';
import { useRulesStore } from '../../src/store/rulesStore';
import { useShiftsStore } from '../../src/store/shiftsStore';
import { tabularNums } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/useTheme';

const WHEN_LABEL: Record<PayPeriodListItem['when'], string | null> = {
  past: null,
  current: 'This period',
  next: 'Next period',
};

function PeriodRow({ item, today }: { item: PayPeriodListItem; today: string }) {
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const range = periodRangeLabel(item.start, item.end);
  const total = formatPence(item.totalGrossPence);
  const chip = WHEN_LABEL[item.when];
  const muted = [typography.caption, styles.nums, { color: colors.inkMuted }];

  return (
    <Pressable
      testID="period-row"
      accessibilityRole="button"
      accessibilityLabel={`${range}, ${total}`}
      onPress={() => router.push({ pathname: '/period/[start]', params: { start: item.start } })}
      style={[
        styles.row,
        styles.divider,
        { paddingVertical: spacing.sm, borderBottomColor: colors.line },
      ]}
    >
      <View style={styles.grow}>
        <Text style={[typography.bodyMedium, styles.nums, { color: colors.ink }]}>{range}</Text>
        <Text style={muted}>{payDayLine(item.payDate, today)}</Text>
        <Text style={muted}>{hoursAndShifts(item.paidHours, item.shiftCount)}</Text>
        {chip !== null && (
          <View style={{ marginTop: spacing.xs }}>
            <Chip label={chip} tone={item.when === 'current' ? 'positive' : 'neutral'} />
          </View>
        )}
      </View>
      <Text
        testID="period-total"
        style={[
          typography.bodyMedium,
          styles.nums,
          styles.amount,
          { color: colors.ink, marginLeft: spacing.sm },
        ]}
      >
        {total}
      </Text>
    </Pressable>
  );
}

export default function PayScreen() {
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const job = useJobsStore((s) => s.jobs[0]);
  const shifts = useShiftsStore((s) => s.shifts);
  const bankHolidays = useBankHolidaysStore((s) => s.lookup);
  const range = useShiftsStore((s) => s.range);
  const rules = useRulesStore((s) => s.rules);
  const today = instantToLocal(new Date().toISOString()).date;

  const periods = useMemo(
    () =>
      job === undefined || range === null
        ? []
        : payPeriodList({
            shifts,
            job,
            rules: rules.filter((r) => r.jobId === job.id),
            bankHolidays,
            range,
            today,
          }),
    [job, shifts, rules, range, today, bankHolidays],
  );

  const body = [typography.body, { color: colors.inkMuted, marginBottom: spacing.lg }];

  if (job === undefined) {
    return (
      <Screen title="Pay">
        <Text style={body}>No job set up yet. Add one to see your pay periods.</Text>
        <Disclaimer />
      </Screen>
    );
  }

  return (
    <Screen title="Pay" scroll>
      {periods.length === 0 ? (
        <Text style={body}>No pay periods to show yet.</Text>
      ) : (
        <>
          <Card title="Pay periods">
            {periods.map((p) => (
              <PeriodRow key={p.start} item={p} today={today} />
            ))}
          </Card>
          <View style={{ height: spacing.lg }} />
        </>
      )}
      <Button
        label="Stats"
        variant="secondary"
        accessibilityLabel="Stats: earnings by month, overtime and premiums"
        onPress={() => router.push('/stats')}
      />
      <View style={{ height: spacing.lg }} />
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
});
