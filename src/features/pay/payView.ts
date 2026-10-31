/**
 * Display strings shared by the Pay tab and the period detail screen. Pure;
 * never reads the clock ("today" is passed in).
 */
import type { LocalDate } from '../../engine/types';
import { formatDayDate, formatShortDate } from '../home/homeView';

/** "1 Nov – 30 Nov" (as Home's period line). */
export function periodRangeLabel(start: LocalDate, end: LocalDate): string {
  return `${formatShortDate(start)} – ${formatShortDate(end)}`;
}

/** "Paid Fri 5 Dec" once the pay date has passed, otherwise "Pay day Fri 5 Dec". */
export function payDayLine(payDate: LocalDate, today: LocalDate): string {
  return `${payDate < today ? 'Paid' : 'Pay day'} ${formatDayDate(payDate)}`;
}

/** "8 h", "7.5 h", "0.33 h". Display only. */
export function formatHours(hours: number): string {
  return `${Number(hours.toFixed(2))} h`;
}

/** "37.5 h · 5 shifts" / "8 h · 1 shift". */
export function hoursAndShifts(hours: number, shiftCount: number): string {
  return `${formatHours(hours)} · ${shiftCount} ${shiftCount === 1 ? 'shift' : 'shifts'}`;
}
