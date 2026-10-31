/**
 * Holiday screen view model (SPEC §5 Holiday). Pure: turns a `HolidaySummary`
 * into labels, rows and entitlement-ring fractions. Dates are formatted by
 * splitting the LocalDate string; no Date is ever built.
 */
import { MONTH_NAMES } from './calendarMonth';
import { ACCRUAL_RATE } from './holiday';
import { clearNoise } from './money';
import type { HolidayMode, HolidaySummary, LocalDate } from './types';

export type HolidayRowKey = 'entitled' | 'accrued' | 'taken' | 'booked' | 'remaining';

export interface HolidayRow {
  key: HolidayRowKey;
  label: string;
  /** Decimal hours (remaining may be negative). */
  hours: number;
}

export interface HolidayRing {
  /** taken / entitled, clamped to 0..1. */
  takenFraction: number;
  /** booked / entitled, clamped so takenFraction + bookedFraction <= 1. */
  bookedFraction: number;
}

export interface HolidayView {
  /** `1 Apr 2026 – 31 Mar 2027`. */
  yearLabel: string;
  /** `Fixed entitlement` or `Accrues at 12.07% of hours worked`. */
  modeLabel: string;
  ring: HolidayRing;
  /** entitled - taken - booked; negative when over-booked. */
  remainingHours: number;
  /** `42.5 h left` or `3 h over`. */
  remainingLabel: string;
  rows: HolidayRow[];
}

/** Hours with at most 2 decimals and no trailing zeros: `37.5 h`, `8 h`. */
export function formatHolidayHours(hours: number): string {
  return `${Number(clearNoise(hours).toFixed(2))} h`;
}

/** `2026-04-01` -> `1 Apr 2026`. */
function formatYearDate(date: LocalDate): string {
  const [year, month, day] = date.split('-');
  return `${Number(day)} ${MONTH_NAMES[Number(month) - 1].slice(0, 3)} ${Number(year)}`;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function ring(summary: HolidaySummary): HolidayRing {
  if (summary.entitled <= 0) return { takenFraction: 0, bookedFraction: 0 };
  const takenFraction = clamp01(summary.taken / summary.entitled);
  const bookedFraction = Math.min(clamp01(summary.booked / summary.entitled), 1 - takenFraction);
  return { takenFraction, bookedFraction };
}

/** Everything the holiday screen shows for one holiday year. */
export function holidayView(summary: HolidaySummary, mode: HolidayMode): HolidayView {
  const remaining = summary.remaining;
  const rows: HolidayRow[] = [{ key: 'entitled', label: 'Entitled', hours: summary.entitled }];
  if (mode === 'fixed') {
    rows.push({ key: 'accrued', label: 'Accrued so far', hours: summary.accrued });
  }
  rows.push(
    { key: 'taken', label: 'Taken', hours: summary.taken },
    { key: 'booked', label: 'Booked', hours: summary.booked },
    { key: 'remaining', label: 'Remaining', hours: remaining },
  );
  return {
    yearLabel: `${formatYearDate(summary.yearStart)} – ${formatYearDate(summary.yearEnd)}`,
    modeLabel:
      mode === 'fixed'
        ? 'Fixed entitlement'
        : `Accrues at ${clearNoise(ACCRUAL_RATE * 100)}% of hours worked`,
    ring: ring(summary),
    remainingHours: remaining,
    remainingLabel:
      remaining < 0
        ? `${formatHolidayHours(-remaining)} over`
        : `${formatHolidayHours(remaining)} left`,
    rows,
  };
}
