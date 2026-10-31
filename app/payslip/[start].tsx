/**
 * Payslip entry (SPEC §6): enter, edit or delete the payslip for one pay
 * period. Reached from the period detail; the route param is the period's
 * start date. Edits are local until Save, which replaces the whole payslip;
 * Back discards them. Delete asks for confirmation first.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Disclaimer } from '../../src/components/Disclaimer';
import { Screen } from '../../src/components/Screen';
import { TextField } from '../../src/components/TextField';
import { db } from '../../src/db/client';
import { formatPence, parsePoundsToPence } from '../../src/engine/money';
import { periodContaining } from '../../src/engine/payPeriods';
import {
  type PayslipFormField,
  type PayslipFormValues,
  type PayslipLineFormValues,
  formToPayslip,
  linesTotalPence,
  newPayslipForm,
  payslipFormErrors,
  payslipToForm,
  suggestedNetPence,
} from '../../src/engine/payslipForm';
import type { LocalDate } from '../../src/engine/types';
import { periodRangeLabel } from '../../src/features/pay/payView';
import { useJobsStore } from '../../src/store/jobsStore';
import { newId } from '../../src/store/onboardingStore';
import { payslipForPeriod, usePayslipsStore } from '../../src/store/payslipsStore';
import { useShiftsStore } from '../../src/store/shiftsStore';
import { tabularNums } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/useTheme';

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

type TopField = Exclude<PayslipFormField, 'lineLabel' | 'lineHours' | 'lineAmount'>;
type TopTextKey = Exclude<keyof PayslipFormValues, 'lines'>;

const TEXT_KEY: Record<TopField, TopTextKey> = {
  gross: 'grossText',
  hours: 'hoursText',
  tax: 'taxText',
  ni: 'niText',
  pension: 'pensionText',
  net: 'netText',
};

const LINE_TEXT_KEY: Record<
  'lineLabel' | 'lineHours' | 'lineAmount',
  keyof PayslipLineFormValues
> = {
  lineLabel: 'label',
  lineHours: 'hoursText',
  lineAmount: 'amountText',
};

const EMPTY_LINE: PayslipLineFormValues = { label: '', hoursText: '', amountText: '' };

function PayslipForm({
  initial,
  payslipId,
  jobId,
  period,
  isNew,
}: {
  initial: PayslipFormValues;
  payslipId: string;
  jobId: string;
  period: { start: LocalDate; end: LocalDate };
  isNew: boolean;
}) {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const savePayslip = usePayslipsStore((s) => s.savePayslip);
  const removePayslip = usePayslipsStore((s) => s.removePayslip);

  const [values, setValues] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const errors = payslipFormErrors(values);
  // Errors show once Save was tried, or once the field itself has text.
  const errorFor = (field: TopField) => {
    if (!submitted && values[TEXT_KEY[field]] === '') return undefined;
    return errors.find((e) => e.field === field)?.message;
  };
  const lineErrorFor = (field: 'lineLabel' | 'lineHours' | 'lineAmount', index: number) => {
    const line = values.lines[index] as PayslipLineFormValues;
    if (!submitted && line[LINE_TEXT_KEY[field]] === '') return undefined;
    return errors.find((e) => e.field === field && e.lineIndex === index)?.message;
  };

  const set = (patch: Partial<PayslipFormValues>) => setValues((v) => ({ ...v, ...patch }));
  const setLine = (index: number, patch: Partial<PayslipLineFormValues>) =>
    setValues((v) => ({
      ...v,
      lines: v.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));
  const addLine = () => setValues((v) => ({ ...v, lines: [...v.lines, { ...EMPTY_LINE }] }));
  const removeLine = (index: number) =>
    setValues((v) => ({ ...v, lines: v.lines.filter((_, i) => i !== index) }));

  async function run(action: () => Promise<void>, failure: string) {
    setBusy(true);
    setSaveError(null);
    try {
      await action();
      router.back();
    } catch {
      setSaveError(failure);
      setBusy(false);
    }
  }

  const onSave = () => {
    setSubmitted(true);
    if (errors.length > 0) return;
    void run(
      () =>
        savePayslip(
          db,
          formToPayslip(values, {
            id: payslipId,
            jobId,
            periodStart: period.start,
            periodEnd: period.end,
          }),
        ),
      "Your payslip couldn't be saved. Try again.",
    );
  };
  const onDelete = () =>
    run(() => removePayslip(db, payslipId), "The payslip couldn't be deleted. Try again.");

  const linesTotal = linesTotalPence(values);
  const gross = parsePoundsToPence(values.grossText);
  const linesHint =
    linesTotal === null
      ? null
      : gross !== null && gross >= 0 && gross !== linesTotal
        ? `Lines add up to ${formatPence(linesTotal)}, gross is ${formatPence(gross)}`
        : `Lines add up to ${formatPence(linesTotal)}`;
  const suggestedNet = suggestedNetPence(values);

  return (
    <Screen
      title="Payslip"
      scroll
      bottomInset
      footer={
        <View style={[styles.row, { gap: spacing.md }]}>
          <View style={styles.fill}>
            <Button label="Back" variant="secondary" onPress={() => router.back()} />
          </View>
          <View style={styles.fill}>
            <Button label="Save" disabled={busy} onPress={onSave} />
          </View>
        </View>
      }
    >
      <Text
        style={[typography.body, styles.nums, { color: colors.inkMuted, marginBottom: spacing.lg }]}
      >
        {periodRangeLabel(period.start, period.end)}
      </Text>

      <TextField
        label="Gross pay (£)"
        value={values.grossText}
        onChangeText={(grossText) => set({ grossText })}
        keyboardType="decimal-pad"
        placeholder="0.00"
        error={errorFor('gross')}
      />
      <TextField
        label="Hours paid (optional)"
        value={values.hoursText}
        onChangeText={(hoursText) => set({ hoursText })}
        keyboardType="decimal-pad"
        error={errorFor('hours')}
      />

      <View testID="payslip-lines" style={{ marginBottom: spacing.lg }}>
        <Card title="Lines (optional)">
          {values.lines.map((line, i) => (
            // Lines have no id; index keys are fine as removal re-renders the rest.
            <View
              key={i}
              testID="payslip-line"
              style={[
                styles.divider,
                { borderBottomColor: colors.line, marginBottom: spacing.md },
              ]}
            >
              <TextField
                label="Label"
                value={line.label}
                onChangeText={(label) => setLine(i, { label })}
                placeholder="e.g. Basic pay"
                error={lineErrorFor('lineLabel', i)}
              />
              <TextField
                label="Hours"
                value={line.hoursText}
                onChangeText={(hoursText) => setLine(i, { hoursText })}
                keyboardType="decimal-pad"
                error={lineErrorFor('lineHours', i)}
              />
              <TextField
                label="Amount (£)"
                value={line.amountText}
                onChangeText={(amountText) => setLine(i, { amountText })}
                keyboardType="numeric"
                error={lineErrorFor('lineAmount', i)}
              />
              <View style={{ marginBottom: spacing.sm }}>
                <Button label="Remove line" variant="quiet" onPress={() => removeLine(i)} />
              </View>
            </View>
          ))}
          {linesHint !== null && (
            <Text
              style={[
                typography.caption,
                styles.nums,
                { color: colors.inkMuted, marginBottom: spacing.sm },
              ]}
            >
              {linesHint}
            </Text>
          )}
          <Button label="Add line" variant="secondary" onPress={addLine} />
        </Card>
      </View>

      <TextField
        label="Tax (£)"
        value={values.taxText}
        onChangeText={(taxText) => set({ taxText })}
        keyboardType="numeric"
        placeholder="0.00"
        error={errorFor('tax')}
        helper="Blank counts as £0. Use a minus for a refund."
      />
      <TextField
        label="National Insurance (£)"
        value={values.niText}
        onChangeText={(niText) => set({ niText })}
        keyboardType="decimal-pad"
        placeholder="0.00"
        error={errorFor('ni')}
        helper="Blank counts as £0"
      />
      <TextField
        label="Pension (£)"
        value={values.pensionText}
        onChangeText={(pensionText) => set({ pensionText })}
        keyboardType="decimal-pad"
        placeholder="0.00"
        error={errorFor('pension')}
        helper="Blank counts as £0"
      />
      <TextField
        label="Net pay (£, optional)"
        value={values.netText}
        onChangeText={(netText) => set({ netText })}
        keyboardType="numeric"
        error={errorFor('net')}
        helper={
          suggestedNet === null ? undefined : `Gross minus deductions: ${formatPence(suggestedNet)}`
        }
      />

      {!isNew &&
        (confirmDelete ? (
          <View style={{ gap: spacing.sm, marginBottom: spacing.xl }}>
            <Text style={[typography.body, { color: colors.ink }]}>Delete this payslip?</Text>
            <View style={[styles.row, { gap: spacing.md }]}>
              <View style={styles.fill}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  onPress={() => setConfirmDelete(false)}
                />
              </View>
              <View style={styles.fill}>
                <Button label="Delete" disabled={busy} onPress={onDelete} />
              </View>
            </View>
          </View>
        ) : (
          <View style={{ marginBottom: spacing.xl }}>
            <Button
              label="Delete payslip"
              variant="quiet"
              onPress={() => setConfirmDelete(true)}
            />
          </View>
        ))}

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

export default function PayslipScreen() {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const { start } = useLocalSearchParams<{ start: string }>();
  const job = useJobsStore((s) => s.jobs[0]);
  const range = useShiftsStore((s) => s.range);
  const payslips = usePayslipsStore((s) => s.payslips);
  const [newPayslipId] = useState(() => newId('payslip'));

  // Same rule as the period detail: a real period start whose whole period is loaded.
  const period = useMemo(() => {
    if (job === undefined || range === null || typeof start !== 'string') return null;
    if (!LOCAL_DATE.test(start)) return null;
    const p = periodContaining(start, job);
    return p.start === start && p.start >= range.start && p.end <= range.end ? p : null;
  }, [job, range, start]);

  if (job === undefined || period === null) {
    return (
      <Screen
        title="Period not found"
        bottomInset
        footer={<Button label="Back" variant="secondary" onPress={() => router.back()} />}
      >
        <Text style={[typography.body, { color: colors.ink, marginBottom: spacing.lg }]}>
          This pay period is not available.
        </Text>
        <Disclaimer />
      </Screen>
    );
  }

  const existing = payslipForPeriod(payslips, job.id, period.start);
  return (
    <PayslipForm
      key={existing?.id ?? 'new'}
      initial={existing === undefined ? newPayslipForm() : payslipToForm(existing)}
      payslipId={existing?.id ?? newPayslipId}
      jobId={job.id}
      period={period}
      isNew={existing === undefined}
    />
  );
}

const styles = StyleSheet.create({
  nums: { fontVariant: [...tabularNums] },
  row: { flexDirection: 'row' },
  fill: { flex: 1 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth },
});
