/**
 * @jest-environment node
 */
import snapshot from '../../config/bankHolidays.json';
import type { AppDb } from '../../db/jobRepo';
import { getSetting, setSetting } from '../../db/settingsRepo';
import { settings } from '../../db/schema';
import { createTestDb } from '../../db/testDb';
import type { BankHolidayData } from '../../engine/types';
import {
  BANK_HOLIDAYS_CACHE_KEY,
  isValidLocalDate,
  parseStoredBankHolidays,
  useBankHolidaysStore,
} from '../bankHolidaysStore';
import { bootstrap } from '../bootstrap';
import { TODAY, resetStores } from '../testFixtures';

const BUNDLED_AT = (snapshot as BankHolidayData).fetchedAt;

function cache(fetchedAt: string, extra: string[] = []): BankHolidayData {
  return {
    fetchedAt,
    regions: {
      'england-and-wales': ['2026-12-25', ...extra],
      scotland: ['2026-12-25'],
      'northern-ireland': ['2026-12-25'],
    },
  };
}

let db: AppDb;
let warn: jest.SpyInstance;

beforeEach(() => {
  db = createTestDb();
  useBankHolidaysStore.setState(useBankHolidaysStore.getInitialState(), true);
  resetStores();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => warn.mockRestore());

describe('isValidLocalDate', () => {
  it('accepts real dates and rejects malformed or impossible ones', () => {
    expect(isValidLocalDate('2028-02-29')).toBe(true);
    expect(isValidLocalDate('2027-02-29')).toBe(false);
    expect(isValidLocalDate('2026-13-01')).toBe(false);
    expect(isValidLocalDate('2026-1-01')).toBe(false);
    expect(isValidLocalDate('2026-01-01T00:00')).toBe(false);
  });
});

describe('parseStoredBankHolidays', () => {
  it('accepts a full BankHolidayData and rejects partial or bad values', () => {
    expect(parseStoredBankHolidays(cache('2026-11-01'))).toEqual(cache('2026-11-01'));
    expect(parseStoredBankHolidays(undefined)).toBeNull();
    expect(parseStoredBankHolidays({ fetchedAt: '2026-11-01', regions: { scotland: [] } })).toBeNull();
    expect(parseStoredBankHolidays(cache('2026-11-01', ['2026-02-30']))).toBeNull();
  });
});

describe('useBankHolidaysStore', () => {
  it('starts with the bundled snapshot', () => {
    const s = useBankHolidaysStore.getState();
    expect(s.source).toBe('bundled');
    expect(s.fetchedAt).toBe(BUNDLED_AT);
    expect(s.lookup.isBankHoliday('england-and-wales', '2026-12-25')).toBe(true);
  });

  it('load with no cache keeps the bundled snapshot', async () => {
    await useBankHolidaysStore.getState().load(db);
    expect(useBankHolidaysStore.getState().source).toBe('bundled');
  });

  it('load uses a valid cache that is not older than the snapshot', async () => {
    await setSetting(db, BANK_HOLIDAYS_CACHE_KEY, cache('2099-01-01', ['2099-06-15']));
    await useBankHolidaysStore.getState().load(db);
    const s = useBankHolidaysStore.getState();
    expect(s.source).toBe('cached');
    expect(s.fetchedAt).toBe('2099-01-01');
    expect(s.lookup.isBankHoliday('england-and-wales', '2099-06-15')).toBe(true);
  });

  it('load accepts a cache fetched on the same day as the snapshot', async () => {
    await setSetting(db, BANK_HOLIDAYS_CACHE_KEY, cache(BUNDLED_AT));
    await useBankHolidaysStore.getState().load(db);
    expect(useBankHolidaysStore.getState().source).toBe('cached');
  });

  it('load falls back to the snapshot for an older cache', async () => {
    useBankHolidaysStore.getState().setCached(cache('2099-01-01'));
    await setSetting(db, BANK_HOLIDAYS_CACHE_KEY, cache('2020-01-01', ['2020-06-15']));
    await useBankHolidaysStore.getState().load(db);
    const s = useBankHolidaysStore.getState();
    expect(s.source).toBe('bundled');
    expect(s.fetchedAt).toBe(BUNDLED_AT);
    expect(s.lookup.isBankHoliday('england-and-wales', '2020-06-15')).toBe(false);
  });

  it('load falls back to the snapshot for a cache with the wrong shape', async () => {
    await setSetting(db, BANK_HOLIDAYS_CACHE_KEY, { fetchedAt: '2099-01-01', regions: 'nope' });
    await useBankHolidaysStore.getState().load(db);
    expect(useBankHolidaysStore.getState().source).toBe('bundled');
  });

  it('load falls back to the snapshot when the stored JSON is corrupt', async () => {
    await db.insert(settings).values({ key: BANK_HOLIDAYS_CACHE_KEY, value: '{not json' });
    await expect(useBankHolidaysStore.getState().load(db)).resolves.toBeUndefined();
    expect(useBankHolidaysStore.getState().source).toBe('bundled');
    expect(warn).toHaveBeenCalled();
  });

  it('bootstrap loads the cached bank holidays', async () => {
    await setSetting(db, BANK_HOLIDAYS_CACHE_KEY, cache('2099-01-01'));
    await bootstrap(db, TODAY);
    expect(useBankHolidaysStore.getState().source).toBe('cached');
    expect(await getSetting(db, BANK_HOLIDAYS_CACHE_KEY)).toEqual(cache('2099-01-01'));
  });
});
