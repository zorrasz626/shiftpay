/**
 * Bank-holiday store (PLAN 5.5): the lookup screens should use. Starts with
 * the bundled gov.uk snapshot; `load` switches to the refreshed copy cached in
 * settings when it is valid and not older than the snapshot. The refresh
 * service (`src/services/bankHolidayRefresh.ts`) calls `setCached` after a
 * successful download. The store never imports expo-sqlite.
 */
import { z } from 'zod';
import { create } from 'zustand';

import { bankHolidays as bundledLookup } from '../config/bankHolidays';
import snapshot from '../config/bankHolidays.json';
import type { AppDb } from '../db/jobRepo';
import { getSetting } from '../db/settingsRepo';
import { type BankHolidayLookup, createBankHolidayLookup } from '../engine/bankHolidays';
import type { BankHolidayData, LocalDate } from '../engine/types';

/** Settings key holding the last successfully downloaded `BankHolidayData`. */
export const BANK_HOLIDAYS_CACHE_KEY = 'bankHolidays.cache';

const BUNDLED_FETCHED_AT: LocalDate = (snapshot as BankHolidayData).fetchedAt;

/** True for a real calendar date written `YYYY-MM-DD`. */
export function isValidLocalDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utc = new Date(Date.UTC(y, mo - 1, d));
  return utc.getUTCFullYear() === y && utc.getUTCMonth() === mo - 1 && utc.getUTCDate() === d;
}

export const localDateSchema = z.string().refine(isValidLocalDate, 'Expected a YYYY-MM-DD date');

const storedSchema = z.object({
  fetchedAt: localDateSchema,
  regions: z.object({
    'england-and-wales': z.array(localDateSchema),
    scotland: z.array(localDateSchema),
    'northern-ireland': z.array(localDateSchema),
  }),
});

/** Validates a cached `BankHolidayData` value read from settings; null if unusable. */
export function parseStoredBankHolidays(value: unknown): BankHolidayData | null {
  const parsed = storedSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export interface BankHolidaysState {
  lookup: BankHolidayLookup;
  source: 'bundled' | 'cached';
  fetchedAt: LocalDate;
  /** Uses the cached copy if valid and not older than the bundled snapshot. Never throws. */
  load: (db: AppDb) => Promise<void>;
  /** Switches to freshly downloaded data (already validated by the caller). */
  setCached: (data: BankHolidayData) => void;
}

const bundledState = {
  lookup: bundledLookup,
  source: 'bundled' as const,
  fetchedAt: BUNDLED_FETCHED_AT,
};

export const useBankHolidaysStore = create<BankHolidaysState>()((set) => {
  function setCached(data: BankHolidayData): void {
    set({ lookup: createBankHolidayLookup(data), source: 'cached', fetchedAt: data.fetchedAt });
  }

  return {
    ...bundledState,
    load: async (db) => {
      let cached: BankHolidayData | null = null;
      try {
        cached = parseStoredBankHolidays(await getSetting<unknown>(db, BANK_HOLIDAYS_CACHE_KEY));
      } catch (e) {
        console.warn('Reading cached bank holidays failed; using the bundled snapshot.', e);
      }
      if (cached && cached.fetchedAt >= BUNDLED_FETCHED_AT) setCached(cached);
      else set(bundledState);
    },
    setCached,
  };
});
