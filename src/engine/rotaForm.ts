/**
 * Shift template + rota pattern editor <-> ShiftTemplate / RotaPattern
 * (Settings, task 3.9). Pure: no React, DB or clock.
 *
 * Text inputs stay strings in the form (the break is typed as minutes). The
 * cycle length is `days.length`; the 14-day preview is plain calendar maths
 * on London local dates, so it is unaffected by clock changes.
 */
import { isValidWallClock } from './manualShift';
import { addLocalDays, localDaysBetween } from './time';
import type { LocalDate, RotaDay, RotaPattern, ShiftTemplate, WallClockTime } from './types';

export const TEMPLATE_NAME_MAX = 30;
export const BREAK_MINUTES_MAX = 240;
export const CYCLE_DAYS_MIN = 1;
export const CYCLE_DAYS_MAX = 56;
export const OFF_LABEL = 'Off';

const MINUTES_PER_DAY = 24 * 60;
const WHOLE_RE = /^\d+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const ROTA_FORM_MESSAGES = {
  name: 'Enter a name',
  nameTooLong: `Name must be ${TEMPLATE_NAME_MAX} characters or fewer`,
  startTime: 'Enter a start time as HH:MM, from 00:00 to 23:59',
  endTime: 'Enter an end time as HH:MM, from 00:00 to 23:59',
  breakNotWhole: `Enter a break in whole minutes, from 0 to ${BREAK_MINUTES_MAX}`,
  breakTooLong: 'Break must be shorter than the shift',
  startDate: 'Enter a real date as YYYY-MM-DD',
  cycleLength: `A cycle must be ${CYCLE_DAYS_MIN} to ${CYCLE_DAYS_MAX} days long`,
  noDayOn: 'Set at least one day to a shift',
  unknownTemplate: 'Every day on must use an existing shift',
} as const;

// ---------------------------------------------------------------- templates

export interface TemplateFormValues {
  name: string;
  startTime: WallClockTime;
  endTime: WallClockTime;
  /** Unpaid break in whole minutes, e.g. "30". */
  breakText: string;
}

export type TemplateFormField = 'name' | 'startTime' | 'endTime' | 'breakText';

export interface TemplateFormError {
  field: TemplateFormField;
  message: string;
}

/** Default form for a new template: 09:00-17:00 with a 30-minute break. */
export function newTemplateForm(): TemplateFormValues {
  return { name: '', startTime: '09:00', endTime: '17:00', breakText: '30' };
}

export function templateToForm(t: ShiftTemplate): TemplateFormValues {
  return {
    name: t.name,
    startTime: t.startTime,
    endTime: t.endTime,
    breakText: String(t.unpaidBreakMinutes),
  };
}

function wallClockMinutes(time: WallClockTime): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Wall-clock length of a template shift; end <= start runs into the next day, start == end is 24 h. */
function templateLengthMinutes(start: WallClockTime, end: WallClockTime): number {
  const diff = wallClockMinutes(end) - wallClockMinutes(start);
  return diff > 0 ? diff : diff + MINUTES_PER_DAY;
}

/** Field errors for the form; empty when it can be saved. */
export function templateFormErrors(values: TemplateFormValues): TemplateFormError[] {
  const errors: TemplateFormError[] = [];
  const name = values.name.trim();
  if (name === '') {
    errors.push({ field: 'name', message: ROTA_FORM_MESSAGES.name });
  } else if (name.length > TEMPLATE_NAME_MAX) {
    errors.push({ field: 'name', message: ROTA_FORM_MESSAGES.nameTooLong });
  }
  const startOk = isValidWallClock(values.startTime);
  const endOk = isValidWallClock(values.endTime);
  if (!startOk) errors.push({ field: 'startTime', message: ROTA_FORM_MESSAGES.startTime });
  if (!endOk) errors.push({ field: 'endTime', message: ROTA_FORM_MESSAGES.endTime });
  const breakText = values.breakText.trim();
  const minutes = Number(breakText);
  if (!WHOLE_RE.test(breakText) || minutes > BREAK_MINUTES_MAX) {
    errors.push({ field: 'breakText', message: ROTA_FORM_MESSAGES.breakNotWhole });
  } else if (
    startOk &&
    endOk &&
    minutes >= templateLengthMinutes(values.startTime, values.endTime)
  ) {
    errors.push({ field: 'breakText', message: ROTA_FORM_MESSAGES.breakTooLong });
  }
  return errors;
}

/** Valid form -> ShiftTemplate. Throws if `templateFormErrors(values)` is not empty. */
export function formToTemplate(
  values: TemplateFormValues,
  ids: { id: string; jobId: string },
): ShiftTemplate {
  const errors = templateFormErrors(values);
  if (errors.length > 0) {
    throw new Error(`Invalid shift template form: ${errors.map((e) => e.field).join(', ')}`);
  }
  return {
    id: ids.id,
    jobId: ids.jobId,
    name: values.name.trim(),
    startTime: values.startTime,
    endTime: values.endTime,
    unpaidBreakMinutes: Number(values.breakText.trim()),
  };
}

