/**
 * Pay periods and period aggregation (SPEC §5 items 6, 7; D6).
 *
 * weekly / fortnightly / four_weekly: fixed 7 / 14 / 28-day periods, one of
 * which starts on `payPeriodAnchorDate`; the rest step forwards and backwards.
 * monthly: the anchor is ignored; a period ends on `periodCutoffDay` clamped to
 * the month's length and starts the day after the previous month's cut-off.
 * Pay date = period end + `payDayOffsetDays`.
 */
import type { BankHolidayLookup } from './bankHolidays';
import { sumPence } from './money';
import { calculateShifts } from './shiftPay';
import type { DateRange } from './shiftPay';
import { addLocalDays, localDaysBetween } from './time';
import type { Job, LocalDate, PayFrequency, PeriodBreakdown, PremiumRule, RuleBreakdown, Shift } from './types';

export const FIXED_LENGTH_DAYS: Record<Exclude<PayFrequency, 'monthly'>, number> = {
  weekly: 7,
  fortnightly: 14,
  four_weekly: 28,
};

/** `YYYY-MM-01` of the month with index `year * 12 + (month - 1)`. */
function firstOfMonth(index: number): LocalDate {
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
}

/** The cut-off date in the month with the given index, clamped to the month's length. */
function cutoffIn(index: number, cutoffDay: number): LocalDate {
  const last = addLocalDays(firstOfMonth(index + 1), -1);
  const day = Math.min(cutoffDay, Number(last.slice(8)));
  return `${last.slice(0, 8)}${String(day).padStart(2, '0')}`;
}

/** The monthly period containing `date` for `cutoffDay` (1-31, clamped to each month's length). */
export function monthlyPeriod(date: LocalDate, cutoffDay: number): DateRange {
  const index = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
  const thisCutoff = cutoffIn(index, cutoffDay);
  const endIndex = date <= thisCutoff ? index : index + 1;
  return { start: addLocalDays(cutoffIn(endIndex - 1, cutoffDay), 1), end: cutoffIn(endIndex, cutoffDay) };
}

/** The pay period (inclusive local dates) that contains `date`. */
export function periodContaining(date: LocalDate, job: Job): DateRange {
  const checked = addLocalDays(date, 0); // throws on an invalid date
  if (job.payFrequency === 'monthly') return monthlyPeriod(checked, job.periodCutoffDay);
  const length = FIXED_LENGTH_DAYS[job.payFrequency];
  const offset = Math.floor(localDaysBetween(job.payPeriodAnchorDate, checked) / length) * length;
  const start = addLocalDays(job.payPeriodAnchorDate, offset);
  return { start, end: addLocalDays(start, length - 1) };
}

/** Every pay period overlapping [from, to], in order (none if `to` is before `from`). */
export function periodsBetween(job: Job, from: LocalDate, to: LocalDate): DateRange[] {
  if (to < from) return [];
  const periods: DateRange[] = [];
  let period = periodContaining(from, job);
  while (period.start <= to) {
    periods.push(period);
    period = periodContaining(addLocalDays(period.end, 1), job);
  }
  return periods;
}

/** Pay day for `period`: its end + `payDayOffsetDays`. */
export function payDate(period: DateRange, job: Job): LocalDate {
  return addLocalDays(period.end, job.payDayOffsetDays);
}

/**
 * Totals for one pay period. Pass all of the job's shifts: earlier shifts in
 * the same OT week still count to weekly OT. Totals are integer sums of the
 * shift totals; hours are summed minutes / 60. `byRule` has one entry per rule
 * that earned pence or hours, in `rules` order: premium rules by their rule
 * amounts, OT rules by the segments paid under them.
 */
export function aggregatePeriod(
  shifts: Shift[],
  job: Job,
  rules: PremiumRule[],
  bankHolidays: BankHolidayLookup,
  period: DateRange,
): PeriodBreakdown {
  const breakdowns = calculateShifts(shifts, job, rules, bankHolidays, period);
  const segments = breakdowns.flatMap((b) => b.segments);
  const sum = (pick: (b: (typeof breakdowns)[number]) => number) => sumPence(breakdowns.map(pick));

  const byRule: RuleBreakdown[] = [];
  for (const rule of rules) {
    const pence: number[] = [];
    let minutes = 0;
    for (const segment of segments) {
      const amount = segment.ruleAmounts.find((r) => r.ruleId === rule.id);
      if (amount !== undefined) {
        pence.push(amount.pence);
        minutes += segment.paidMinutes;
      } else if (segment.overtimeRuleId === rule.id) {
        pence.push(segment.overtimePence);
        minutes += segment.paidMinutes;
      }
    }
    const total = sumPence(pence);
    if (total !== 0 || minutes !== 0) {
      byRule.push({ ruleId: rule.id, ruleName: rule.name, type: rule.type, hours: minutes / 60, pence: total });
    }
  }

  return {
    periodStart: period.start,
    periodEnd: period.end,
    payDate: payDate(period, job),
    shifts: breakdowns,
    byRule,
    basePence: sum((b) => b.basePence),
    premiumPence: sum((b) => b.premiumPence),
    overtimePence: sum((b) => b.overtimePence),
    totalGrossPence: sum((b) => b.totalGrossPence),
    paidHours: segments.reduce((acc, s) => acc + s.paidMinutes, 0) / 60,
  };
}
