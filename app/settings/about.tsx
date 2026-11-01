/**
 * About: what the app does, the full disclaimer, the app version (from the
 * app config) and a link to the privacy policy, which opens in the browser.
 */
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { DISCLAIMER } from '../../src/components/Disclaimer';
import { Screen } from '../../src/components/Screen';
import { PRIVACY_POLICY_URL } from '../../src/config/links';
import { db } from '../../src/db/client';
import {
  PRO_OVERRIDE_KEY,
  type ProOverride,
  readProOverride,
  useProStore,
} from '../../src/features/pro/proStore';
import { useSettingsStore } from '../../src/store/settingsStore';
import { tabularNums } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/useTheme';

const DESCRIPTION =
  'ShiftPay stores your rota, estimates your gross pay and helps you check your payslips. ' +
  'Your data stays on this phone.';

/** "Version 1.0.0" from the app config, or "Version unknown" if it is missing. */
function versionLabel(version: string | undefined): string {
  return version === undefined || version === '' ? 'Version unknown' : `Version ${version}`;
}

const OVERRIDE_LABELS: Record<string, string> = {
  none: 'Off (RevenueCat)',
  pro: 'Pro',
  free: 'Free',
};

/** Off → Pro → Free → Off. */
function nextOverride(current: ProOverride): ProOverride {
  return current === null ? 'pro' : current === 'pro' ? 'free' : null;
}

/** Dev builds only: force Pro or Free without RevenueCat. */
function DevProOverrideRow() {
  const { colors, typography, spacing } = useTheme();
  const override = useSettingsStore((s) => readProOverride(s.values));
  const status = useProStore((s) => s.status);

  async function cycle(): Promise<void> {
    const next = nextOverride(override);
    const settings = useSettingsStore.getState();
    if (next === null) await settings.remove(db, PRO_OVERRIDE_KEY);
    else await settings.set(db, PRO_OVERRIDE_KEY, next);
    await useProStore.getState().refresh();
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Pro (dev override)"
      onPress={() => void cycle()}
      style={({ pressed }) => [
        styles.row,
        { paddingVertical: spacing.sm },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[typography.bodyMedium, styles.text, { color: colors.ink }]}>
        Pro (dev override)
      </Text>
      <Text style={[typography.body, styles.text, { color: colors.inkMuted }]}>
        {`${OVERRIDE_LABELS[override ?? 'none']} · now ${status}`}
      </Text>
    </Pressable>
  );
}

export default function AboutScreen() {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const gap = { height: spacing.lg };

  return (
    <Screen
      title="About"
      scroll
      footer={<Button label="Back" variant="secondary" onPress={() => router.back()} />}
    >
      <Card>
        <Text style={[typography.body, styles.text, { color: colors.ink }]}>{DESCRIPTION}</Text>
      </Card>
      <View style={gap} />

      <Card title="Disclaimer">
        <Text style={[typography.body, styles.text, { color: colors.ink }]}>{DISCLAIMER}</Text>
      </Card>
      <View style={gap} />

      <Card>
        <Text style={[typography.body, styles.text, { color: colors.inkMuted }]}>
          {versionLabel(Constants.expoConfig?.version)}
        </Text>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Privacy policy"
          onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
          style={({ pressed }) => [
            styles.row,
            { paddingVertical: spacing.sm },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[typography.bodyMedium, styles.text, { color: colors.ink }]}>
            Privacy policy
          </Text>
        </Pressable>
        {__DEV__ ? <DevProOverrideRow /> : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  text: { textAlign: 'left', fontVariant: [...tabularNums] },
  row: { minHeight: 48, justifyContent: 'center' },
  pressed: { opacity: 0.8 },
});
