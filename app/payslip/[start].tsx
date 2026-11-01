/**
 * Payslip entry (SPEC §6): enter, edit or delete the payslip for one pay
 * period. Reached from the period detail; the route param is the period's
 * start date. Edits are local until Save, which replaces the whole payslip;
 * Back discards them. Delete asks for confirmation first. Lines are Pro
 * (SPEC §8): free shows an upsell instead, and a free Save keeps any lines
 * already stored on the payslip (saved while Pro or from a backup) unchanged.
 * Once a payslip is saved, Pro can export the check as PDF or CSV (PLAN 6.6).
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { type ReactNode, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Disclaimer } from '../../src/components/Disclaimer';
import { ProUpsell } from '../../src/components/ProUpsell';
import { Screen } from '../../src/components/Screen';
import { TextField } from '../../src/components/TextField';
import { db } from '../../src/db/client';
import { formatPence, parsePoundsToPence } from '../../src/engine/money';
import { periodContaining } from '../../src/engine/payPeriods';
import { payslipCheck } from '../../src/engine/payslipCheck';
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
import { periodDetail } from '../../src/engine/periodList';
import { instantToLocal } from '../../src/engine/time';
import type { Job, LocalDate, Payslip, PayslipLine } from '../../src/engine/types';
import type { PayslipReportInput } from '../../src/features/export/payslipReport';
import { periodRangeLabel } from '../../src/features/pay/payView';
import { hasFeature } from '../../src/features/pro/gates';
import { useEntitlement } from '../../src/features/pro/useEntitlement';
import {
  type PayslipExportResult,
  sharePayslipCsv,
  sharePayslipPdf,
} from '../../src/services/payslipExportShare';
import { useBankHolidaysStore } from '../../src/store/bankHolidaysStore';
import { useJobsStore } from '../../src/store/jobsStore';
import { newId } from '../../src/store/onboardingStore';
import { payslipForPeriod, usePayslipsStore } from '../../src/store/payslipsStore';
import { useRulesStore } from '../../src/store/rulesStore';
import { useShiftsStore } from '../../src/store/shiftsStore';
import { tabularNums } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/useTheme';

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

type TopField = Exclude<PayslipFormField, 'lineLabel' | 'lineHours' | 'lineAmount'>;

const EMPTY_LINE: PayslipLineFormValues = { label: '', hoursText: '', amountText: '' };

/** Shown in the lines hint row before any line has a valid total. */
const LINES_HINT_PENDING = 'Lines add up to —';

const EXPORT_UNAVAILABLE = "Sharing isn't available on this device.";
const EXPORT_FAILED = "The export couldn't be created. Try again.";

/**
 * Pro: "Export PDF" / "Export CSV" for the saved payslip's check (the stored
 * payslip, not unsaved edits). Free: an upsell. The report is built at press
 * time from the same inputs as the period detail's check.
 */
function PayslipExport({
  job,
  period,
  payslip,
}: {
  job: Job;
  period: { start: LocalDate; end: LocalDate };
  payslip: Payslip;
}) {
  const { colors, typography, spacing } = useTheme();
  const { isPro } = useEntitlement();
  const shifts = useShiftsStore((s) => s.shifts);
  const rules = useRulesStore((s) => s.rules);
  const bankHolidays = useBankHolidaysStore((s) => s.lookup);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!hasFeature('payslipExport', isPro)) {
    return (
      <View style={{ marginBottom: spacing.lg }}>
        <ProUpsell text="Export for payroll" />
      </View>
    );
  }

  async function exportWith(share: (input: PayslipReportInput) => Promise<PayslipExportResult>) {
    setBusy(true);
    setMessage(null);
    let result: PayslipExportResult;
    try {
      const input = {
        shifts,
        job,
        rules: rules.filter((r) => r.jobId === job.id),
        bankHolidays,
        period,
      };
      const detail = periodDetail(input);
      // Export is Pro, and so are payslip lines: the check includes them.
      const check = payslipCheck({ ...input, payslip });
      result = await share({
        jobName: job.name,
        period,
        payDate: detail.payDate,
        detail,
        check,
        generatedAt: instantToLocal(new Date().toISOString()).date,
      });
    } catch {
      result = { status: 'failed' };
    }
    setBusy(false);
    if (result.status === 'unavailable') setMessage(EXPORT_UNAVAILABLE);
    if (result.status === 'failed') setMessage(EXPORT_FAILED);
  }

  return (
    <View testID="payslip-export" style={{ marginBottom: spacing.lg }}>
      <Card title="Export for payroll">
        <View style={[styles.row, { gap: spacing.md }]}>
          <View style={styles.fill}>
            <Button
              label="Export PDF"
              variant="secondary"
              disabled={busy}
              onPress={() => void exportWith(sharePayslipPdf)}
            />
          </View>
          <View style={styles.fill}>
            <Button
              label="Export CSV"
              variant="secondary"
              disabled={busy}
              onPress={() => void exportWith(sharePayslipCsv)}
            />
          </View>
        </View>
        {message !== null && (
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.body, { color: colors.alert, marginTop: spacing.sm }]}
          >
            {message}
          </Text>
        )}
      </Card>
    </View>
  );
}

