/**
 * The only module in the engine that converts between UTC instants and
 * Europe/London wall-clock time. Everything else works in `IsoInstant`,
 * `LocalDate` and `WallClockTime` and calls these helpers.
 *
 * Never relies on the device time zone: zone maths uses `@date-fns/tz`
 * (D9), plain calendar maths uses UTC-only `Date` methods.
 */
import { TZDate, tzOffset } from '@date-fns/tz';

import type { DayOfWeek, IsoInstant, LocalDate, WallClockTime } from './types';

export const LONDON_TZ = 'Europe/London';

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const WALL_CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface LocalDateTime {
  date: LocalDate;
  time: WallClockTime;
  dayOfWeek: DayOfWeek;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function parseLocalDate(date: LocalDate): [number, number, number] {
  const m = LOCAL_DATE_RE.exec(date);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const check = new Date(Date.UTC(y, mo - 1, d));
    if (check.getUTCFullYear() === y && check.getUTCMonth() === mo - 1 && check.getUTCDate() === d) {
      return [y, mo, d];
    }
  }
  throw new Error(`Invalid LocalDate: ${date}`);
}

function parseWallClock(time: WallClockTime): [number, number] {
  const m = WALL_CLOCK_RE.exec(time);
  if (!m) throw new Error(`Invalid WallClockTime: ${time}`);
  return [Number(m[1]), Number(m[2])];
}

function parseInstant(instant: IsoInstant): number {
  const ms = Date.parse(instant);
  if (Number.isNaN(ms)) throw new Error(`Invalid IsoInstant: ${instant}`);
  return ms;
}

function toInstant(ms: number): IsoInstant {
  return new Date(ms).toISOString();
}

function offsetAtMs(ms: number): number {
  return tzOffset(LONDON_TZ, new Date(ms));
}

/** London UTC offset in minutes at the instant (0 in GMT, 60 in BST). */
export function utcOffsetMinutes(instant: IsoInstant): number {
  return offsetAtMs(parseInstant(instant));
}

/**
 * London wall-clock date + time -> UTC instant (D4).
 * - A non-existent time (spring-forward gap) moves forward by the gap:
 *   01:30 on 29 Mar 2026 -> 02:30 BST (01:30Z).
 * - An ambiguous time (autumn repeat) uses the first occurrence:
 *   01:30 on 25 Oct 2026 -> 01:30 BST (00:30Z).
 */
export function localToInstant(date: LocalDate, time: WallClockTime): IsoInstant {
  const [y, mo, d] = parseLocalDate(date);
  const [h, mi] = parseWallClock(time);
  // The wall-clock reading as if it were UTC.
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const offsetBefore = offsetAtMs(naive - MS_PER_DAY);
  const offsetAfter = offsetAtMs(naive + MS_PER_DAY);
  const valid = [offsetBefore, offsetAfter]
    .map((offset) => ({ offset, ms: naive - offset * MS_PER_MINUTE }))
    .filter(({ offset, ms }) => offsetAtMs(ms) === offset)
    .map(({ ms }) => ms);
  // No valid reading -> the time falls in the gap: shift it forward by the gap
  // length, i.e. read it with the offset in force before the change.
  const ms = valid.length > 0 ? Math.min(...valid) : naive - offsetBefore * MS_PER_MINUTE;
  return toInstant(ms);
}

/** UTC instant -> London date, wall-clock time (seconds truncated) and day of week. */
export function instantToLocal(instant: IsoInstant): LocalDateTime {
  const local = new TZDate(parseInstant(instant), LONDON_TZ);
  return {
    date: `${pad(local.getFullYear(), 4)}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`,
    time: `${pad(local.getHours())}:${pad(local.getMinutes())}`,
    dayOfWeek: local.getDay() as DayOfWeek,
  };
}

/** Instant of local 00:00 on the given London date. */
export function startOfLocalDay(date: LocalDate): IsoInstant {
  return localToInstant(date, '00:00');
}

/** Calendar arithmetic on a London date (no time-zone effect). */
export function addLocalDays(date: LocalDate, n: number): LocalDate {
  const [y, mo, d] = parseLocalDate(date);
  return toInstant(Date.UTC(y, mo - 1, d + n)).slice(0, 10);
}

/** Calendar days from London date `a` to `b` (negative if `b` is earlier; no time-zone effect). */
export function localDaysBetween(a: LocalDate, b: LocalDate): number {
  const [ya, ma, da] = parseLocalDate(a);
  const [yb, mb, db] = parseLocalDate(b);
  return (Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / MS_PER_DAY;
}

/** Real elapsed minutes from `a` to `b` (negative if `b` is earlier). */
export function minutesBetween(a: IsoInstant, b: IsoInstant): number {
  return (parseInstant(b) - parseInstant(a)) / MS_PER_MINUTE;
}

/** The instant `minutes` real elapsed minutes after `instant` (negative = earlier). */
export function addMinutes(instant: IsoInstant, minutes: number): IsoInstant {
  return toInstant(parseInstant(instant) + minutes * MS_PER_MINUTE);
}

/** Length of the London day: 1440 normally, 1380 on GMT->BST, 1500 on BST->GMT. */
export function localDayLengthMinutes(date: LocalDate): number {
  return minutesBetween(startOfLocalDay(date), startOfLocalDay(addLocalDays(date, 1)));
}

/** Instants of every London 00:00 strictly between `start` and `end`. */
export function nextLocalMidnights(start: IsoInstant, end: IsoInstant): IsoInstant[] {
  const endMs = parseInstant(end);
  const result: IsoInstant[] = [];
  let day = addLocalDays(instantToLocal(start).date, 1);
  let midnight = startOfLocalDay(day);
  while (parseInstant(midnight) < endMs) {
    result.push(midnight);
    day = addLocalDays(day, 1);
    midnight = startOfLocalDay(day);
  }
  return result;
}
