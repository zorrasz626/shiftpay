/**
 * Manual shift form <-> shift times (SPEC §7.3, day sheet). Pure: every
 * London conversion goes through `time.ts`.
 *
 * The form holds a London start date, "HH:MM" start and end times and an
 * unpaid break in minutes. An end time at or before the start time means the
 * shift ends on the next local day (overnight).
 */
import {
  addLocalDays,
  instantToLocal,
  localToInstant,
  minutesBetween,
  WALL_CLOCK_RE,
} from './time';
import type { IsoInstant, LocalDate, Shift, WallClockTime } from './types';

export interface ManualShiftForm {
  /** London date the shift starts on. */
  date: LocalDate;
  startTime: WallClockTime;
  endTime: WallClockTime;
  unpaidBreakMinutes: number;
}

export type ManualShiftField = 'startTime' | 'endTime' | 'unpaidBreakMinutes';

export interface ManualShiftError {
  field: ManualShiftField;
  message: string;
}

export type ManualShiftResult =
  | { ok: true; start: IsoInstant; end: IsoInstant }
  | { ok: false; errors: ManualShiftError[] };

export const MANUAL_SHIFT_MESSAGES = {
  startTime: 'Enter a start time as HH:MM, from 00:00 to 23:59',
  endTime: 'Enter an end time as HH:MM, from 00:00 to 23:59',
  endBeforeStart: 'End time must be after the start time',
  breakNotWhole: 'Break must be a whole number of minutes, 0 or more',
  breakTooLong: 'Break must be shorter than the shift',
} as const;

/** True for a two-digit 24h "HH:MM" time from 00:00 to 23:59. */
export function isValidWallClock(s: string): boolean {
  return WALL_CLOCK_RE.test(s);
}

/**
 * Form -> shift start/end instants, or field errors. `date` must be a valid
 * LocalDate (it comes from the day sheet, not typed in); an invalid one throws.
 */
export function manualShiftTimes(form: ManualShiftForm): ManualShiftResult {
  const errors: ManualShiftError[] = [];
  if (!isValidWallClock(form.startTime)) {
    errors.push({ field: 'startTime', message: MANUAL_SHIFT_MESSAGES.startTime });
  }
  if (!isValidWallClock(form.endTime)) {
    errors.push({ field: 'endTime', message: MANUAL_SHIFT_MESSAGES.endTime });
  }
  const breakOk = Number.isInteger(form.unpaidBreakMinutes) && form.unpaidBreakMinutes >= 0;
  if (!breakOk) {
    errors.push({ field: 'unpaidBreakMinutes', message: MANUAL_SHIFT_MESSAGES.breakNotWhole });
  }
  if (errors.length > 0) return { ok: false, errors };

  const start = localToInstant(form.date, form.startTime);
  const endDate = form.endTime <= form.startTime ? addLocalDays(form.date, 1) : form.date;
  const end = localToInstant(endDate, form.endTime);
  const length = minutesBetween(start, end);
  // Only possible when a time falls in the spring-forward gap (e.g. 01:30-02:00 on 29 Mar).
  if (length <= 0) {
    return { ok: false, errors: [{ field: 'endTime', message: MANUAL_SHIFT_MESSAGES.endBeforeStart }] };
  }
  if (form.unpaidBreakMinutes >= length) {
    return { ok: false, errors: [{ field: 'unpaidBreakMinutes', message: MANUAL_SHIFT_MESSAGES.breakTooLong }] };
  }
  return { ok: true, start, end };
}

/** Shift -> form values (London local times), so editing a shift round-trips. */
export function shiftToForm(shift: Pick<Shift, 'date' | 'start' | 'end' | 'unpaidBreakMinutes'>): ManualShiftForm {
  return {
    date: shift.date,
    startTime: instantToLocal(shift.start).time,
    endTime: instantToLocal(shift.end).time,
    unpaidBreakMinutes: shift.unpaidBreakMinutes,
  };
}
