import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { bankHolidays } from '../../src/config/bankHolidays';
import { BigNumber } from '../../src/components/BigNumber';
import { Card } from '../../src/components/Card';
import { Disclaimer } from '../../src/components/Disclaimer';
import { Screen } from '../../src/components/Screen';
import { formatHolidayHours, holidayView } from '../../src/engine/holidayView';
import { homeSummary } from '../../src/engine/homeSummary';
import type { Job } from '../../src/engine/types';
import { useHolidaySummary } from '../../src/features/holiday/useHolidaySummary';
import { homeView } from '../../src/features/home/homeView';
import { useJobsStore } from '../../src/store/jobsStore';
import { useRulesStore } from '../../src/store/rulesStore';
import { useShiftsStore } from '../../src/store/shiftsStore';
import { tabularNums } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/useTheme';

const REFRESH_MS = 60_000;

/** "Now" as an ISO instant, refreshed every minute and when the app returns to the foreground. */
function useNow(): string {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const refresh = () => setNow(new Date().toISOString());
    const timer = setInterval(refresh, REFRESH_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);
  return now;
}

/** Remaining holiday and taken / booked hours; opens the Holiday screen. */
function HolidayCard({ job }: { job: Job }) {
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const summary = useHolidaySummary(job);
  if (summary === null) return null;

  const view = holidayView(summary, job.holidayMode);
  const usage = `Taken ${formatHolidayHours(summary.taken)} · Booked ${formatHolidayHours(summary.booked)}`;
  return (
    <>
      <Pressable
        testID="holiday-card"
        accessibilityRole="button"
        accessibilityLabel={`Holiday: ${view.remainingLabel}. ${usage}`}
        onPress={() => router.push({ pathname: '/holiday' })}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <Card title="Holiday">
          <Text style={[typography.bodyLarge, styles.nums, { color: colors.ink }]}>
            {view.remainingLabel}
          </Text>
          <Text
            style={[typography.body, styles.nums, { color: colors.ink, marginTop: spacing.sm }]}
          >
            {usage}
          </Text>
        </Card>
      </Pressable>
      <View style={{ height: spacing.lg }} />
    </>
  );
}

export default function HomeScreen() {
  const { colors, typography, spacing } = useTheme();
  const job = useJobsStore((s) => s.jobs[0]);
  const shifts = useShiftsStore((s) => s.shifts);
  const rules = useRulesStore((s) => s.rules);
  const now = useNow();

  const summary = useMemo(
    () => (job === undefined ? null : homeSummary({ shifts, job, rules, bankHolidays, now })),
    [job, shifts, rules, now],
  );

  if (job === undefined || summary === null) {
    return (
      <Screen title="ShiftPay">
        <Disclaimer />
      </Screen>
    );
  }

  const view = homeView(summary);
  const body = [typography.body, styles.nums, { color: colors.ink }];
  const muted = [typography.caption, styles.nums, { color: colors.inkMuted }];
  const gap = { height: spacing.lg };

  return (
    <Screen title="ShiftPay" scroll>
      <BigNumber pence={summary.earnedSoFarPence} caption="Earned so far this period" />
      <Text style={[body, { marginTop: spacing.md }]}>{view.projectedLine}</Text>
      <Text style={[muted, { marginTop: spacing.xs }]}>{view.periodLine}</Text>
      <View style={{ height: spacing.xl }} />

      <Card title="Next shift">
        {view.nextShift === null ? (
          <Text style={body}>No shifts coming up</Text>
        ) : (
          <>
            <Text style={[typography.bodyLarge, styles.nums, { color: colors.ink }]}>
              {view.nextShift.when}
            </Text>
            <Text style={[muted, { marginTop: spacing.xs }]}>{job.name}</Text>
            <Text style={[body, { marginTop: spacing.sm }]}>{`${view.nextShift.pay} expected`}</Text>
          </>
        )}
      </Card>
      <View style={gap} />

      <Card title="Pay day">
        <Text style={[typography.bodyLarge, styles.nums, { color: colors.ink }]}>
          {view.payDay.countdown}
        </Text>
        <Text style={[body, { marginTop: spacing.sm }]}>{`${view.payDay.pay} expected`}</Text>
      </Card>
      <View style={gap} />

      <HolidayCard job={job} />

      <Disclaimer />
    </Screen>
  );
}

const styles = StyleSheet.create({
  nums: { fontVariant: [...tabularNums] },
  pressed: { opacity: 0.8 },
});
