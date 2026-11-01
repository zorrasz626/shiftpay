import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { estimateNetPay } from '../engine/netPay';
import { formatPence } from '../engine/money';
import type { LocalDate, PayFrequency } from '../engine/types';
import { buildNetPayInput } from '../features/tax/netPayInput';
import type { TaxProfile } from '../features/tax/taxProfile';
import { tabularNums } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { BigNumber } from './BigNumber';
import { Button } from './Button';
import { Card } from './Card';
import { Disclaimer } from './Disclaimer';

export const NET_PAY_TITLE = 'Estimated take-home (rough estimate)';
export const ASSUMED_YEAR_TEXT = "Rates for a later year aren't in the app yet.";

export type NetPayCardProps = {
  /** Gross pay for the period, integer pence. */
  readonly grossPence: number;
  readonly frequency: PayFrequency;
  /** The period's pay date: picks the tax year. */
  readonly payDate: LocalDate;
  readonly profile: TaxProfile;
};

/** Estimated net pay (Pro): net figure, non-zero deductions, the tax year used and the disclaimer. */
export function NetPayCard({ grossPence, frequency, payDate, profile }: NetPayCardProps) {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const estimate = useMemo(
    () => estimateNetPay(buildNetPayInput({ profile, grossPence, frequency, payDate })),
    [profile, grossPence, frequency, payDate],
  );

  const rows = [
    { label: 'Income tax', pence: estimate.incomeTaxPence },
    { label: 'National Insurance', pence: estimate.niPence },
    { label: 'Student loan', pence: estimate.studentLoanPence },
    { label: 'Pension', pence: estimate.pensionPence },
  ].filter((r) => r.pence !== 0);
  const muted = [typography.caption, styles.nums, { color: colors.inkMuted }];

  return (
    <View testID="net-pay-card">
      <Card title={NET_PAY_TITLE}>
        <BigNumber pence={estimate.netPence} caption="Estimated net pay" />
        <View style={{ marginTop: spacing.sm }}>
          {rows.map((r) => (
            <View
              key={r.label}
              testID="net-pay-row"
              style={[
                styles.row,
                styles.divider,
                { paddingVertical: spacing.sm, borderBottomColor: colors.line },
              ]}
            >
              <Text style={[typography.body, styles.grow, { color: colors.ink }]}>{r.label}</Text>
              <Text
                style={[typography.bodyMedium, styles.nums, { color: colors.ink }]}
              >{`−${formatPence(r.pence)}`}</Text>
            </View>
          ))}
        </View>
        <Text style={[muted, { marginTop: spacing.sm }]}>
          {`Using ${estimate.taxYearId} tax year`}
        </Text>
        {estimate.taxYearAssumed && (
          <Text style={[muted, { marginTop: spacing.xs }]}>{ASSUMED_YEAR_TEXT}</Text>
        )}
        <View style={{ marginVertical: spacing.sm }}>
          <Button
            label="Tax settings"
            variant="quiet"
            onPress={() => router.push({ pathname: '/settings/tax' })}
          />
        </View>
        <Disclaimer />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  nums: { fontVariant: [...tabularNums] },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth },
  grow: { flex: 1 },
});
