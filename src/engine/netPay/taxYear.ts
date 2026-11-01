/**
 * Tax-year lookup. Dates are `LocalDate` strings and compare as strings.
 */
import type { LocalDate, PayFrequency } from '../types';
import type { TaxYearConfig } from './types';

/** Pay periods in one tax year, by pay frequency. */
export const PERIODS_PER_YEAR: Record<PayFrequency, number> = {
  weekly: 52,
  fortnightly: 26,
  four_weekly: 13,
  monthly: 12,
};

export interface TaxYearMatch {
  year: TaxYearConfig;
  /** True when no configured year contains the date and the latest one is used instead. */
  assumed: boolean;
}

/** Same month-day one year later (`2026-04-06` -> `2027-04-06`). */
function oneYearLater(date: LocalDate): LocalDate {
  return `${Number(date.slice(0, 4)) + 1}${date.slice(4)}`;
}

/**
 * The tax year whose range `[startsOn, next year's startsOn)` contains `date`.
 * The latest year ends one year after it starts. If no year contains the date,
 * the latest year is returned with `assumed: true`. Throws if `years` is empty.
 */
export function taxYearFor(date: LocalDate, years: readonly TaxYearConfig[]): TaxYearMatch {
  if (years.length === 0) {
    throw new RangeError('taxYearFor: no tax years configured');
  }
  const sorted = [...years].sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1));
  for (let i = 0; i < sorted.length; i += 1) {
    const year = sorted[i];
    const next = sorted[i + 1];
    const endsBefore = next === undefined ? oneYearLater(year.startsOn) : next.startsOn;
    if (date >= year.startsOn && date < endsBefore) {
      return { year, assumed: false };
    }
  }
  return { year: sorted[sorted.length - 1], assumed: true };
}
