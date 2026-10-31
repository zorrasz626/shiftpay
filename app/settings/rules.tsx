/**
 * Pay rules: the job's premiums and overtime rules, each with a plain summary.
 * Tap a rule to edit it; "Add premium" / "Add overtime rule" asks for the kind
 * of rule, then opens the editor for a new one.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Disclaimer } from '../../src/components/Disclaimer';
import { Screen } from '../../src/components/Screen';
import { formatPence } from '../../src/engine/money';
import type { DayOfWeek, PremiumRule, PremiumRuleType } from '../../src/engine/types';
import { useJobsStore } from '../../src/store/jobsStore';
import { useRulesStore } from '../../src/store/rulesStore';
import { tabularNums } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/useTheme';

/** Monday first, as UK rotas are usually written. */
export const WEEK: [DayOfWeek, string][] = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [0, 'Sun'],
];

const DAY_PLURALS: Record<DayOfWeek, string> = {
  0: 'Sundays',
  1: 'Mondays',
  2: 'Tuesdays',
  3: 'Wednesdays',
  4: 'Thursdays',
  5: 'Fridays',
  6: 'Saturdays',
};

export const PREMIUM_TYPES: [PremiumRuleType, string][] = [
  ['time_band', 'Time of day'],
  ['day_of_week', 'Day of the week'],
  ['bank_holiday', 'Bank holidays'],
];

export const OVERTIME_TYPES: [PremiumRuleType, string][] = [
  ['overtime_daily', 'Hours in a day'],
  ['overtime_weekly', 'Hours in a week'],
  ['overtime_period', 'Hours in a pay period'],
];

function isOvertime(rule: PremiumRule): boolean {
  return OVERTIME_TYPES.some(([type]) => type === rule.type);
}

/** "×1.25 · 22:00–06:00", "+£1.50/h · Sundays", "×1.5 after 39 h a week". */
export function ruleSummary(rule: PremiumRule): string {
  const rate =
    rule.multiplier !== undefined
      ? `×${rule.multiplier}`
      : `+${formatPence(rule.flatAddPencePerHour)}/h`;
  switch (rule.type) {
    case 'time_band':
      return rule.startTime === rule.endTime
        ? `${rate} · all day`
        : `${rate} · ${rule.startTime}–${rule.endTime}`;
    case 'day_of_week': {
      const days = WEEK.filter(([d]) => rule.daysOfWeek.includes(d));
      const first = days[0];
      const label =
        days.length === 1 && first !== undefined
          ? DAY_PLURALS[first[0]]
          : days.map(([, short]) => short).join(', ');
      return `${rate} · ${label}`;
    }
    case 'bank_holiday':
      return `${rate} · bank holidays`;
    case 'overtime_daily':
      return `${rate} after ${rule.thresholdHours} h a day`;
    case 'overtime_weekly':
      return `${rate} after ${rule.thresholdHours} h a week`;
    case 'overtime_period':
      return `${rate} after ${rule.thresholdHours} h a pay period`;
  }
}

function RuleRow({ rule, onPress }: { rule: PremiumRule; onPress: () => void }) {
  const { colors, typography, spacing } = useTheme();
  const summary = ruleSummary(rule);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${rule.name}, ${summary}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { paddingVertical: spacing.sm },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[typography.body, styles.nums, { color: colors.ink }]}>{rule.name}</Text>
      <Text style={[typography.caption, styles.nums, { color: colors.inkMuted }]}>{summary}</Text>
    </Pressable>
  );
}

function RuleGroup({
  title,
  rules,
  empty,
  addLabel,
  types,
}: {
  title: string;
  rules: PremiumRule[];
  empty: string;
  addLabel: string;
  types: [PremiumRuleType, string][];
}) {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const [picking, setPicking] = useState(false);

  return (
    <Card title={title}>
      {rules.length === 0 && (
        <Text style={[typography.body, { color: colors.inkMuted, marginBottom: spacing.sm }]}>
          {empty}
        </Text>
      )}
      {rules.map((rule) => (
        <RuleRow
          key={rule.id}
          rule={rule}
          onPress={() => router.push({ pathname: '/settings/rule/[id]', params: { id: rule.id } })}
        />
      ))}
      <View style={{ height: spacing.sm }} />
      {picking ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={[typography.body, { color: colors.ink }]}>What does it depend on?</Text>
          {types.map(([type, label]) => (
            <Button
              key={type}
              label={label}
              variant="secondary"
              onPress={() => {
                setPicking(false);
                router.push({ pathname: '/settings/rule/[id]', params: { id: 'new', type } });
              }}
            />
          ))}
          <Button label="Cancel" variant="quiet" onPress={() => setPicking(false)} />
        </View>
      ) : (
        <Button label={addLabel} variant="secondary" onPress={() => setPicking(true)} />
      )}
    </Card>
  );
}

export default function PayRulesScreen() {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const job = useJobsStore((s) => s.jobs[0]);
  const allRules = useRulesStore((s) => s.rules);
  const back = <Button label="Back" variant="secondary" onPress={() => router.back()} />;

  if (job === undefined) {
    return (
      <Screen title="Pay rules" bottomInset footer={back}>
        <Text style={[typography.body, { color: colors.ink, marginBottom: spacing.lg }]}>
          No job set up yet.
        </Text>
        <Disclaimer />
      </Screen>
    );
  }

  const rules = allRules.filter((r) => r.jobId === job.id);
  return (
    <Screen title="Pay rules" scroll bottomInset footer={back}>
      <RuleGroup
        title="Premiums"
        rules={rules.filter((r) => !isOvertime(r))}
        empty="No premiums yet."
        addLabel="Add premium"
        types={PREMIUM_TYPES}
      />
      <View style={{ height: spacing.lg }} />
      <RuleGroup
        title="Overtime"
        rules={rules.filter(isOvertime)}
        empty="No overtime rules yet."
        addLabel="Add overtime rule"
        types={OVERTIME_TYPES}
      />
      <View style={{ height: spacing.lg }} />
      <Disclaimer />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 48, justifyContent: 'center' },
  nums: { fontVariant: [...tabularNums] },
  pressed: { opacity: 0.8 },
});
