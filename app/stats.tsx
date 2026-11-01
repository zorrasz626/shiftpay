/**
 * Stats (SPEC §7.7, Pro): earned pay by calendar month, overtime hours and
 * premiums by rule, over a chosen range. The shifts store only holds a few
 * months, so the range's shifts (with a margin for pay periods that start
 * before it) are read from the DB; the read re-runs whenever the store's
 * shifts or the job change.
 */
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { type Bar, BarChart } from '../src/components/BarChart';
import { BigNumber } from '../src/components/BigNumber';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Chip } from '../src/components/Chip';
import { Disclaimer } from '../src/components/Disclaimer';
import { ProUpsell } from '../src/components/ProUpsell';
import { Screen } from '../src/components/Screen';
import { db } from '../src/db/client';
import { listShifts, type StoredShift } from '../src/db/shiftRepo';
import { MONTH_NAMES, addMonths } from '../src/engine/calendarMonth';
import { formatPence } from '../src/engine/money';
import { type LocalMonth, type MonthStats, monthlyStats } from '../src/engine/stats';
import { addLocalDays, instantToLocal } from '../src/engine/time';
import type { LocalDate } from '../src/engine/types';
import { formatHours } from '../src/features/pay/payView';
import { hasFeature } from '../src/features/pro/gates';
import { useEntitlement } from '../src/features/pro/useEntitlement';
import { useBankHolidaysStore } from '../src/store/bankHolidaysStore';
import { useJobsStore } from '../src/store/jobsStore';
import { useRulesStore } from '../src/store/rulesStore';
import { useShiftsStore } from '../src/store/shiftsStore';
import { tabularNums } from '../src/theme/tokens';
import { useTheme } from '../src/theme/useTheme';

export type StatsRange = 'last6' | 'last12' | 'taxYear';

const RANGES: { key: StatsRange; label: string }[] = [
  { key: 'last6', label: 'Last 6 months' },
  { key: 'last12', label: 'Last 12 months' },
  { key: 'taxYear', label: 'Since April' },
];

export const EMPTY_MESSAGE = 'No earnings yet — stats appear after your first shifts';

/** Days read before the first month / after the last, so whole pay periods are loaded. */
const LOAD_MARGIN_DAYS = 62;

function shiftMonth(month: LocalMonth, n: number): LocalMonth {
  const r = addMonths(Number(month.slice(0, 4)), Number(month.slice(5, 7)), n);
  return `${r.year}-${String(r.month).padStart(2, '0')}`;
}

/** `{ from, to }` months for a range ending in the month of `today`. */
export function statsMonths(
  range: StatsRange,
  today: LocalDate,
): { from: LocalMonth; to: LocalMonth } {
  const to = today.slice(0, 7);
  switch (range) {
    case 'last6':
      return { from: shiftMonth(to, -5), to };
    case 'last12':
      return { from: shiftMonth(to, -11), to };
    case 'taxYear': {
      // Approximates the tax year (6 April) in whole calendar months: from the
      // latest April, so 1–5 April shows one bar rather than 13.
      const year = Number(today.slice(0, 4));
      const startYear = today >= `${year}-04-01` ? year : year - 1;
      return { from: `${startYear}-04`, to };
    }
  }
}

function monthName(month: LocalMonth): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

