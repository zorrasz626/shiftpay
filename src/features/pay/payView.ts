/**
 * Display strings shared by the Pay tab and the period detail screen. Pure;
 * never reads the clock ("today" is passed in).
 */
import { MINUS_SIGN } from '../../engine/money';
import { periodContaining } from '../../engine/payPeriods';
import type { DateRange } from '../../engine/shiftPay';
import type { Job, LocalDate } from '../../engine/types';
import { formatDayDate, formatShortDate } from '../home/homeView';

/** "1 Nov – 30 Nov" (as Home's period line). */
export function periodRangeLabel(start: LocalDate, end: LocalDate): string {
  return `${formatShortDate(start)} – ${formatShortDate(end)}`;
}

/** "Paid Fri 5 Dec" once the pay date has passed, otherwise "Pay day Fri 5 Dec". */
export function payDayLine(payDate: LocalDate, today: LocalDate): string {
  return `${payDate < today ? 'Paid' : 'Pay day'} ${formatDayDate(payDate)}`;
}

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The period a `[start]` route param names, or null unless it is a real period
 * start whose whole period is loaded (else totals would be partial).
 */
export function loadedPeriodAt(
  start: unknown,
  job: Job | undefined,
  range: DateRange | null,
): DateRange | null {
  if (job === undefined || range === null || typeof start !== 'string') return null;
  if (!LOCAL_DATE.test(start)) return null;
  const p = periodContaining(start, job);
  return p.start === start && p.start >= range.start && p.end <= range.end ? p : null;
}

/** "8 h", "7.5 h", "0.33 h". Display only. */
export function formatHours(hours: number): string {
  return `${Number(hours.toFixed(2))} h`;
}

/** Signed hours difference: `1.5` -> `+1.5 h`, `-2` -> `−2 h`, `0` -> `0 h`. */
export function formatSignedHours(hours: number): string {
  const text = formatHours(Math.abs(hours));
  if (text === formatHours(0)) return text;
  return `${hours > 0 ? '+' : MINUS_SIGN}${text}`;
}

/** "37.5 h · 5 shifts" / "8 h · 1 shift". */
export function hoursAndShifts(hours: number, shiftCount: number): string {
  return `${formatHours(hours)} · ${shiftCount} ${shiftCount === 1 ? 'shift' : 'shifts'}`;
}