function PayslipForm({
  initial,
  payslipId,
  jobId,
  period,
  isNew,
  storedLines,
  exportSection,
}: {
  initial: PayslipFormValues;
  payslipId: string;
  jobId: string;
  period: { start: LocalDate; end: LocalDate };
  isNew: boolean;
  /** Lines already saved on this payslip; a free Save keeps them as they are. */
  storedLines: PayslipLine[] | undefined;
  /** Export (or its upsell), shown only once a payslip is saved. */
  exportSection: ReactNode;
}) {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const savePayslip = usePayslipsStore((s) => s.savePayslip);
  const removePayslip = usePayslipsStore((s) => s.removePayslip);
  const { isPro } = useEntitlement();
  const showLines = hasFeature('payslipLines', isPro);

  const [values, setValues] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastLinesHint, setLastLinesHint] = useState<string | null>(null);

  // Free: the (hidden) lines are left out of validation and of the saved form.
  const formValues = showLines ? values : { ...values, lines: [] };
  const errors = payslipFormErrors(formValues);
  // Errors show only once Save was tried. Showing them as soon as a field had
  // text made them flash per keystroke (e.g. "12." before the pence), so the
  // fields below jumped up and down while typing and the next tap missed.
  const errorFor = (field: TopField) =>
    submitted ? errors.find((e) => e.field === field)?.message : undefined;
  const lineErrorFor = (field: 'lineLabel' | 'lineHours' | 'lineAmount', index: number) =>
    submitted ? errors.find((e) => e.field === field && e.lineIndex === index)?.message : undefined;

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
    const payslip = formToPayslip(formValues, {
      id: payslipId,
      jobId,
      periodStart: period.start,
      periodEnd: period.end,
    });
    // Gating never deletes data: a free Save keeps the stored lines.
    if (!showLines && storedLines !== undefined && storedLines.length > 0) {
      payslip.lines = storedLines;
    }
    void run(() => savePayslip(db, payslip), "Your payslip couldn't be saved. Try again.");
  };
  const onDelete = () =>
    run(() => removePayslip(db, payslipId), "The payslip couldn't be deleted. Try again.");

  const linesTotal = linesTotalPence(values);
  const gross = parsePoundsToPence(values.grossText);
  const totalHint =
    linesTotal === null
      ? null
      : gross !== null && gross >= 0 && gross !== linesTotal
        ? `Lines add up to ${formatPence(linesTotal)}, gross is ${formatPence(gross)}`
        : `Lines add up to ${formatPence(linesTotal)}`;
  // While an amount is mid-entry ("447.") the total is null; keep the last
  // valid hint (or a placeholder) so the hint row keeps its space and the
  // fields below don't jump. No row at all when there are no lines.
  const hasLines = values.lines.length > 0;
  if (totalHint !== null && totalHint !== lastLinesHint) setLastLinesHint(totalHint);
  if (!hasLines && lastLinesHint !== null) setLastLinesHint(null);
  const linesHint = hasLines ? (totalHint ?? lastLinesHint ?? LINES_HINT_PENDING) : null;
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

      {!showLines && (
        <View style={{ marginBottom: spacing.lg }}>
          <ProUpsell text="Line-by-line check" detail="Free checks your gross pay and hours." />
        </View>
      )}
      {showLines && (
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
                  <Button label="Remove line" variant="secondary" onPress={() => removeLine(i)} />
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
      )}

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

      {exportSection}

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
            <Button label="Delete payslip" variant="quiet" onPress={() => setConfirmDelete(true)} />
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
      storedLines={existing?.lines}
      exportSection={
        existing === undefined ? null : (
          <PayslipExport job={job} period={period} payslip={existing} />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  nums: { fontVariant: [...tabularNums] },
  row: { flexDirection: 'row' },
  fill: { flex: 1 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth },
});
