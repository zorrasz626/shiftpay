/**
 * Payslip diff (SPEC §6): compare a payslip with the engine's PeriodBreakdown
 * for the same period. Reads the breakdown; never recomputes pay. Returns
 * structured causes only: no text and no £ formatting here.
 */
import { clearNoise } from './money';
import type {
  LocalDate,
  Payslip,
  PayslipCause,
  PayslipDiff,
  PayslipStatus,
  PeriodBreakdown,
} from './types';

/** Inclusive money tolerance: £1. */
const PENCE_TOLERANCE = 100;
/** Inclusive hours tolerance. */
const HOURS_TOLERANCE = 0.25;

/**
 * Sorted unique dates of the shifts with any segment that earned pence under
 * `ruleId`. A shift's date is its first segment's local date (the segment
 * starting at shift.start), so a night shift lists its start date only.
 */
function ruleDates(breakdown: PeriodBreakdown, ruleId: string): LocalDate[] {
  const dates = new Set<LocalDate>();
  for (const shift of breakdown.shifts) {
    for (const segment of shift.segments) {
      const amount = segment.ruleAmounts.find((r) => r.ruleId === ruleId);
      const pence =
        amount !== undefined
          ? amount.pence
          : segment.overtimeRuleId === ruleId
            ? segment.overtimePence
            : 0;
      if (pence > 0) {
        dates.add(shift.segments[0].localDate);
        break;
      }
    }
  }
  return [...dates].sort();
}

export function diffPayslip(payslip: Payslip, breakdown: PeriodBreakdown): PayslipDiff {
  const expectedPence = breakdown.totalGrossPence;
  const paidPence = payslip.grossPaidPence;
  const diffPence = paidPence - expectedPence;
  const expectedHours = breakdown.paidHours;
  const earning = breakdown.byRule.filter((r) => r.pence > 0);
  const causes: PayslipCause[] = [];

  let hours: Pick<PayslipDiff, 'paidHours' | 'diffHours'> = {};
  if (payslip.hoursPaid !== undefined) {
    const diffHours = clearNoise(payslip.hoursPaid - expectedHours);
    hours = { paidHours: payslip.hoursPaid, diffHours };
    if (Math.abs(diffHours) > HOURS_TOLERANCE) causes.push({ kind: 'hours_differ', diffHours });
  }

  if (payslip.lines !== undefined) {
    const labels = payslip.lines.map((l) => l.label.toLowerCase());
    for (const rule of earning) {
      const name = rule.ruleName.toLowerCase();
      if (!labels.some((label) => label.includes(name))) {
        causes.push({
          kind: 'rule_not_on_payslip',
          ruleId: rule.ruleId,
          dates: ruleDates(breakdown, rule.ruleId),
        });
      }
    }
  }

  let status: PayslipStatus;
  if (diffPence < -PENCE_TOLERANCE) {
    status = 'underpaid';
    const shortfall = -diffPence;
    for (const rule of earning) {
      if (Math.abs(shortfall - rule.pence) <= PENCE_TOLERANCE) {
        causes.push({ kind: 'shortfall_matches_rule', ruleId: rule.ruleId, rulePence: rule.pence });
      }
    }
    const overtimePence = breakdown.overtimePence;
    if (overtimePence > 0 && Math.abs(shortfall - overtimePence) <= PENCE_TOLERANCE) {
      causes.push({ kind: 'shortfall_matches_overtime', overtimePence });
    }
  } else if (diffPence > PENCE_TOLERANCE) {
    status = 'overpaid';
  } else {
    status = causes.length > 0 ? 'check' : 'match';
  }

  return { status, expectedPence, paidPence, diffPence, expectedHours, ...hours, causes };
}
