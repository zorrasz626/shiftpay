/**
 * Reminder settings: shift reminders on/off and how long before a shift they
 * fire. Edits are local until Save, which writes both settings; the reminder
 * sync then reschedules. Turning reminders on asks for notification
 * permission; if it is refused, a note links to the app's system settings.
 */
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Linking, StyleSheet, Switch, Text, View } from 'react-native';

import { Button } from '../../src/components/Button';
import { Chip } from '../../src/components/Chip';
import { Disclaimer } from '../../src/components/Disclaimer';
import { Screen } from '../../src/components/Screen';
import { db } from '../../src/db/client';
import {
  REMINDER_LEAD_KEY,
  REMINDER_LEAD_OPTIONS,
  REMINDERS_ENABLED_KEY,
  formatLeadMinutes,
  reminderSettings,
} from '../../src/engine/reminders';
import { expoNotifier, notificationsAllowed } from '../../src/services/notifier';
import { useSettingsStore } from '../../src/store/settingsStore';
import { useTheme } from '../../src/theme/useTheme';

const PERMISSION_DENIED_MESSAGE =
  "Notifications are turned off for ShiftPay, so reminders can't be shown.";

export default function ReminderSettingsScreen() {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const setSetting = useSettingsStore((s) => s.set);

  const [form, setForm] = useState(() => reminderSettings(useSettingsStore.getState().values));
  // null until the first read; only "false" shows the note.
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Read (never ask) on open and whenever the user comes back, e.g. from system settings.
  useEffect(() => {
    let active = true;
    const read = () => {
      void notificationsAllowed().then((ok) => {
        if (active) setAllowed(ok);
      });
    };
    read();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') read();
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  async function onToggle(enabled: boolean) {
    setForm((f) => ({ ...f, enabled }));
    if (enabled) setAllowed(await expoNotifier.ensurePermission());
  }

  async function onSave() {
    setSaving(true);
    setSaveError(null);
    try {
      await setSetting(db, REMINDERS_ENABLED_KEY, form.enabled);
      await setSetting(db, REMINDER_LEAD_KEY, form.leadMinutes);
      router.back();
    } catch {
      setSaveError("Your changes couldn't be saved. Try again.");
      setSaving(false);
    }
  }

  return (
    <Screen
      title="Shift reminders"
      scroll
      bottomInset
      footer={
        <View style={[styles.row, { gap: spacing.md }]}>
          <View style={styles.fill}>
            <Button label="Back" variant="secondary" onPress={() => router.back()} />
          </View>
          <View style={styles.fill}>
            <Button label="Save" disabled={saving} onPress={onSave} />
          </View>
        </View>
      }
    >
      <View style={[styles.row, styles.switchRow, { marginBottom: spacing.lg }]}>
        <Text style={[typography.body, styles.fill, { color: colors.ink }]}>
          Remind me before shifts
        </Text>
        <Switch
          accessibilityLabel="Shift reminders"
          value={form.enabled}
          onValueChange={(v) => void onToggle(v)}
          trackColor={{ false: colors.line, true: colors.positive }}
        />
      </View>

      {form.enabled && allowed === false && (
        <View style={{ marginBottom: spacing.xl }}>
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.body, { color: colors.alert, marginBottom: spacing.sm }]}
          >
            {PERMISSION_DENIED_MESSAGE}
          </Text>
          <Button
            label="Open app settings"
            variant="secondary"
            onPress={() => {
              Linking.openSettings().catch((e: unknown) => {
                console.warn('Opening app settings failed.', e);
              });
            }}
          />
        </View>
      )}

      {form.enabled && (
        <>
          <Text style={[typography.body, { color: colors.ink, marginBottom: spacing.sm }]}>
            How long before a shift?
          </Text>
          <View style={[styles.wrap, { gap: spacing.md, marginBottom: spacing.xl }]}>
            {REMINDER_LEAD_OPTIONS.map((minutes) => (
              <Chip
                key={minutes}
                label={formatLeadMinutes(minutes)}
                tone="neutral"
                selected={form.leadMinutes === minutes}
                onPress={() => setForm((f) => ({ ...f, leadMinutes: minutes }))}
              />
            ))}
          </View>
        </>
      )}

      {saveError !== null && (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.body, { color: colors.alert, marginBottom: spacing.lg }]}
        >
          {saveError}
        </Text>
      )}
      <Disclaimer />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  switchRow: { alignItems: 'center', minHeight: 48 },
  fill: { flex: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
