/**
 * Settings tab: the job (name and base rate, opens Job settings), the pay
 * rules (opens the rule list) and the disclaimer. Free tier = one job.
 */
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '../../src/components/Card';
import { Disclaimer } from '../../src/components/Disclaimer';
import { Screen } from '../../src/components/Screen';
import { formatPence } from '../../src/engine/money';
import { useJobsStore } from '../../src/store/jobsStore';
import { useRulesStore } from '../../src/store/rulesStore';
import { tabularNums } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/useTheme';

/** "No pay rules yet", "1 pay rule", "3 pay rules". */
function payRulesLabel(count: number): string {
  if (count === 0) return 'No pay rules yet';
  return count === 1 ? '1 pay rule' : `${count} pay rules`;
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
        </>
      )}

      <Disclaimer />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 48, justifyContent: 'center' },
  nums: { fontVariant: [...tabularNums] },
  pressed: { opacity: 0.8 },
});
