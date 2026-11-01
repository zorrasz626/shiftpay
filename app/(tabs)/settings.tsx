/**
 * Settings tab: the job (name and base rate, opens Job settings), the pay
 * rules (opens the rule list), the rota (opens the rota editor), holiday
 * (opens Holiday settings), shift reminders (opens Reminder settings), backup
 * export (share sheet) and import (file picker), and the disclaimer. Free tier
 * = one job, one rota pattern.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Disclaimer } from '../../src/components/Disclaimer';
import { Screen } from '../../src/components/Screen';
import type { Backup } from '../../src/db/backup';
import type { BackupRejectReason } from '../../src/db/backupImport';
import { db } from '../../src/db/client';
import { formatPence } from '../../src/engine/money';
import { formatLeadMinutes, reminderSettings } from '../../src/engine/reminders';
import type { Job, RotaPattern } from '../../src/engine/types';
import { formatBackupDate, restoreBackup } from '../../src/services/backupRestore';
import { exportBackupToShare } from '../../src/services/backupShare';
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

export const BACKUP_UNAVAILABLE_MESSAGE = "Sharing isn't available on this device.";
export const BACKUP_FAILED_MESSAGE = "The backup couldn't be exported. Try again.";
export const RESTORE_CONFIRM_TITLE = 'Replace all your data?';
export const RESTORE_DONE_MESSAGE = 'Backup restored.';
export const RESTORE_FAILED_MESSAGE = "The backup couldn't be restored. Try again.";
export const RESTORE_REJECT_MESSAGES: Record<BackupRejectReason, string> = {
  'not-shiftpay': "This file isn't a ShiftPay backup.",
  'newer-format': 'This backup was made by a newer version of ShiftPay. Update the app and try again.',
  'newer-schema': 'This backup was made by a newer version of ShiftPay. Update the app and try again.',
  invalid: 'This backup file is damaged or incomplete.',
  'older-schema': "This backup uses an older format that isn't supported yet.",
};

/** "The backup from 1 Nov 2026 will replace everything in the app. ..." */
export function restoreConfirmBody(backup: Backup): string {
  return (
    `The backup from ${formatBackupDate(backup.exportedAt)} will replace everything ` +
    "in the app. This can't be undone."
  );
}

/** Asks before replacing everything; Cancel or dismissing the dialog resolves false. */
function confirmReplace(backup: Backup): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      RESTORE_CONFIRM_TITLE,
      restoreConfirmBody(backup),
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Replace', style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

type BackupMessage = { text: string; tone: 'positive' | 'alert' };

/**
 * Backup card: "Export backup" writes the JSON file and opens the share sheet;
 * "Import backup" picks a file, confirms and replaces all data with it.
 */
function BackupCard() {
  const { colors, typography, spacing } = useTheme();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<BackupMessage | null>(null);

  async function onExport() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await exportBackupToShare(db, new Date().toISOString());
      if (result.status === 'unavailable') {
        setMessage({ text: BACKUP_UNAVAILABLE_MESSAGE, tone: 'alert' });
      }
    } catch (e) {
      console.warn('Backup export failed.', e);
      setMessage({ text: BACKUP_FAILED_MESSAGE, tone: 'alert' });
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await restoreBackup(db, new Date().toISOString(), confirmReplace);
      if (result === 'restored') setMessage({ text: RESTORE_DONE_MESSAGE, tone: 'positive' });
      else if (result !== 'cancelled') {
        setMessage({ text: RESTORE_REJECT_MESSAGES[result], tone: 'alert' });
      }
    } catch (e) {
      console.warn('Backup import failed.', e);
      setMessage({ text: RESTORE_FAILED_MESSAGE, tone: 'alert' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Backup">
      <Text style={[typography.body, { color: colors.inkMuted, marginBottom: spacing.sm }]}>
        Save a copy of all your data
      </Text>
      <Button
        label="Export backup"
        variant="secondary"
        disabled={busy}
        onPress={() => void onExport()}
      />
      <View style={{ height: spacing.sm }} />
      <Button
        label="Import backup"
        variant="secondary"
        disabled={busy}
        onPress={() => void onImport()}
      />
      {message !== null && (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.body, { color: colors[message.tone], marginTop: spacing.sm }]}
        >
          {message.text}
        </Text>
      )}
    </Card>
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

      <BackupCard />
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