function shortMonth(month: LocalMonth): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1].slice(0, 3)} ${month.slice(0, 4)}`;
}

function monthBars(
  months: MonthStats[],
  value: (m: MonthStats) => number,
  label: (m: MonthStats) => string,
): Bar[] {
  return months.map((m) => ({
    key: m.month,
    label: shortMonth(m.month),
    value: value(m),
    valueLabel: label(m),
    accessibilityLabel: `${monthName(m.month)}, ${label(m)}`,
  }));
}

type Loaded = { key: string; shifts: StoredShift[] };

function TotalRow({ label, value, testID }: { label: string; value: string; testID: string }) {
  const { colors, typography, spacing } = useTheme();
  return (
    <View testID={testID} style={[styles.row, { paddingVertical: spacing.xs }]}>
      <Text style={[typography.body, styles.grow, { color: colors.inkMuted }]}>{label}</Text>
      <Text style={[typography.bodyMedium, styles.nums, { color: colors.ink }]}>{value}</Text>
    </View>
  );
}

export default function StatsScreen() {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const { isPro } = useEntitlement();
  const job = useJobsStore((s) => s.jobs[0]);
  const storeShifts = useShiftsStore((s) => s.shifts);
  const rules = useRulesStore((s) => s.rules);
  const bankHolidays = useBankHolidaysStore((s) => s.lookup);
  const [now] = useState(() => new Date().toISOString());
  const today = instantToLocal(now).date;
  const [range, setRange] = useState<StatsRange>('last6');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const allowed = hasFeature('stats', isPro);

  const { from, to } = statsMonths(range, today);
  const loadStart = addLocalDays(`${from}-01`, -LOAD_MARGIN_DAYS);
  const loadEnd = addLocalDays(`${shiftMonth(to, 1)}-01`, LOAD_MARGIN_DAYS);
  const loadKey = `${job?.id ?? ''}|${loadStart}|${loadEnd}`;

  useEffect(() => {
    if (!allowed || job === undefined) return;
    let cancelled = false;
    listShifts(db, loadStart, loadEnd, job.id)
      // A failed read falls back to what the store holds.
      .catch(() => storeShifts)
      .then((shifts) => {
        if (!cancelled) setLoaded({ key: loadKey, shifts });
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, job, loadStart, loadEnd, loadKey, storeShifts]);

  const stats = useMemo(
    () =>
      job === undefined || loaded === null || loaded.key !== loadKey
        ? null
        : monthlyStats({ shifts: loaded.shifts, job, rules, bankHolidays, from, to, now }),
    [job, loaded, loadKey, rules, bankHolidays, from, to, now],
  );

  const back = <Button label="Back" variant="secondary" onPress={() => router.back()} />;
  const muted = [typography.body, { color: colors.inkMuted }];
  const gap = <View style={{ height: spacing.lg }} />;

  if (!allowed) {
    return (
      <Screen title="Stats" scroll bottomInset footer={back}>
        <ProUpsell text="Earnings by month, overtime and premiums" />
        {gap}
        <Disclaimer />
      </Screen>
    );
  }

  if (job === undefined) {
    return (
      <Screen title="Stats" scroll bottomInset footer={back}>
        <Text style={[muted, { marginBottom: spacing.lg }]}>
          No job set up yet. Add one to see your stats.
        </Text>
        <Disclaimer />
      </Screen>
    );
  }

  return (
    <Screen title="Stats" scroll bottomInset footer={back}>
      <View style={[styles.chips, { gap: spacing.sm, marginBottom: spacing.lg }]}>
        {RANGES.map((r) => (
          <Chip
            key={r.key}
            label={r.label}
            tone="neutral"
            selected={range === r.key}
            onPress={() => setRange(r.key)}
          />
        ))}
      </View>

      {stats === null ? (
        <Text style={[muted, { marginBottom: spacing.lg }]}>Loading stats…</Text>
      ) : !stats.hasData ? (
        <Text testID="stats-empty" style={[muted, { marginBottom: spacing.lg }]}>
          {EMPTY_MESSAGE}
        </Text>
      ) : (
        <>
          <Card title="Totals">
            <BigNumber
              pence={stats.totals.grossPence}
              caption={`Earned, ${monthName(from)} – ${monthName(to)}`}
            />
            <View style={{ height: spacing.sm }} />
            <TotalRow
              testID="total-ot-hours"
              label="Overtime hours"
              value={formatHours(stats.totals.overtimeHours)}
            />
            <TotalRow
              testID="total-ot-pay"
              label="Overtime pay"
              value={formatPence(stats.totals.overtimePence)}
            />
            <TotalRow
              testID="total-premiums"
              label="Premiums"
              value={formatPence(stats.totals.premiumPence)}
            />
          </Card>
          {gap}
          <Card title="Earnings by month">
            <BarChart
              testID="earnings-chart"
              bars={monthBars(
                stats.months,
                (m) => m.grossPence,
                (m) => formatPence(m.grossPence),
              )}
            />
          </Card>
          {gap}
          <Card title="Overtime hours by month">
            <BarChart
              testID="overtime-chart"
              bars={monthBars(
                stats.months,
                (m) => m.overtimeHours,
                (m) => formatHours(m.overtimeHours),
              )}
            />
          </Card>
          {gap}
          <Card title="Premiums by rule">
            {stats.totals.byRule.length === 0 ? (
              <Text style={muted}>No premiums or overtime in this range.</Text>
            ) : (
              stats.totals.byRule.map((r) => (
                <View
                  key={r.ruleId}
                  testID="rule-row"
                  accessible
                  accessibilityLabel={`${r.ruleName}, ${formatHours(r.hours)}, ${formatPence(r.pence)}`}
                  style={[
                    styles.row,
                    styles.divider,
                    { paddingVertical: spacing.sm, borderBottomColor: colors.line },
                  ]}
                >
                  <View style={styles.grow}>
                    <Text style={[typography.bodyMedium, { color: colors.ink }]}>{r.ruleName}</Text>
                    <Text style={[typography.caption, styles.nums, { color: colors.inkMuted }]}>
                      {formatHours(r.hours)}
                    </Text>
                  </View>
                  <Text style={[typography.bodyMedium, styles.nums, { color: colors.ink }]}>
                    {formatPence(r.pence)}
                  </Text>
                </View>
              ))
            )}
          </Card>
          {gap}
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
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
});
