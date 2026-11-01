/**
 * Payslip check result card (SPEC §6): Expected vs Paid, the £ and hours
 * difference, the status chip and the likely causes. Renders a view model
 * built by `payslipCheck()`; formats only.
 */
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '../../components/Card';
import { Chip } from '../../components/Chip';
import { formatPence, formatSignedPence } from '../../engine/money';
import type { PayslipCheckView } from '../../engine/payslipCheck';
import { tabularNums } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { formatHours, formatSignedHours } from './payView';

function Row({ label, value, testID }: { label: string; value: string; testID: string }) {
  const { colors, typography, spacing } = useTheme();
  return (
    <View
      testID={testID}
      style={[
        styles.row,
        styles.divider,
        { paddingVertical: spacing.sm, borderBottomColor: colors.line },
      ]}
    >
      <Text style={[typography.body, styles.grow, { color: colors.ink }]}>{label}</Text>
      <Text
        style={[
          typography.bodyMedium,
          styles.nums,
          styles.value,
          { color: colors.ink, marginLeft: spacing.sm },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

export function PayslipCheckCard({ check }: { check: PayslipCheckView }) {
  const { colors, typography, spacing } = useTheme();
  const hasHours = check.paidHours !== undefined && check.diffHours !== undefined;

  return (
    <View testID="payslip-check">
      <Card title="Payslip check">
        <View style={[styles.chipRow, { marginBottom: spacing.sm }]}>
          <Chip label={check.chipLabel} tone={check.chipTone} />
        </View>
        <Row label="Expected" value={formatPence(check.expectedPence)} testID="check-expected" />
        <Row label="Paid" value={formatPence(check.paidPence)} testID="check-paid" />
        <Row
          label="Difference"
          value={formatSignedPence(check.diffPence)}
          testID="check-difference"
        />
        {hasHours && (
          <>
            <Row
              label="Expected hours"
              value={formatHours(check.expectedHours)}
              testID="check-expected-hours"
            />
            <Row
              label="Paid hours"
              value={formatHours(check.paidHours as number)}
              testID="check-paid-hours"
            />
            <Row
              label="Hours difference"
              value={formatSignedHours(check.diffHours as number)}
              testID="check-hours-difference"
            />
          </>
        )}
        {check.causes.length > 0 && (
          <View testID="check-causes" style={{ marginTop: spacing.md }}>
            <Text style={[typography.bodyMedium, { color: colors.ink, marginBottom: spacing.xs }]}>
              Likely causes
            </Text>
            {check.causes.map((cause) => (
              <View key={cause} style={[styles.bullet, { marginTop: spacing.xs }]}>
                <Text style={[typography.body, { color: colors.ink, marginRight: spacing.sm }]}>
                  •
                </Text>
                <Text style={[typography.body, styles.grow, { color: colors.ink }]}>{cause}</Text>
              </View>
            ))}
          </View>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  nums: { fontVariant: [...tabularNums] },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth },
  grow: { flex: 1 },
  value: { textAlign: 'right' },
  chipRow: { flexDirection: 'row' },
  bullet: { flexDirection: 'row', alignItems: 'flex-start' },
});
