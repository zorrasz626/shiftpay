/**
 * Payslip check view model (SPEC §6): turns a saved payslip and its period's
 * shifts into what the result card shows. Numbers stay raw (the UI formats
 * them); only the status chip and the likely-cause sentences are text. Pure.
 */
import { MONTH_NAMES } from './calendarMonth';
import { formatPence } from './money';
import { aggregatePeriod } from './payPeriods';
import { diffPayslip } from './payslip';
import type { PeriodDetailInput } from './periodList';
import type { LocalDate, Payslip, PayslipCause, PayslipStatus, PremiumRule } from './types';

export type PayslipChipTone = 'positive' | 'alert' | 'neutral';

export interface PayslipCheckView {
  status: PayslipStatus;
  chipLabel: string;
  chipTone: PayslipChipTone;
  expectedPence: number;
  paidPence: number;
  /** paid - expected, integer pence. */
  diffPence: number;
  expectedHours: number;
  paidHours?: number;
  /** paid - expected hours. */
  diffHours?: number;
  /** Likely causes as sentences, in diff order. */
  causes: string[];
}

export type PayslipCheckInput = PeriodDetailInput & { payslip: Payslip };

/** Name used when a cause names a rule id not in the job's rules. */
export const UNKNOWN_RULE_NAME = 'a pay rule';
/** The single cause shown for an under/overpayment with no likely cause. */
export const NO_CAUSE_TEXT = 'No likely cause found — check your shifts and rates with payroll.';
/** Dates listed in a "not found on payslip" cause before " +N more". */
export const MAX_CAUSE_DATES = 3;

const OVERTIME_TYPES = new Set<string>(['overtime_daily', 'overtime_weekly', 'overtime_period']);

/** Chip label and tone for a status; `diffPence` is paid - expected. */
export function payslipChip(
  status: PayslipStatus,
  diffPence: number,
): { label: string; tone: PayslipChipTone } {
  const amount = formatPence(Math.abs(diffPence));
  switch (status) {
    case 'match':
      return { label: 'Match', tone: 'positive' };
    case 'check':
      return { label: 'Check', tone: 'neutral' };
    case 'underpaid':
      return { label: `Underpaid by ${amount}`, tone: 'alert' };
    case 'overpaid':
      return { label: `Overpaid by ${amount}`, tone: 'neutral' };
  }
}

/** `2026-10-03` -> `3 Oct` (splits the string; never builds a Date). */
export function formatCauseDate(date: LocalDate): string {
  const [, month, day] = date.split('-');
  return `${Number(day)} ${MONTH_NAMES[Number(month) - 1].slice(0, 3)}`;
}

/** Absolute hours without trailing zeros: `1 hour`, `2.5 hours`. */
export function formatCauseHours(hours: number): string {
  const n = Number(Math.abs(hours).toFixed(2));
  return n === 1 ? '1 hour' : `${n} hours`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** `diffHours` is paid - expected. */
export function hoursDifferText(diffHours: number): string {
  const direction = diffHours < 0 ? 'fewer' : 'more';
  return `Payslip shows ${formatCauseHours(diffHours)} ${direction} than your shifts`;
}

export function ruleNotOnPayslipText(ruleName: string, dates: LocalDate[]): string {
  const shown = dates.slice(0, MAX_CAUSE_DATES).map(formatCauseDate).join(', ');
  const more = dates.length > MAX_CAUSE_DATES ? ` +${dates.length - MAX_CAUSE_DATES} more` : '';
  return `${capitalise(ruleName)} for ${shown}${more} not found on payslip?`;
}

export function shortfallMatchesRuleText(ruleName: string, rulePence: number): string {
  return `Shortfall is close to your ${ruleName} pay (${formatPence(rulePence)}) — was it paid?`;
}

export function shortfallMatchesOvertimeText(overtimePence: number): string {
  return `Shortfall is close to your overtime (${formatPence(overtimePence)}) — overtime threshold not met?`;
}

/** Resolves a rule id to its name in `rules`; unknown ids -> UNKNOWN_RULE_NAME. */
export function ruleNameLookup(rules: PremiumRule[]): (ruleId: string) => string {
  const names = new Map(rules.map((r) => [r.id, r.name]));
  return (ruleId) => names.get(ruleId) ?? UNKNOWN_RULE_NAME;
}

/** One cause as a sentence; `ruleName` resolves a rule id to its display name. */
export function payslipCauseText(cause: PayslipCause, ruleName: (ruleId: string) => string): string {
  switch (cause.kind) {
    case 'hours_differ':
      return hoursDifferText(cause.diffHours);
    case 'rule_not_on_payslip':
      return ruleNotOnPayslipText(ruleName(cause.ruleId), cause.dates);
    case 'shortfall_matches_rule':
      return shortfallMatchesRuleText(ruleName(cause.ruleId), cause.rulePence);
    case 'shortfall_matches_overtime':
      return shortfallMatchesOvertimeText(cause.overtimePence);
  }
}

/** Compare `payslip` with the engine's breakdown of `period` and build the result card. */
export function payslipCheck({
  shifts,
  job,
  rules,
  bankHolidays,
  period,
  payslip,
}: PayslipCheckInput): PayslipCheckView {
  const breakdown = aggregatePeriod(shifts, job, rules, bankHolidays, period);
  const diff = diffPayslip(payslip, breakdown);

  const ruleName = ruleNameLookup(rules);
  const overtimeRuleIds = new Set(
    breakdown.byRule.filter((r) => OVERTIME_TYPES.has(r.type)).map((r) => r.ruleId),
  );

  // An OT shortfall is shown once: as the overtime cause, not also as its rule.
  const hasOvertimeShortfall = diff.causes.some((c) => c.kind === 'shortfall_matches_overtime');
  const causes = diff.causes.filter(
    (c) =>
      !(
        hasOvertimeShortfall &&
        c.kind === 'shortfall_matches_rule' &&
        overtimeRuleIds.has(c.ruleId)
      ),
  );

  const texts = causes.map((c) => payslipCauseText(c, ruleName));
  if (texts.length === 0 && (diff.status === 'underpaid' || diff.status === 'overpaid')) {
    texts.push(NO_CAUSE_TEXT);
  }

  const chip = payslipChip(diff.status, diff.diffPence);
  const hours: Pick<PayslipCheckView, 'paidHours' | 'diffHours'> = {};
  if (diff.paidHours !== undefined) hours.paidHours = diff.paidHours;
  if (diff.diffHours !== undefined) hours.diffHours = diff.diffHours;

  return {
    status: diff.status,
    chipLabel: chip.label,
    chipTone: chip.tone,
    expectedPence: diff.expectedPence,
    paidPence: diff.paidPence,
    diffPence: diff.diffPence,
    expectedHours: diff.expectedHours,
    ...hours,
    causes: texts,
  };
}
