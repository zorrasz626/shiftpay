/**
 * Holiday maths (SPEC §5 Holiday). Pure: `today` is always passed in.
 *
 * The holiday year runs from an anniversary of `holidayYearStart` (29 Feb
 * clamps to 28 Feb in non-leap years) to the day before the next one.
 * Hours are paid minutes (elapsed - unpaid break, never negative), summed as
 * integer minutes and divided by 60 once.
 *
 * fixed: entitled = `holidayEntitlementHours`; accrued = entitled x days
 * elapsed (year start through today, inclusive) / days in the year.
 * accrual: accrued = entitled = 12.07% of the hours worked so far: `worked`
 * shifts dated on or before today, plus `planned` shifts dated before today
 * (rota shifts stay `planned` after they end; with only a LocalDate, a planned
 * shift dated before today counts as ended, including an overnight one that
 * finishes today). Sick, holiday and cancelled hours never accrue.
 */
import { clearNoise } from './money';
import { addLocalDays, localDaysBetween, minutesBetween } from './time';
import type { HolidaySummary, Job, LocalDate, Shift } from './types';

/**
 * Statutory accrual rate for irregular-hours workers (5.6 weeks / 46.4 weeks).
 * Checked 2026-11-21: https://www.gov.uk/holiday-entitlement-rights/calculate-leave-entitlement
 * (leave years from 1 April 2024). gov.uk rounds each pay period's accrual to
 * the nearest hour; this estimate accrues continuously, unrounded.
 */
export const ACCRUAL_RATE = 0.1207;

/** The anniversary of `start` in `year`, clamped to the month's length (29 Feb -> 28 Feb). */
function anniversaryIn(start: LocalDate, year: number): LocalDate {
  const yearMonth = `${String(year).padStart(4, '0')}${start.slice(4, 8)}`; // "YYYY-MM-"
  // The 28th + 4 days is always in the next month; its 1st - 1 day is this month's last day.
  const nextMonth = addLocalDays(`${yearMonth}28`, 4).slice(0, 8);
  const monthLength = Number(addLocalDays(`${nextMonth}01`, -1).slice(8));
  const day = Math.min(Number(start.slice(8)), monthLength);
  return `${yearMonth}${String(day).padStart(2, '0')}`;
}

function paidMinutes(shift: Shift): number {
  return Math.max(0, minutesBetween(shift.start, shift.end) - shift.unpaidBreakMinutes);
}

/**
 * First and last day (both inclusive) of the holiday year containing `today`.
 * Throws on an invalid `today`.
 */
export function holidayYearRange(
  job: Pick<Job, 'holidayYearStart'>,
  today: LocalDate,
): { start: LocalDate; end: LocalDate } {
  const checked = addLocalDays(today, 0); // throws on an invalid date
  const year = Number(checked.slice(0, 4));
  const thisYears = anniversaryIn(job.holidayYearStart, year);
  const startYear = checked < thisYears ? year - 1 : year;
  return {
    start: anniversaryIn(job.holidayYearStart, startYear),
    end: addLocalDays(anniversaryIn(job.holidayYearStart, startYear + 1), -1),
  };
}

/** Holiday position for the holiday year containing `today`. */
export function holidaySummary(job: Job, shifts: Shift[], today: LocalDate): HolidaySummary {
  const checked = addLocalDays(today, 0); // throws on an invalid date
  const { start: yearStart, end: yearEnd } = holidayYearRange(job, checked);

  let takenMinutes = 0;
  let bookedMinutes = 0;
  let workedMinutes = 0;
  for (const shift of shifts) {
    if (shift.jobId !== job.id || shift.date < yearStart || shift.date > yearEnd) continue;
    if (shift.status === 'holiday') {
      if (shift.date < checked) takenMinutes += paidMinutes(shift);
      else bookedMinutes += paidMinutes(shift);
    } else if (
      (shift.status === 'worked' && shift.date <= checked) ||
      (shift.status === 'planned' && shift.date < checked)
    ) {
      workedMinutes += paidMinutes(shift);
    }
  }

  let entitled: number;
  let accrued: number;
  if (job.holidayMode === 'accrual') {
    accrued = clearNoise((workedMinutes * ACCRUAL_RATE) / 60);
    entitled = accrued;
  } else {
    entitled = clearNoise(job.holidayEntitlementHours);
    const daysInYear = localDaysBetween(yearStart, yearEnd) + 1;
    const daysElapsed = localDaysBetween(yearStart, checked) + 1;
    accrued = clearNoise((entitled * daysElapsed) / daysInYear);
  }
  const taken = clearNoise(takenMinutes / 60);
  const booked = clearNoise(bookedMinutes / 60);
  return {
    yearStart,
    yearEnd,
    entitled,
    accrued,
    booked,
    taken,
    remaining: clearNoise(entitled - taken - booked),
  };
}
