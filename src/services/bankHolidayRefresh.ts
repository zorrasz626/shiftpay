/**
 * Bank-holiday refresh (PLAN 5.5, SPEC pay rules): download gov.uk's
 * bank-holidays.json at most once every 7 days, validate it, cache it in
 * settings and switch the store to it. Offline or bad data changes nothing:
 * the app keeps the cached copy or the bundled snapshot. Never throws.
 * "now" is passed in (an ISO instant).
 */
import { z } from 'zod';

import type { AppDb } from '../db/jobRepo';
import { getSetting, setSetting } from '../db/settingsRepo';
import { instantToLocal, minutesBetween } from '../engine/time';
import type { BankHolidayData, BankHolidayRegion, IsoInstant, LocalDate } from '../engine/types';
import { BANK_HOLIDAYS_CACHE_KEY, localDateSchema, useBankHolidaysStore } from '../store/bankHolidaysStore';

export const GOV_UK_BANK_HOLIDAYS_URL = 'https://www.gov.uk/bank-holidays.json';

/** Settings key: ISO instant of the last successful download. */
export const BANK_HOLIDAYS_CHECKED_KEY = 'bankHolidays.lastCheckedAt';

export const REFRESH_INTERVAL_MINUTES = 7 * 24 * 60;
const FETCH_TIMEOUT_MS = 10_000;

/** Downloads the gov.uk payload and returns its parsed JSON; rejects on network/HTTP errors. */
export type BankHolidayFetcher = () => Promise<unknown>;

const division = z.object({ events: z.array(z.object({ date: localDateSchema })).min(1) });

const govUkSchema = z.object({
  'england-and-wales': division,
  scotland: division,
  'northern-ireland': division,
});

const REGIONS: BankHolidayRegion[] = ['england-and-wales', 'scotland', 'northern-ireland'];

/** gov.uk JSON -> `BankHolidayData` (dates sorted, de-duplicated); null if any region is missing or invalid. */
export function parseGovUkBankHolidays(json: unknown, fetchedAt: LocalDate): BankHolidayData | null {
  const parsed = govUkSchema.safeParse(json);
  if (!parsed.success) return null;
  const regions: Record<BankHolidayRegion, LocalDate[]> = {
    'england-and-wales': [],
    scotland: [],
    'northern-ireland': [],
  };
  for (const region of REGIONS) {
    regions[region] = [...new Set(parsed.data[region].events.map((e) => e.date))].sort();
  }
  return { fetchedAt, regions };
}

/** Default fetcher: `fetch` with a 10 s timeout; non-2xx responses reject. */
export const govUkFetcher: BankHolidayFetcher = async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(GOV_UK_BANK_HOLIDAYS_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Bank holidays download failed: HTTP ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
};

const instantSchema = z.string().datetime({ offset: true });

/** True if the last successful download was less than 7 days before `now` (and not in the future). */
async function checkedRecently(db: AppDb, now: IsoInstant): Promise<boolean> {
  const parsed = instantSchema.safeParse(await getSetting<unknown>(db, BANK_HOLIDAYS_CHECKED_KEY));
  if (!parsed.success) return false;
  const elapsed = minutesBetween(parsed.data, now);
  return elapsed >= 0 && elapsed < REFRESH_INTERVAL_MINUTES;
}

export type BankHolidayRefreshResult = 'skipped' | 'updated' | 'failed';

/**
 * Refreshes the bank holidays unless checked within 7 days. On success saves
 * the cache, records the check time and updates the store. Never throws.
 */
export async function refreshBankHolidays(
  db: AppDb,
  now: IsoInstant,
  fetcher: BankHolidayFetcher = govUkFetcher,
): Promise<BankHolidayRefreshResult> {
  try {
    if (await checkedRecently(db, now)) return 'skipped';
    const data = parseGovUkBankHolidays(await fetcher(), instantToLocal(now).date);
    if (!data) {
      console.warn('Bank holidays download was not in the expected format; keeping current data.');
      return 'failed';
    }
    await setSetting(db, BANK_HOLIDAYS_CACHE_KEY, data);
    await setSetting(db, BANK_HOLIDAYS_CHECKED_KEY, now);
    useBankHolidaysStore.getState().setCached(data);
    return 'updated';
  } catch (e) {
    console.warn('Bank holidays refresh failed; keeping current data.', e);
    return 'failed';
  }
}
