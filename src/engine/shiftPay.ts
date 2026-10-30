/**
 * Pay for shifts (SPEC §5 items 4, 5, 7): segment each shift, attach base pay,
 * premiums and overtime, then total the segments. Totals are sums of rounded
 * segment pence (`sumPence()`), never re-rounded.
 *
 * Status: `cancelled` -> no segments; `sick` / `holiday` -> base rate only.
 * Only `worked` and `planned` paid minutes count towards OT thresholds (D2).
 * Only rules and shifts with `jobId === job.id` are used; other jobs' shifts
 * count towards no threshold and are not returned.
 */
import type { BankHolidayLookup } from './bankHolidays';
import { sumPence } from './money';
import { applyOvertime, isOvertimeRule, overtimeTail, topOvertimeRule, weekStart } from './overtime';
import type { OvertimeTails } from './overtime';
import { applyPremiums } from './premiums';
import { segmentShift } from './segment';
import { minutesBetween } from './time';
import type {
  Job,
  LocalDate,
  OvertimeRule,
  PremiumRule,
  Segment,
  SegmentSlice,
  Shift,
  ShiftBreakdown,
  TimeBandRule,
} from './types';

/** Shift totals from its paid segments. */
function totals(shiftId: string, segments: Segment[]): ShiftBreakdown {
  const sum = (pick: (s: Segment) => number) => sumPence(segments.map(pick));
  const paidMinutes = segments.reduce((acc, s) => acc + s.paidMinutes, 0);
  return {
    shiftId,
    segments,
    basePence: sum((s) => s.basePence),
    premiumPence: sum((s) => s.premiumPence),
    overtimePence: sum((s) => s.overtimePence),
    totalGrossPence: sum((s) => s.totalPence),
    paidHours: paidMinutes / 60,
  };
}

/** D2: only worked / planned hours get OT and count towards thresholds. */
function countsTowardsOvertime(shift: Shift): boolean {
  return shift.status === 'worked' || shift.status === 'planned';
}

/** One shift being priced: its slices, paid minutes and OT tails so far. */
interface Item {
  shift: Shift;
  slices: SegmentSlice[];
  paidMinutes: number;
  tails: OvertimeTails;
}

function prepare(shift: Shift, job: Job, rules: PremiumRule[], bankHolidays: BankHolidayLookup): Item {
  const timeBands = rules.filter((r): r is TimeBandRule => r.type === 'time_band');
  const slices =
    shift.status === 'cancelled'
      ? []
      : segmentShift(shift, { timeBands, region: job.bankHolidayRegion, bankHolidays });
  const paidMinutes = slices.reduce((acc, s) => acc + s.paidMinutes, 0);
  const tails: OvertimeTails = new Map();
  for (const rule of rules) {
    if (rule.type === 'overtime_daily') tails.set(rule.id, overtimeTail(paidMinutes, 0, rule.thresholdHours));
  }
  return { shift, slices, paidMinutes, tails };
}

/** overtimeFlag: every paid minute is OT under the job's highest-uplift OT rule (none -> no change). */
function applyFlag(item: Item, otRules: OvertimeRule[], job: Job): void {
  if (!item.shift.overtimeFlag) return;
  const top = topOvertimeRule(otRules, job.baseRatePence);
  if (top !== undefined) item.tails.set(top.id, item.paidMinutes);
}

function pay(item: Item, job: Job, rules: PremiumRule[]): ShiftBreakdown {
  const segments = countsTowardsOvertime(item.shift)
    ? applyOvertime(item.slices, job, rules, item.tails)
    : applyPremiums(item.slices, job, []);
  return totals(item.shift.id, segments);
}

/**
 * Pay breakdown for one `shift`, using the job's base rate and bank-holiday
 * region. Applies premiums and daily OT (plus `overtimeFlag`); weekly and
 * period OT need several shifts, see `calculateShifts`.
 */
export function calculateShift(
  shift: Shift,
  job: Job,
  rules: PremiumRule[],
  bankHolidays: BankHolidayLookup,
): ShiftBreakdown {
  const jobRules = rules.filter((r) => r.jobId === job.id);
  const item = prepare(shift, job, jobRules, bankHolidays);
  applyFlag(item, jobRules.filter(isOvertimeRule), job);
  return pay(item, job, jobRules);
}

/** Inclusive range of local dates. */
export interface DateRange {
  start: LocalDate;
  end: LocalDate;
}

/**
 * Pay breakdowns for the shifts dated within `period` (input order), with
 * daily, weekly and period OT. A shift belongs to the week of `shift.date`;
 * thresholds are counted chronologically (by start). Shifts dated before
 * `period.start` are not returned but count towards weekly OT of their week;
 * period OT counts only in-period shifts.
 */
export function calculateShifts(
  shifts: Shift[],
  job: Job,
  rules: PremiumRule[],
  bankHolidays: BankHolidayLookup,
  period: DateRange,
): ShiftBreakdown[] {
  const jobRules = rules.filter((r) => r.jobId === job.id);
  const otRules = jobRules.filter(isOvertimeRule);
  const items = shifts
    .filter((shift) => shift.jobId === job.id)
    .map((shift) => prepare(shift, job, jobRules, bankHolidays));
  const inPeriod = (item: Item) => item.shift.date >= period.start && item.shift.date <= period.end;
  // Array.prototype.sort is stable: equal starts keep input order.
  const counting = items
    .filter((item) => countsTowardsOvertime(item.shift))
    .sort((a, b) => minutesBetween(b.shift.start, a.shift.start));

  for (const rule of otRules) {
    if (rule.type === 'overtime_weekly') {
      const counted = new Map<LocalDate, number>();
      for (const item of counting) {
        const week = weekStart(item.shift.date, rule.weekStartsOn ?? 1);
        const before = counted.get(week) ?? 0;
        item.tails.set(rule.id, overtimeTail(item.paidMinutes, before, rule.thresholdHours));
        counted.set(week, before + item.paidMinutes);
      }
    } else if (rule.type === 'overtime_period') {
      let before = 0;
      for (const item of counting.filter(inPeriod)) {
        item.tails.set(rule.id, overtimeTail(item.paidMinutes, before, rule.thresholdHours));
        before += item.paidMinutes;
      }
    }
  }
  for (const item of items) applyFlag(item, otRules, job);
  return items.filter(inPeriod).map((item) => pay(item, job, jobRules));
}
