/**
 * Presenter for the Home / This period screen (SPEC §7.2): turns the engine's
 * `HomeSummary` into display strings. Pure; never reads the clock. All
 * instants are shown in Europe/London via `src/engine/time.ts`.
 */
import type { HomeSummary } from '../../engine/homeSummary';
import { formatPence } from '../../engine/money';
import { addLocalDays, instantToLocal } from '../../engine/time';
import type { LocalDate } from '../../engine/types';

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A shift starting at or after this London time today reads "Tonight", otherwise "Today". */
const TONIGHT_FROM = '17:00';

export interface HomeView {
  /** e.g. "1 Nov – 7 Nov". */
  periodLine: string;
  /** e.g. "Projected for this period £512.40". */
  projectedLine: string;
  /** Null when no shift is coming up. */
  nextShift: { when: string; pay: string } | null;
  payDay: { countdown: string; pay: string };
}

function parts(date: LocalDate): { day: number; month: string; weekday: string } {
  const [y, m, d] = date.split('-').map(Number);
  // Calendar maths only (UTC methods): no time-zone effect.
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { day: d, month: MONTH_SHORT[m - 1], weekday: DAY_SHORT[weekday] };
}

/** "1 Nov". */
export function formatShortDate(date: LocalDate): string {
  const { day, month } = parts(date);
  return `${day} ${month}`;
}

/** "Mon 3 Nov". */
export function formatDayDate(date: LocalDate): string {
  const { day, month, weekday } = parts(date);
  return `${weekday} ${day} ${month}`;
}

/** Next-shift wording relative to `today`, times in London. */
export function nextShiftWhen(next: NonNullable<HomeSummary['nextShift']>, today: LocalDate): string {
  const start = instantToLocal(next.shift.start);
  const end = instantToLocal(next.shift.end);
  if (next.inProgress) return `On now, ends ${end.time}`;
  const times = `${start.time}–${end.time}`;
  if (start.date === today) return `${start.time >= TONIGHT_FROM ? 'Tonight' : 'Today'} ${times}`;
  if (start.date === addLocalDays(today, 1)) return `Tomorrow ${times}`;
  return `${formatDayDate(start.date)} ${times}`;
}

/** "Pay day today" / "Pay day tomorrow" / "Pay day in 5 days · Fri 6 Nov". */
export function payDayCountdown(payDay: HomeSummary['nextPayDay']): string {
  if (payDay.daysAway <= 0) return 'Pay day today';
  if (payDay.daysAway === 1) return 'Pay day tomorrow';
  return `Pay day in ${payDay.daysAway} days · ${formatDayDate(payDay.date)}`;
}

export function homeView(summary: HomeSummary): HomeView {
  const { period, nextShift, nextPayDay, today } = summary;
  return {
    periodLine: `${formatShortDate(period.start)} – ${formatShortDate(period.end)}`,
    projectedLine: `Projected for this period ${formatPence(summary.projectedPence)}`,
    nextShift:
      nextShift === null
        ? null
        : { when: nextShiftWhen(nextShift, today), pay: formatPence(nextShift.totalGrossPence) },
    payDay: { countdown: payDayCountdown(nextPayDay), pay: formatPence(nextPayDay.expectedPence) },
  };
}
