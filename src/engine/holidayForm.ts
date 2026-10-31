/**
 * Holiday settings form <-> the job's holiday fields (Settings, task 4.4b).
 * Pure: no React, DB or clock.
 *
 * Text inputs stay strings in the form. Entitlement is decimal hours (D3) and
 * only matters in fixed mode; accrual (12.07% of worked hours) keeps the job's
 * existing entitlement so switching back to fixed loses nothing.
 */
import { isValidLocalDateText } from './rotaForm';
import type { HolidayMode, Job, LocalDate } from './types';

export interface HolidayFormValues {
  mode: HolidayMode;
  /** Hours of paid holiday a year, e.g. "210" or "151.2". Fixed mode only. */
  entitlementText: string;
  /** First day of the holiday year, YYYY-MM-DD. */
  yearStartText: string;
}

export type HolidayFormField = 'entitlementText' | 'yearStartText';

export interface HolidayFormError {
  field: HolidayFormField;
  message: string;
}

export interface HolidaySettings {
  holidayMode: HolidayMode;
  holidayEntitlementHours: number;
  holidayYearStart: LocalDate;
}

/** Most hours of holiday a year the form accepts. */
export const HOLIDAY_ENTITLEMENT_MAX = 2000;

export const HOLIDAY_FORM_MESSAGES = {
  entitlement: `Enter hours above 0 and up to ${HOLIDAY_ENTITLEMENT_MAX}, e.g. 210`,
  yearStart: 'Enter a date as YYYY-MM-DD, e.g. 2026-04-01',
} as const;

const DECIMAL_RE = /^\d+(\.\d+)?$/;

type HolidayJob = Pick<Job, 'holidayMode' | 'holidayEntitlementHours' | 'holidayYearStart'>;

/** The job's holiday fields -> form. */
export function jobToHolidayForm(job: HolidayJob): HolidayFormValues {
  return {
    mode: job.holidayMode,
    entitlementText: String(job.holidayEntitlementHours),
    yearStartText: job.holidayYearStart,
  };
}

/** Positive decimal ("210", "151.2"), or null. No commas, signs or exponents. */
function parseHours(text: string): number | null {
  const t = text.trim();
  return DECIMAL_RE.test(t) ? Number(t) : null;
}

/** Field errors for the form; empty when it can be saved. */
export function holidayFormErrors(values: HolidayFormValues): HolidayFormError[] {
  const errors: HolidayFormError[] = [];
  if (values.mode === 'fixed') {
    const h = parseHours(values.entitlementText);
    if (h === null || h <= 0 || h > HOLIDAY_ENTITLEMENT_MAX) {
      errors.push({ field: 'entitlementText', message: HOLIDAY_FORM_MESSAGES.entitlement });
    }
  }
  if (!isValidLocalDateText(values.yearStartText.trim())) {
    errors.push({ field: 'yearStartText', message: HOLIDAY_FORM_MESSAGES.yearStart });
  }
  return errors;
}

/** Valid form -> the job's holiday fields. Throws if `holidayFormErrors(values)` is not empty. */
export function formToHolidaySettings(values: HolidayFormValues, job: HolidayJob): HolidaySettings {
  const errors = holidayFormErrors(values);
  if (errors.length > 0) {
    throw new Error(`Invalid holiday form: ${errors.map((e) => e.field).join(', ')}`);
  }
  return {
    holidayMode: values.mode,
    holidayEntitlementHours:
      values.mode === 'fixed' ? Number(values.entitlementText.trim()) : job.holidayEntitlementHours,
    holidayYearStart: values.yearStartText.trim(),
  };
}
