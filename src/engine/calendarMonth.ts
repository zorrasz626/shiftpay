/**
 * Month grid for the Calendar tab: Monday-first weeks padded with the
 * adjacent months' days, each day carrying its bank-holiday flag and the
 * shifts that start on it, colour-coded by kind. Pure: "today" is passed in.
 */
import type { BankHolidayLookup } from './bankHolidays';
import type { DateRange } from './shiftPay';
import { addLocalDays, instantToLocal, localDaysBetween, minutesBetween } from './time';
import type { BankHolidayRegion, DayOfWeek, LocalDate, Shift, ShiftStatus } from './types';

export type CalendarShiftKind = 'day' | 'night' | 'holiday' | 'sick' | 'cancelled' | 'overtime';

export interface CalendarShift {
  id: string;
  kind: CalendarShiftKind;
  /** Short text code shown in the cell (colour is never the only cue). */
  code: string;
  /** Full words + London times for screen readers, e.g. "Night shift 19:00–07:00, worked". */
  label: string;
}

export interface CalendarDay {
  date: LocalDate;
  dayOfMonth: number;
  inMonth: boolean;
  isToday: boolean;
  isBankHoliday: boolean;
  shifts: CalendarShift[];
}

export interface CalendarMonth {
  /** e.g. "October 2026". */
  title: string;
  /** Weeks of 7 days, Monday to Sunday. */
  weeks: CalendarDay[][];
}

export interface CalendarMonthInput {
  year: number;
  /** 1-12. */
  month: number;
  shifts: readonly Shift[];
  bankHolidays: BankHolidayLookup;
  region: BankHolidayRegion;
  today: LocalDate;
}

/** Month names, index 0 = January. */
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Weekday names, index = `DayOfWeek` (0 = Sunday). */
export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** Three-letter weekday names ("Sun", "Mon", ...), index = `DayOfWeek`. */
export const DAY_SHORT: readonly string[] = DAY_NAMES.map((name) => name.slice(0, 3));

/** Days of the week Monday first, as UK rotas are usually written. */
export const MONDAY_FIRST: readonly DayOfWeek[] = [1, 2, 3, 4, 5, 6, 0];

/** A known Monday, for weekday arithmetic without `Date#getDay`. */
const REFERENCE_MONDAY: LocalDate = '2001-01-01';

const NIGHT_START = '18:00';

const KIND_CODE: Record<CalendarShiftKind, string> = {
  day: 'D',
  night: 'N',
  holiday: 'H',
  sick: 'S',
  cancelled: 'X',
  overtime: 'OT',
};

const KIND_WORDS: Record<CalendarShiftKind, string> = {
  day: 'Day shift',
  night: 'Night shift',
  holiday: 'Holiday',
  sick: 'Sick',
  cancelled: 'Cancelled shift',
  overtime: 'Overtime shift',
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** The month `n` months after (or before, if negative) `year`/`month`. */
export function addMonths(year: number, month: number, n: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + n;
  const y = Math.floor(total / 12);
  return { year: y, month: total - y * 12 + 1 };
}

/** First and last London dates of the month, both inclusive. */
export function monthRange(year: number, month: number): DateRange {
  const start = `${String(year).padStart(4, '0')}-${pad2(month)}-01`;
  const next = addMonths(year, month, 1);
  const nextStart = `${String(next.year).padStart(4, '0')}-${pad2(next.month)}-01`;
  return { start, end: addLocalDays(nextStart, -1) };
}

/** 0 = Monday ... 6 = Sunday. */
function mondayIndex(date: LocalDate): number {
  const days = localDaysBetween(REFERENCE_MONDAY, date);
  return ((days % 7) + 7) % 7;
}

function shiftKind(shift: Shift, startTime: string, endDate: LocalDate): CalendarShiftKind {
  const byStatus: Partial<Record<ShiftStatus, CalendarShiftKind>> = {
    cancelled: 'cancelled',
    holiday: 'holiday',
    sick: 'sick',
  };
  const status = byStatus[shift.status];
  if (status !== undefined) return status;
  if (shift.overtimeFlag) return 'overtime';
  if (endDate > shift.date || startTime >= NIGHT_START) return 'night';
  return 'day';
}

function toCalendarShift(shift: Shift): CalendarShift {
  const start = instantToLocal(shift.start);
  const end = instantToLocal(shift.end);
  const kind = shiftKind(shift, start.time, end.date);
  const times = `${start.time}–${end.time}`;
  const withStatus = kind === 'day' || kind === 'night' || kind === 'overtime';
  const label = `${KIND_WORDS[kind]} ${times}${withStatus ? `, ${shift.status}` : ''}`;
  return { id: shift.id, kind, code: KIND_CODE[kind], label };
}

export function calendarMonth(input: CalendarMonthInput): CalendarMonth {
  const { year, month, bankHolidays, region, today } = input;
  const { start, end } = monthRange(year, month);
  const gridStart = addLocalDays(start, -mondayIndex(start));
  const gridEnd = addLocalDays(end, 6 - mondayIndex(end));

  const byDate = new Map<LocalDate, Shift[]>();
  for (const shift of input.shifts) {
    if (shift.date < gridStart || shift.date > gridEnd) continue;
    const list = byDate.get(shift.date) ?? [];
    list.push(shift);
    byDate.set(shift.date, list);
  }

  const weeks: CalendarDay[][] = [];
  const weekCount = (localDaysBetween(gridStart, gridEnd) + 1) / 7;
  for (let w = 0; w < weekCount; w++) {
    const week: CalendarDay[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addLocalDays(gridStart, w * 7 + d);
      const shifts = [...(byDate.get(date) ?? [])]
        .sort((a, b) => minutesBetween(b.start, a.start))
        .map(toCalendarShift);
      week.push({
        date,
        dayOfMonth: Number(date.slice(8, 10)),
        inMonth: date >= start && date <= end,
        isToday: date === today,
        isBankHoliday: bankHolidays.isBankHoliday(region, date),
        shifts,
      });
    }
    weeks.push(week);
  }

  return { title: `${MONTH_NAMES[month - 1]} ${year}`, weeks };
}
