/**
 * Bank-holiday lookup by region. The data is passed in (bundled snapshot now,
 * refreshed gov.uk data later); the engine never imports the JSON itself.
 * `LocalDate` strings (`YYYY-MM-DD`) sort and compare correctly as text.
 */
import type { BankHolidayData, BankHolidayRegion, LocalDate } from './types';

export interface BankHolidayLookup {
  /** True if `date` is a bank holiday in `region`. Unknown region/date -> false. */
  isBankHoliday(region: BankHolidayRegion, date: LocalDate): boolean;
  /** The region's bank holidays from `from` to `to`, both inclusive, sorted. */
  datesInRange(region: BankHolidayRegion, from: LocalDate, to: LocalDate): LocalDate[];
}

export function createBankHolidayLookup(data: BankHolidayData): BankHolidayLookup {
  const sorted = new Map<BankHolidayRegion, LocalDate[]>();
  const sets = new Map<BankHolidayRegion, Set<LocalDate>>();
  for (const [region, dates] of Object.entries(data.regions) as [BankHolidayRegion, LocalDate[]][]) {
    sorted.set(region, [...dates].sort());
    sets.set(region, new Set(dates));
  }

  return {
    isBankHoliday(region, date) {
      return sets.get(region)?.has(date) ?? false;
    },
    datesInRange(region, from, to) {
      return (sorted.get(region) ?? []).filter((d) => d >= from && d <= to);
    },
  };
}
