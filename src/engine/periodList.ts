/**
 * Pay tab helpers (SPEC §7): the list of pay periods with their expected
 * gross, and one period's detail (per-rule lines and its shifts). Pure.
 *
 * Every total comes from `aggregatePeriod`, so it matches the engine exactly.
 * Line pence are the engine's already-rounded sums, never re-rounded, so
 * sum(lines.pence) === totalGrossPence.
 */
import type { BankHolidayLookup } from './bankHolidays';
import { isOvertimeRule } from './overtime';
import { aggregatePeriod, periodContaining, periodsBetween } from './payPeriods';
import type { DateRange } from './shiftPay';
import { addLocalDays, minutesBetween } from './time';
import type { IsoInstant, Job, LocalDate, PremiumRule, Shift, ShiftStatus } from './types';

export type PeriodWhen = 'past' | 'current' | 'next';

export interface PayPeriodListItem {
  start: LocalDate;
  end: LocalDate;
  payDate: LocalDate;
  totalGrossPence: number;
  paidHours: number;
  /** Non-cancelled shifts of the job dated in the period. */
  shiftCount: number;
  when: PeriodWhen;
}

export interface PayPeriodListInput {
  /** All of the job's loaded shifts (earlier shifts count to weekly OT). */
  shifts: Shift[];
  job: Job;
  rules: PremiumRule[];
  bankHolidays: BankHolidayLookup;
  /** The loaded shift range: only periods lying fully inside it are listed. */
  range: DateRange;
  today: LocalDate;
}

/**
 * Pay periods lying fully inside `range`, newest first, up to and including
 * the period after the one containing `today` ('next'); none later.
 */
export function payPeriodList({
  shifts,
  job,
  rules,
  bankHolidays,
  range,
  today,
}: PayPeriodListInput): PayPeriodListItem[] {
  const current = periodContaining(today, job);
  const next = periodContaining(addLocalDays(current.end, 1), job);
  const to = next.end < range.end ? next.end : range.end;
  return periodsBetween(job, range.start, to)
    .filter((p) => p.start >= range.start && p.end <= range.end)
    .reverse()
    .map((period): PayPeriodListItem => {
      const aggregate = aggregatePeriod(shifts, job, rules, bankHolidays, period);
      const shiftCount = shifts.filter(
        (s) =>
          s.jobId === job.id &&
          s.status !== 'cancelled' &&
          s.date >= period.start &&
          s.date <= period.end,
      ).length;
      const when: PeriodWhen =
        period.start === current.start ? 'current' : period.start === next.start ? 'next' : 'past';
      return {
        start: period.start,
        end: period.end,
        payDate: aggregate.payDate,
        totalGrossPence: aggregate.totalGrossPence,
        paidHours: aggregate.paidHours,
        shiftCount,
        when,
      };
    });
}

export type PeriodDetailLineKind = 'base' | 'premium' | 'overtime';

export interface PeriodDetailLine {
  /** Stable key: `base`, `premium:<ruleId>` or `overtime:<ruleId>`. */
  key: string;
  label: string;
  kind: PeriodDetailLineKind;
  /** Paid hours this line was paid on (decimal). */
  hours: number;
  pence: number;
}

export interface PeriodDetailShift {
  id: string;
  date: LocalDate;
  start: IsoInstant;
  end: IsoInstant;
  status: ShiftStatus;
  /** Paid hours (after unpaid breaks; 0 for a cancelled shift). */
  paidHours: number;
  totalGrossPence: number;
}

export interface PeriodDetail {
  totalGrossPence: number;
  paidHours: number;
  payDate: LocalDate;
  /**
   * "Base" first, then premiums, then overtime, each by rule in `rules` order
   * (as `shiftDetail`); 0p lines dropped, except overtime lines with hours.
   */
  lines: PeriodDetailLine[];
  /** The job's shifts dated in the period, by start; cancelled ones at 0p. */
  shifts: PeriodDetailShift[];
}

export interface PeriodDetailInput {
  /** All of the job's shifts (earlier shifts count to weekly OT). */
  shifts: Shift[];
  job: Job;
  rules: PremiumRule[];
  bankHolidays: BankHolidayLookup;
  period: DateRange;
}

/** Breakdown of one pay period of `job`. */
export function periodDetail({
  shifts,
  job,
  rules,
  bankHolidays,
  period,
}: PeriodDetailInput): PeriodDetail {
  const aggregate = aggregatePeriod(shifts, job, rules, bankHolidays, period);

  const base: PeriodDetailLine = {
    key: 'base',
    label: 'Base',
    kind: 'base',
    hours: aggregate.paidHours,
    pence: aggregate.basePence,
  };
  const overtimeIds = new Set(rules.filter(isOvertimeRule).map((r) => r.id));
  const premiumLines = aggregate.byRule
    .filter((r) => !overtimeIds.has(r.ruleId))
    .map((r): PeriodDetailLine => ({
      key: `premium:${r.ruleId}`,
      label: r.ruleName,
      kind: 'premium',
      hours: r.hours,
      pence: r.pence,
    }));
  // OT hours are byRule's, i.e. `isOvertimeHour` (same as Stats and shiftDetail).
  const overtimeLines = aggregate.byRule
    .filter((r) => overtimeIds.has(r.ruleId))
    .map((r): PeriodDetailLine => ({
      key: `overtime:${r.ruleId}`,
      label: r.ruleName,
      kind: 'overtime',
      hours: r.hours,
      pence: r.pence,
    }));
  // An OT line with hours but 0p (plain-time x1.0 OT) is kept: the hours are real.
  const lines = [base, ...premiumLines, ...overtimeLines].filter(
    (l) => l.pence !== 0 || (l.kind === 'overtime' && l.hours !== 0),
  );

  const shiftById = new Map(shifts.filter((s) => s.jobId === job.id).map((s) => [s.id, s]));
  const periodShifts = aggregate.shifts
    .map((b): PeriodDetailShift => {
      // Every breakdown comes from one of the job's shifts.
      const s = shiftById.get(b.shiftId) as Shift;
      return {
        id: s.id,
        date: s.date,
        start: s.start,
        end: s.end,
        status: s.status,
        paidHours: b.paidHours,
        totalGrossPence: b.totalGrossPence,
      };
    })
    .sort((a, b) => minutesBetween(b.start, a.start));

  return {
    totalGrossPence: aggregate.totalGrossPence,
    paidHours: aggregate.paidHours,
    payDate: aggregate.payDate,
    lines,
    shifts: periodShifts,
  };
}
