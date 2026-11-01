/**
 * Stats (SPEC §7.7, Pro): earnings by calendar month, overtime hours and
 * premiums earned. Pure.
 *
 * Pay comes from `calculateShifts`, run once per pay period overlapping the
 * range, so daily, weekly and period OT are exactly what the Pay tab shows.
 * Each shift is then counted in the London calendar month of `shift.date`
 * (the date it starts on), as everywhere else in the app: a night shift from
 * 31 Jan 22:00 to 1 Feb 06:00 counts wholly in January.
 *
 * Stats are "earned", not projected: only shifts that have ended at or before
 * `now` count (any status; cancelled shifts pay 0). Pence are sums of the
 * engine's already-rounded amounts (`sumPence`), never re-rounded; hours are
 * summed integer minutes / 60.
 */
import type { BankHolidayLookup } from './bankHolidays';
import { sumPence } from './money';
import { isOvertimeRule } from './overtime';
import { periodsBetween } from './payPeriods';
import { calculateShifts } from './shiftPay';
import { addLocalDays, minutesBetween } from './time';
import type { IsoInstant, Job, LocalDate, PremiumRule, RuleBreakdown, Segment, Shift, ShiftBreakdown } from './types';

/** Calendar month `YYYY-MM` (Europe/London). */
export type LocalMonth = string;

export interface StatsSummary {
  grossPence: number;
  basePence: number;
  premiumPence: number;
  overtimePence: number;
  paidHours: number;
  /** Paid hours of segments that paid OT pence under an OT rule. */
  overtimeHours: number;
  /**
   * One entry per rule that earned pence or hours, in `rules` order: premium
   * rules by their rule amounts, OT rules by the segments that paid OT under them.
   */
  byRule: RuleBreakdown[];
}

export interface MonthStats extends StatsSummary {
  month: LocalMonth;
}

export interface MonthlyStats {
  /** Every month from `from` to `to` inclusive, oldest first (empty if `to` is before `from`). */
  months: MonthStats[];
  /** Over the whole range: equal to the sums of `months`. */
  totals: StatsSummary;
  /** True if any counted shift earned pence. */
  hasData: boolean;
}

export interface MonthlyStatsInput {
  /** All of the job's shifts (earlier shifts count to weekly OT). */
  shifts: Shift[];
  job: Job;
  rules: PremiumRule[];
  bankHolidays: BankHolidayLookup;
  /** First month, `YYYY-MM`. */
  from: LocalMonth;
  /** Last month, `YYYY-MM` (inclusive). */
  to: LocalMonth;
  /** Shifts ending after this instant are not counted. */
  now: IsoInstant;
}

/** The month after `month` (`YYYY-MM`). */
function nextMonth(month: LocalMonth): LocalMonth {
  return addLocalDays(`${month}-28`, 4).slice(0, 7);
}

/** OT segments as in `shiftDetail` / `periodDetail`: only those that paid OT pence. */
function paidOvertime(segment: Segment): boolean {
  return segment.overtimeRuleId !== undefined && segment.overtimePence !== 0;
}

function summarise(breakdowns: ShiftBreakdown[], rules: PremiumRule[]): StatsSummary {
  const segments = breakdowns.flatMap((b) => b.segments);
  const sum = (pick: (b: ShiftBreakdown) => number) => sumPence(breakdowns.map(pick));
  const minutesOf = (list: Segment[]) => list.reduce((acc, s) => acc + s.paidMinutes, 0);

  const byRule: RuleBreakdown[] = [];
  for (const rule of rules) {
    const pence: number[] = [];
    let minutes = 0;
    for (const segment of segments) {
      if (isOvertimeRule(rule)) {
        if (segment.overtimeRuleId === rule.id && paidOvertime(segment)) {
          pence.push(segment.overtimePence);
          minutes += segment.paidMinutes;
        }
      } else {
        const amount = segment.ruleAmounts.find((r) => r.ruleId === rule.id);
        if (amount !== undefined) {
          pence.push(amount.pence);
          minutes += segment.paidMinutes;
        }
      }
    }
    const total = sumPence(pence);
    if (total !== 0 || minutes !== 0) {
      byRule.push({ ruleId: rule.id, ruleName: rule.name, type: rule.type, hours: minutes / 60, pence: total });
    }
  }

  return {
    grossPence: sum((b) => b.totalGrossPence),
    basePence: sum((b) => b.basePence),
    premiumPence: sum((b) => b.premiumPence),
    overtimePence: sum((b) => b.overtimePence),
    paidHours: minutesOf(segments) / 60,
    overtimeHours: minutesOf(segments.filter(paidOvertime)) / 60,
    byRule,
  };
}

/** Earned pay of `job` by London calendar month, from `from` to `to` inclusive. */
export function monthlyStats({ shifts, job, rules, bankHolidays, from, to, now }: MonthlyStatsInput): MonthlyStats {
  // Validates both months (throws on an invalid one).
  const first = addLocalDays(`${from}-01`, 0).slice(0, 7);
  const last = addLocalDays(`${to}-01`, 0).slice(0, 7);
  const months: LocalMonth[] = [];
  for (let m = first; m <= last; m = nextMonth(m)) months.push(m);

  const jobRules = rules.filter((r) => r.jobId === job.id);
  const counted: ShiftBreakdown[] = [];
  const monthOf = new Map<string, LocalMonth>();
  if (months.length > 0) {
    const rangeStart: LocalDate = `${months[0]}-01`;
    const rangeEnd = addLocalDays(`${nextMonth(months[months.length - 1])}-01`, -1);
    const byId = new Map(shifts.filter((s) => s.jobId === job.id).map((s) => [s.id, s]));
    for (const period of periodsBetween(job, rangeStart, rangeEnd)) {
      for (const breakdown of calculateShifts(shifts, job, jobRules, bankHolidays, period)) {
        // Every breakdown comes from one of the job's shifts.
        const shift = byId.get(breakdown.shiftId) as Shift;
        if (shift.date < rangeStart || shift.date > rangeEnd) continue;
        if (minutesBetween(shift.end, now) < 0) continue; // not ended yet
        counted.push(breakdown);
        monthOf.set(breakdown.shiftId, shift.date.slice(0, 7));
      }
    }
  }

  return {
    months: months.map((month) => ({
      month,
      ...summarise(
        counted.filter((b) => monthOf.get(b.shiftId) === month),
        jobRules,
      ),
    })),
    totals: summarise(counted, jobRules),
    hasData: counted.some((b) => b.totalGrossPence !== 0),
  };
}
