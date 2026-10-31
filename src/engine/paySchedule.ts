/**
 * Pay schedule from what the user knows (onboarding step 2), and a new Job
 * with sensible defaults.
 *
 * The user gives the pay frequency, the next pay date and the last day of the
 * period that pay covers (monthly: the cut-off day instead). These convert to
 * the stored `payPeriodAnchorDate`, `payDayOffsetDays` and `periodCutoffDay`
 * so that `payDate(periodContaining(periodEnd, job), job) === nextPayDate`.
 */
import { FIXED_LENGTH_DAYS, monthlyPeriod } from './payPeriods';
import { addLocalDays, localDaysBetween } from './time';
import type { Job, LocalDate, PayFrequency } from './types';

export interface PayScheduleInput {
  payFrequency: PayFrequency;
  nextPayDate: LocalDate;
  /** Last day of the period the next pay covers. Ignored for monthly. */
  periodEndDate: LocalDate;
  /** Monthly cut-off day, 1-31 (required for monthly, ignored otherwise). */
  periodCutoffDay?: number;
}

export type PayScheduleError = 'end_after_pay' | 'offset_too_large' | 'cutoff_out_of_range' | 'cutoff_missing';

export type PayScheduleFields = Pick<Job, 'payFrequency' | 'payPeriodAnchorDate' | 'payDayOffsetDays' | 'periodCutoffDay'>;

/** Largest allowed gap from period end to pay day. */
const MAX_OFFSET_DAYS = 31;

/** Statutory minimum holiday: 5.6 weeks. */
const HOLIDAY_WEEKS = 5.6;
const DEFAULT_CONTRACTED_HOURS = 39;

/** Problems with the input; an empty array means it is valid. Throws on an invalid date string. */
export function validatePaySchedule(input: PayScheduleInput): PayScheduleError[] {
  const errors: PayScheduleError[] = [];
  const pay = addLocalDays(input.nextPayDate, 0); // throws on an invalid date
  if (input.payFrequency === 'monthly') {
    const cutoff = input.periodCutoffDay;
    if (cutoff === undefined) errors.push('cutoff_missing');
    else if (!Number.isInteger(cutoff) || cutoff < 1 || cutoff > 31) errors.push('cutoff_out_of_range');
    return errors;
  }
  const end = addLocalDays(input.periodEndDate, 0);
  if (end > pay) errors.push('end_after_pay');
  else if (localDaysBetween(end, pay) > MAX_OFFSET_DAYS) errors.push('offset_too_large');
  return errors;
}

/** The Job's pay-schedule fields for the input. Throws if `validatePaySchedule` reports any error. */
export function paySchedule(input: PayScheduleInput): PayScheduleFields {
  const errors = validatePaySchedule(input);
  if (errors.length > 0) throw new Error(`Invalid pay schedule: ${errors.join(', ')}`);
  const { payFrequency, nextPayDate, periodEndDate } = input;

  if (payFrequency === 'monthly') {
    const cutoffDay = input.periodCutoffDay as number;
    // The period containing the pay date ends on or after it; if after, the
    // pay date belongs to the previous period's pay.
    const containing = monthlyPeriod(nextPayDate, cutoffDay);
    const period =
      containing.end === nextPayDate ? containing : monthlyPeriod(addLocalDays(containing.start, -1), cutoffDay);
    return {
      payFrequency,
      payPeriodAnchorDate: period.start,
      payDayOffsetDays: localDaysBetween(period.end, nextPayDate),
      periodCutoffDay: cutoffDay,
    };
  }

  return {
    payFrequency,
    payPeriodAnchorDate: addLocalDays(periodEndDate, 1 - FIXED_LENGTH_DAYS[payFrequency]),
    payDayOffsetDays: localDaysBetween(periodEndDate, nextPayDate),
    periodCutoffDay: Number(periodEndDate.slice(8)),
  };
}

/** A new Job without its pay-schedule fields (see `paySchedule`), with defaults. */
export function newJobDefaults(args: {
  id: string;
  name: string;
  baseRatePence: number;
  today: LocalDate;
}): Omit<Job, 'payFrequency' | 'payPeriodAnchorDate' | 'payDayOffsetDays' | 'periodCutoffDay'> {
  const today = addLocalDays(args.today, 0); // throws on an invalid date
  return {
    id: args.id,
    name: args.name,
    baseRatePence: args.baseRatePence,
    contractedHoursPerWeek: DEFAULT_CONTRACTED_HOURS,
    bankHolidayRegion: 'england-and-wales',
    overtimePremiumMode: 'highest',
    holidayYearStart: `${today.slice(0, 4)}-01-01`,
    // Rounded to 2 dp: 5.6 * 39 is 218.39999999999998 in floating point.
    holidayEntitlementHours: Math.round(HOLIDAY_WEEKS * DEFAULT_CONTRACTED_HOURS * 100) / 100,
    holidayMode: 'fixed',
  };
}
