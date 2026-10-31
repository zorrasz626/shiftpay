/**
 * Settings tab: the job (name and base rate, opens Job settings), the pay
 * rules (opens the rule list), the rota (opens the rota editor), holiday
 * (opens Holiday settings), shift reminders (opens Reminder settings) and the
 * disclaimer. Free tier = one job, one rota pattern.
 */
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '../../src/components/Card';
import { Disclaimer } from '../../src/components/Disclaimer';
import { Screen } from '../../src/components/Screen';
import { formatPence } from '../../src/engine/money';
import { formatLeadMinutes, reminderSettings } from '../../src/engine/reminders';
import type { Job, RotaPattern } from '../../src/engine/types';
import { useJobsStore } from '../../src/store/jobsStore';
import { useRotaStore } from '../../src/store/rotaStore';
import { useRulesStore } from '../../src/store/rulesStore';
import { useSettingsStore } from '../../src/store/settingsStore';
import { tabularNums } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/useTheme';

/** "No pay rules yet", "1 pay rule", "3 pay rules". */
function payRulesLabel(count: number): string {
  if (count === 0) return 'No pay rules yet';
  return count === 1 ? '1 pay rule' : `${count} pay rules`;
}

/** "4 on 4 off · 8-day cycle", or "No rota yet". */
function rotaLabel(pattern: RotaPattern | undefined): string {
  if (pattern === undefined) return 'No rota yet';
  const on = pattern.days.filter((d) => d !== 'OFF').length;
  const off = pattern.days.length - on;
  const cycle = `${pattern.days.length}-day cycle`;
  // "N on M off" only for one block on and one block off (counting wrap-around);
  // a 2-2-3 rota is not "7 on 7 off".
  const changes = pattern.days.filter(
    (d, i, all) => (d === 'OFF') !== (all[(i + 1) % all.length] === 'OFF'),
  ).length;
  if (changes <= 2) return `${on} on ${off} off · ${cycle}`;
  return `${on} ${on === 1 ? 'shift' : 'shifts'} · ${cycle}`;
}

/** "210 h a year", or "Accrual (12.07%)". */
function holidayLabel(job: Job): string {
  return job.holidayMode === 'accrual'
    ? 'Accrual (12.07%)'
    : `${job.holidayEntitlementHours} h a year`;
}

/** "On · 1 h before", or "Off". */
function remindersLabel(values: Record<string, unknown>): string {
  const { enabled, leadMinutes } = reminderSettings(values);
  return enabled ? `On · ${formatLeadMinutes(leadMinutes)} before` : 'Off';
}

/** A tappable settings row, at least 48dp tall. */
function SettingsRow({
  label,
  detail,
  onPress,
}: {
  label: string;
  detail: string;
  onPress: () => void;
}) {
  const { colors, typography, spacing } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${detail}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { paddingVertical: spacing.sm },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[typography.body, styles.nums, { color: colors.ink }]}>{label}</Text>
      <Text style={[typography.caption, styles.nums, { color: colors.inkMuted }]}>{detail}</Text>
    </Pressable>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const job = useJobsStore((s) => s.jobs[0]);
  const rules = useRulesStore((s) => s.rules);
  const ruleCount = job === undefined ? 0 : rules.filter((r) => r.jobId === job.id).length;
  const pattern = useRotaStore((s) =>
    job === undefined ? undefined : s.patterns.find((p) => p.jobId === job.id),
  );
  const settingsValues = useSettingsStore((s) => s.values);
  const gap = { height: spacing.lg };

  return (
    <Screen title="Settings" scroll>
      <Card title="Job">
        {job === undefined ? (
          <Text style={[typography.body, { color: colors.inkMuted }]}>No job set up yet.</Text>
        ) : (
          <SettingsRow
            label={job.name}
            detail={`${formatPence(job.baseRatePence)}/h`}
            onPress={() => router.push({ pathname: '/settings/job' })}
          />
        )}
      </Card>
      <View style={gap} />

      {job !== undefined && (
        <>
          <Card title="Pay rules">
            <SettingsRow
              label={payRulesLabel(ruleCount)}
              detail="Premiums and overtime"
              onPress={() => router.push({ pathname: '/settings/rules' })}
            />
          </Card>
          <View style={gap} />
          <Card title="Rota">
            <SettingsRow
              label={rotaLabel(pattern)}
              detail="Shift types and cycle"
              onPress={() => router.push({ pathname: '/settings/rota' })}
            />
          </Card>
          <View style={gap} />
          <Card title="Holiday">
            <SettingsRow
              label="Holiday settings"
              detail={holidayLabel(job)}
              onPress={() => router.push({ pathname: '/settings/holiday' })}
            />
          </Card>
          <View style={gap} />
        </>
      )}

      <Card title="Reminders">
        <SettingsRow
          label="Shift reminders"
          detail={remindersLabel(settingsValues)}
          onPress={() => router.push({ pathname: '/settings/reminders' })}
        />
      </Card>
      <View style={gap} />

      <Card title="About">
        <SettingsRow
          label="About ShiftPay"
          detail="Disclaimer, version and privacy policy"
          onPress={() => router.push({ pathname: '/settings/about' })}
        />
      </Card>
      <View style={gap} />

      <Disclaimer />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 48, justifyContent: 'center' },
  nums: { fontVariant: [...tabularNums] },
  pressed: { opacity: 0.8 },
});
