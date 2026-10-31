/**
 * Numbers for the Home / This period screen (SPEC §7.2): gross so far,
 * projected total, next shift and the pay-day countdown. Pure: "now" is
 * passed in; the screen only formats the result.
 *
 * Instants are compared via `minutesBetween()` (real elapsed time), never as
 * strings, so the BST/GMT change and differently formatted ISO strings are safe.
 * Pence totals are integer sums of the engine's shift totals, never re-rounded.
 */
import type { BankHolidayLookup } from './bankHolidays';
import { sumPence } from './money';
import { aggregatePeriod, payDate, periodContaining } from './payPeriods';
import { calculateShifts } from './shiftPay';
import type { DateRange } from './shiftPay';
import { addLocalDays, instantToLocal, localDaysBetween, minutesBetween } from './time';
import type { IsoInstant, Job, LocalDate, PeriodBreakdown, PremiumRule, Shift, ShiftBreakdown } from './types';

export interface HomeNextShift {
  shift: Shift;
  /** The shift has started (start <= now) but not ended. */
  inProgress: boolean;
  /** The shift's expected gross, computed within its own pay period (so OT is right). */
  totalGrossPence: number;
}

export interface HomeNextPayDay {
  date: LocalDate;
  /** Calendar days from today to `date` (0 on pay day). */
  daysAway: number;
  /** The pay period this pay day covers. */
  period: DateRange;
  /** That period's expected gross. */
  expectedPence: number;
}

export interface HomeSummary {
  /** London date of `now`. */
  today: LocalDate;
  /** The pay period containing today. */
  period: DateRange;
  /** Expected gross for the whole current period. */
  projectedPence: number;
  /** Gross for the current period's shifts that have ended (end <= now). */
  earnedSoFarPence: number;
  /** Paid hours for those same shifts. */
  paidHoursSoFar: number;
  /** Earliest planned/worked shift of this job that has not ended; null if none. */
  nextShift: HomeNextShift | null;
  nextPayDay: HomeNextPayDay;
}

export interface HomeSummaryInput {
  shifts: Shift[];
  job: Job;
  rules: PremiumRule[];
  bankHolidays: BankHolidayLookup;
  now: IsoInstant;
}

/** True if instant `a` is at or before instant `b`. */
const atOrBefore = (a: IsoInstant, b: IsoInstant) => minutesBetween(a, b) >= 0;

const NEXT_SHIFT_STATUSES: ReadonlySet<Shift['status']> = new Set(['planned', 'worked']);

/**
 * The Home summary for `job` at `now`. Pass all of the job's shifts (earlier
 * shifts still count to weekly OT). Assumes `payDayOffsetDays >= 0` (as
 * `validatePaySchedule` enforces), so the current period's pay date is never
 * before today.
 */
export function homeSummary({ shifts, job, rules, bankHolidays, now }: HomeSummaryInput): HomeSummary {
  const today = instantToLocal(now).date;
  const period = periodContaining(today, job);
  const current = aggregatePeriod(shifts, job, rules, bankHolidays, period);

  const ended = new Set(shifts.filter((s) => s.jobId === job.id && atOrBefore(s.end, now)).map((s) => s.id));
  const done = current.shifts.filter((b) => ended.has(b.shiftId));
  const doneMinutes = done.flatMap((b) => b.segments).reduce((acc, s) => acc + s.paidMinutes, 0);

  return {
    today,
    period,
    projectedPence: current.totalGrossPence,
    earnedSoFarPence: sumPence(done.map((b) => b.totalGrossPence)),
    paidHoursSoFar: doneMinutes / 60,
    nextShift: findNextShift(shifts, job, rules, bankHolidays, now),
    nextPayDay: findNextPayDay(shifts, job, rules, bankHolidays, today, current),
  };
}

function findNextShift(
  shifts: Shift[],
  job: Job,
  rules: PremiumRule[],
  bankHolidays: BankHolidayLookup,
  now: IsoInstant,
): HomeNextShift | null {
  const candidates = shifts.filter(
    (s) => s.jobId === job.id && NEXT_SHIFT_STATUSES.has(s.status) && !atOrBefore(s.end, now),
  );
  if (candidates.length === 0) return null;
  const shift = candidates.reduce((best, s) => (minutesBetween(s.start, best.start) > 0 ? s : best));
  const ownPeriod = periodContaining(shift.date, job);
  const breakdown = calculateShifts(shifts, job, rules, bankHolidays, ownPeriod).find(
    (b) => b.shiftId === shift.id,
  ) as ShiftBreakdown;
  return { shift, inProgress: atOrBefore(shift.start, now), totalGrossPence: breakdown.totalGrossPence };
}

function findNextPayDay(
  shifts: Shift[],
  job: Job,
  rules: PremiumRule[],
  bankHolidays: BankHolidayLookup,
  today: LocalDate,
  current: PeriodBreakdown,
): HomeNextPayDay {
  // Step back while the previous period's pay date is still today or later.
  let period: DateRange = { start: current.periodStart, end: current.periodEnd };
  for (;;) {
    const previous = periodContaining(addLocalDays(period.start, -1), job);
    if (payDate(previous, job) < today) break;
    period = previous;
  }
  const date = payDate(period, job);
  const expectedPence =
    period.start === current.periodStart
      ? current.totalGrossPence
      : aggregatePeriod(shifts, job, rules, bankHolidays, period).totalGrossPence;
  return { date, daysAway: localDaysBetween(today, date), period, expectedPence };
}
