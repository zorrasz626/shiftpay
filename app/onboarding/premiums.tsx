import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../../src/components/Button';
import { Chip } from '../../src/components/Chip';
import { Disclaimer } from '../../src/components/Disclaimer';
import { Screen } from '../../src/components/Screen';
import { db } from '../../src/db/client';
import { PREMIUM_PRESETS, type PremiumPresetId } from '../../src/engine/presets';
import { instantToLocal } from '../../src/engine/time';
import { canAddRule } from '../../src/features/pro/gates';
import { useEntitlement } from '../../src/features/pro/useEntitlement';
import type { BankHolidayRegion, OvertimePremiumMode } from '../../src/engine/types';
import { useOnboardingStore } from '../../src/store/onboardingStore';
import { useTheme } from '../../src/theme/useTheme';

/** D1 choices, each with a one-line explanation. */
const OVERTIME_MODES: [OvertimePremiumMode, string, string][] = [
  ['highest', 'Use the higher rate', 'Overtime on a premium hour pays whichever rate is higher.'],
  ['replace', 'Overtime rate only', 'Overtime on a premium hour pays the overtime rate only.'],
  [
    'stack',
    'Add them together',
    'Both extras are added, e.g. 1.5 + 0.25 = 1.75 times your base rate.',
  ],
];

const REGIONS: [BankHolidayRegion, string][] = [
  ['england-and-wales', 'England and Wales'],
  ['scotland', 'Scotland'],
  ['northern-ireland', 'Northern Ireland'],
];

/** Onboarding step 4: premium presets, overtime on a premium hour (D1), bank-holiday region (D5). */
export default function OnboardingPremiumsScreen() {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const draft = useOnboardingStore();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { isPro } = useEntitlement();
  const [limitHint, setLimitHint] = useState(false);

  /** Each preset is one rule: a free user can pick up to the free rule limit. */
  function onTogglePreset(id: PremiumPresetId) {
    const selected = draft.premiums.includes(id);
    if (!selected && !canAddRule(draft.premiums.length, isPro)) {
      setLimitHint(true);
      return;
    }
    setLimitHint(false);
    draft.togglePremium(id);
  }

  async function onFinish() {
    setSaving(true);
    setSaveError(null);
    try {
      const today = instantToLocal(new Date().toISOString()).date;
      await draft.finishOnboarding(db, today);
      router.replace('/(tabs)');
    } catch {
      setSaveError("Your setup couldn't be saved. Check the earlier steps and try again.");
      setSaving(false);
    }
  }

  return (
    <Screen
      title="Extra pay"
      scroll
      bottomInset
      footer={
        <View style={[styles.row, { gap: spacing.md }]}>
          <View style={styles.fill}>
            <Button label="Back" variant="secondary" onPress={() => router.back()} />
          </View>
          <View style={styles.fill}>
            <Button label="Finish" disabled={saving} onPress={onFinish} />
          </View>
        </View>
      }
    >
      <Text style={[typography.caption, { color: colors.inkMuted, marginBottom: spacing.lg }]}>
        Step 4 of 4
      </Text>

      <Text style={[typography.body, { color: colors.ink, marginBottom: spacing.sm }]}>
        Do you get paid extra for any of these?
      </Text>
      <View style={[styles.wrap, { gap: spacing.md, marginBottom: spacing.sm }]}>
        {PREMIUM_PRESETS.map(({ id, label }) => (
          <Chip
            key={id}
            label={label}
            tone="neutral"
            selected={draft.premiums.includes(id)}
            onPress={() => onTogglePreset(id)}
          />
        ))}
      </View>
      {limitHint && (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.caption, { color: colors.ink, marginBottom: spacing.sm }]}
        >
          More rules with Pro after setup
        </Text>
      )}
      <Text style={[typography.caption, { color: colors.inkMuted, marginBottom: spacing.xl }]}>
        Optional — you can change these later in Settings
      </Text>

      <Text style={[typography.body, { color: colors.ink, marginBottom: spacing.sm }]}>
        Overtime on a premium hour
      </Text>
      <View style={{ gap: spacing.md, marginBottom: spacing.xl }}>
        {OVERTIME_MODES.map(([mode, label, explanation]) => (
          <View key={mode} style={[styles.row, styles.center, { gap: spacing.md }]}>
            <Chip
              label={label}
              tone="neutral"
              selected={draft.overtimePremiumMode === mode}
              onPress={() => draft.setOvertimePremiumMode(mode)}
            />
            <Text style={[typography.caption, styles.fill, { color: colors.inkMuted }]}>
              {explanation}
            </Text>
          </View>
        ))}
      </View>

      <Text style={[typography.body, { color: colors.ink, marginBottom: spacing.sm }]}>
        Which bank holidays apply to you?
      </Text>
      <View style={[styles.wrap, { gap: spacing.md, marginBottom: spacing.xl }]}>
        {REGIONS.map(([region, label]) => (
          <Chip
            key={region}
            label={label}
            tone="neutral"
            selected={draft.bankHolidayRegion === region}
            onPress={() => draft.setBankHolidayRegion(region)}
          />
        ))}
      </View>

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
  center: { alignItems: 'center' },
  fill: { flex: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
