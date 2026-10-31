/**
 * Holiday screen (SPEC §5 Holiday, screen 6): entitlement ring and
 * entitled / accrued / taken / booked / remaining for the current holiday
 * year. Booking happens on the Calendar (day sheet status Holiday).
 */
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Disclaimer } from '../src/components/Disclaimer';
import { Screen } from '../src/components/Screen';
import { formatHolidayHours, holidayView, type HolidayRow } from '../src/engine/holidayView';
import { HolidayRing } from '../src/features/holiday/HolidayRing';
import { useHolidaySummary } from '../src/features/holiday/useHolidaySummary';
import { useJobsStore } from '../src/store/jobsStore';
import { tabularNums } from '../src/theme/tokens';
import { useTheme } from '../src/theme/useTheme';

function Row({ row }: { row: HolidayRow }) {
  const { colors, typography, spacing } = useTheme();
  const strong = row.key === 'remaining';
  const text = [strong ? typography.bodyMedium : typography.body, { color: colors.ink }];
  return (
    <View
      testID={`holiday-row-${row.key}`}
      style={[
        styles.row,
        !strong && styles.divider,
        { paddingVertical: spacing.sm, borderBottomColor: colors.line },
      ]}
    >
      <Text style={[text, styles.grow]}>{row.label}</Text>
      <Text style={[text, styles.nums, styles.right, { marginLeft: spacing.sm }]}>
        {formatHolidayHours(row.hours)}
      </Text>
    </View>
  );
}

export default function HolidayScreen() {
  const { colors, typography, spacing } = useTheme();
  const router = useRouter();
  const job = useJobsStore((s) => s.jobs[0]);
  const summary = useHolidaySummary(job);

  const back = <Button label="Back" variant="secondary" onPress={() => router.back()} />;

  if (job === undefined) {
    return (
      <Screen title="Holiday" bottomInset footer={back}>
        <Text style={[typography.body, { color: colors.ink, marginBottom: spacing.lg }]}>
          Set up your job first
        </Text>
        <Disclaimer />
      </Screen>
    );
  }

  if (summary === null) {
    return (
      <Screen title="Holiday" bottomInset footer={back}>
        <Text style={[typography.body, { color: colors.inkMuted }]}>Loading…</Text>
      </Screen>
    );
  }

  const view = holidayView(summary, job.holidayMode);
  const gap = { height: spacing.lg };

  return (
    <Screen title="Holiday" scroll bottomInset footer={back}>
      <HolidayRing view={view} />
      <View style={gap} />

      <Card title={view.yearLabel}>
        <Text style={[typography.caption, { color: colors.inkMuted, marginBottom: spacing.sm }]}>
          {view.modeLabel}
        </Text>
        {view.rows.map((r) => (
          <Row key={r.key} row={r} />
        ))}
      </Card>
      <View style={gap} />

      <Button label="Book holiday" onPress={() => router.push({ pathname: '/calendar' })} />
      <View style={{ height: spacing.md }} />
      <Button
        label="Holiday settings"
        variant="secondary"
        onPress={() => router.push({ pathname: '/settings/holiday' })}
      />
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
  right: { textAlign: 'right' },
});