// ---------------------------------------------------------------- pattern

export interface PatternFormValues {
  /** Day 0 of the cycle, YYYY-MM-DD. */
  startDate: string;
  /** One entry per cycle day; the cycle length is `days.length`. */
  days: RotaDay[];
}

export type PatternFormField = 'startDate' | 'days';

export interface PatternFormError {
  field: PatternFormField;
  message: string;
}

function copyDay(d: RotaDay): RotaDay {
  return d === 'OFF' ? 'OFF' : { shiftTemplateId: d.shiftTemplateId };
}

export function patternToForm(p: RotaPattern): PatternFormValues {
  return { startDate: p.startDate, days: p.days.map(copyDay) };
}

/** True if `text` is a real calendar date written YYYY-MM-DD (2026-02-30 is not). */
export function isValidLocalDateText(text: string): boolean {
  if (!DATE_RE.test(text)) return false;
  try {
    addLocalDays(text, 0);
    return true;
  } catch {
    return false;
  }
}

/** Field errors for the form; empty when it can be saved. `templateIds` are the job's templates. */
export function patternFormErrors(
  values: PatternFormValues,
  templateIds: readonly string[],
): PatternFormError[] {
  const errors: PatternFormError[] = [];
  if (!isValidLocalDateText(values.startDate)) {
    errors.push({ field: 'startDate', message: ROTA_FORM_MESSAGES.startDate });
  }
  const n = values.days.length;
  const onDays = values.days.filter((d): d is { shiftTemplateId: string } => d !== 'OFF');
  if (n < CYCLE_DAYS_MIN || n > CYCLE_DAYS_MAX) {
    errors.push({ field: 'days', message: ROTA_FORM_MESSAGES.cycleLength });
  } else if (onDays.length === 0) {
    errors.push({ field: 'days', message: ROTA_FORM_MESSAGES.noDayOn });
  }
  const known = new Set(templateIds);
  if (onDays.some((d) => !known.has(d.shiftTemplateId))) {
    errors.push({ field: 'days', message: ROTA_FORM_MESSAGES.unknownTemplate });
  }
  return errors;
}

/**
 * Valid form -> RotaPattern. Throws on a bad start date, cycle length or no
 * day on; template ids are not checked here (run `patternFormErrors` with
 * the job's template ids first).
 */
export function formToPattern(
  values: PatternFormValues,
  ids: { id: string; jobId: string },
): RotaPattern {
  const usedIds = values.days.flatMap((d) => (d === 'OFF' ? [] : [d.shiftTemplateId]));
  const errors = patternFormErrors(values, usedIds);
  if (errors.length > 0) {
    throw new Error(`Invalid rota pattern form: ${errors.map((e) => e.field).join(', ')}`);
  }
  return {
    id: ids.id,
    jobId: ids.jobId,
    cycleLengthDays: values.days.length,
    startDate: values.startDate,
    days: values.days.map(copyDay),
  };
}

// ---------------------------------------------------------------- cycle helpers

/** First `n` days of the cycle, padded with 'OFF' when growing. */
export function resizeCycle(days: readonly RotaDay[], n: number): RotaDay[] {
  if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid cycle length: ${n}`);
  return Array.from({ length: n }, (_, i) => (i < days.length ? copyDay(days[i]) : 'OFF'));
}

/** Local date of cycle day `i` (0-based) of the first cycle from `startDate`. */
export function cycleDayDate(startDate: LocalDate, i: number): LocalDate {
  return addLocalDays(startDate, i);
}

export interface RotaPreviewDay {
  date: LocalDate;
  /** Template name, or `OFF_LABEL`. */
  label: string;
}

/**
 * The next `count` local dates from `from` (inclusive) with what the pattern
 * puts on each. Works for `from` before `startDate` (the cycle runs backwards
 * too, as in `generateShifts`). Throws if a day uses a missing template.
 */
export function nextOccurrences(
  pattern: RotaPattern,
  templates: readonly ShiftTemplate[],
  from: LocalDate,
  count: number,
): RotaPreviewDay[] {
  const n = pattern.days.length;
  if (n < 1) throw new Error(`Rota pattern ${pattern.id}: no cycle days`);
  const names = new Map(templates.map((t) => [t.id, t.name]));
  const offset = localDaysBetween(pattern.startDate, from);
  return Array.from({ length: Math.max(0, count) }, (_, i) => {
    const day = pattern.days[(((offset + i) % n) + n) % n];
    const date = addLocalDays(from, i);
    if (day === 'OFF') return { date, label: OFF_LABEL };
    const name = names.get(day.shiftTemplateId);
    if (name === undefined) {
      throw new Error(
        `Rota pattern ${pattern.id}: shift template ${day.shiftTemplateId} not found`,
      );
    }
    return { date, label: name };
  });
}
