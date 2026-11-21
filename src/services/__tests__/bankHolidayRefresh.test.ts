/**
 * @jest-environment node
 */
import type { AppDb } from '../../db/jobRepo';
import { BANK_HOLIDAYS_CHECKED_KEY } from '../../db/settingsKeys';
import { getSetting, setSetting } from '../../db/settingsRepo';
import { createTestDb } from '../../db/testDb';
import type { BankHolidayData } from '../../engine/types';
import { BANK_HOLIDAYS_CACHE_KEY, useBankHolidaysStore } from '../../store/bankHolidaysStore';
import {
  GOV_UK_BANK_HOLIDAYS_URL,
  govUkFetcher,
  parseGovUkBankHolidays,
  refreshBankHolidays,
} from '../bankHolidayRefresh';

const NOW = '2026-11-01T09:00:00.000Z';
/** Not a real bank holiday: only present in the "downloaded" data. */
const EXTRA = '2026-11-18';

function event(date: string, title = 'Holiday') {
  return { title, date, notes: '', bunting: true };
}

function govUkPayload(extra: string[] = []) {
  return {
    'england-and-wales': {
      division: 'england-and-wales',
      events: [event('2026-12-28', 'Boxing Day'), event('2026-12-25', 'Christmas Day'), ...extra.map((d) => event(d))],
    },
    scotland: {
      division: 'scotland',
      events: [event('2026-12-25'), event('2026-11-30', "St Andrew's Day"), event('2026-12-25')],
    },
    'northern-ireland': {
      division: 'northern-ireland',
      events: [event('2026-03-17', "St Patrick's Day")],
    },
  };
}

let db: AppDb;
let warn: jest.SpyInstance;

beforeEach(() => {
  db = createTestDb();
  useBankHolidaysStore.setState(useBankHolidaysStore.getInitialState(), true);
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => warn.mockRestore());

describe('parseGovUkBankHolidays', () => {
  it('turns a gov.uk payload into sorted, de-duplicated BankHolidayData', () => {
    expect(parseGovUkBankHolidays(govUkPayload(), '2026-11-01')).toEqual<BankHolidayData>({
      fetchedAt: '2026-11-01',
      regions: {
        'england-and-wales': ['2026-12-25', '2026-12-28'],
        scotland: ['2026-11-30', '2026-12-25'],
        'northern-ireland': ['2026-03-17'],
      },
    });
  });

  it('returns null for a missing region', () => {
    const payload: Record<string, unknown> = govUkPayload();
    delete payload.scotland;
    expect(parseGovUkBankHolidays(payload, '2026-11-01')).toBeNull();
  });

  it('returns null for a bad or impossible date', () => {
    expect(parseGovUkBankHolidays(govUkPayload(['25/12/2026']), '2026-11-01')).toBeNull();
    expect(parseGovUkBankHolidays(govUkPayload(['2026-02-30']), '2026-11-01')).toBeNull();
  });

  it('returns null for a region with no events', () => {
    const payload = { ...govUkPayload(), scotland: { division: 'scotland', events: [] } };
    expect(parseGovUkBankHolidays(payload, '2026-11-01')).toBeNull();
  });

  it('returns null for non-objects', () => {
    for (const json of [null, undefined, 'text', 42, []]) {
      expect(parseGovUkBankHolidays(json, '2026-11-01')).toBeNull();
    }
  });
});

describe('refreshBankHolidays', () => {
  it('on success saves the cache and check time and updates the store', async () => {
    const fetcher = jest.fn().mockResolvedValue(govUkPayload([EXTRA]));
    expect(useBankHolidaysStore.getState().lookup.isBankHoliday('england-and-wales', EXTRA)).toBe(false);

    await expect(refreshBankHolidays(db, NOW, fetcher)).resolves.toBe('updated');

    expect(fetcher).toHaveBeenCalledTimes(1);
    const cached = await getSetting<BankHolidayData>(db, BANK_HOLIDAYS_CACHE_KEY);
    expect(cached?.fetchedAt).toBe('2026-11-01');
    expect(cached?.regions['england-and-wales']).toContain(EXTRA);
    expect(await getSetting(db, BANK_HOLIDAYS_CHECKED_KEY)).toBe(NOW);
    const s = useBankHolidaysStore.getState();
    expect(s.source).toBe('cached');
    expect(s.fetchedAt).toBe('2026-11-01');
    expect(s.lookup.isBankHoliday('england-and-wales', EXTRA)).toBe(true);
    expect(s.lookup.datesInRange('england-and-wales', '2026-11-01', '2026-11-30')).toEqual([EXTRA]);
    expect(s.lookup.isBankHoliday('scotland', EXTRA)).toBe(false);
  });

  it('uses the London date of "now" as fetchedAt', async () => {
    // 23:30 UTC on 31 Mar 2026 is 00:30 BST on 1 Apr in London.
    await refreshBankHolidays(db, '2026-03-31T23:30:00.000Z', jest.fn().mockResolvedValue(govUkPayload()));
    expect(useBankHolidaysStore.getState().fetchedAt).toBe('2026-04-01');
  });

  async function expectUnchanged(fetcher: jest.Mock): Promise<void> {
    const before = useBankHolidaysStore.getState();
    await expect(refreshBankHolidays(db, NOW, fetcher)).resolves.toBe('failed');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await getSetting(db, BANK_HOLIDAYS_CACHE_KEY)).toBeUndefined();
    expect(await getSetting(db, BANK_HOLIDAYS_CHECKED_KEY)).toBeUndefined();
    const after = useBankHolidaysStore.getState();
    expect(after.lookup).toBe(before.lookup);
    expect(after.source).toBe('bundled');
  }

  it('offline: changes nothing and does not throw', async () => {
    await expectUnchanged(jest.fn().mockRejectedValue(new TypeError('Network request failed')));
  });

  it('HTTP error: changes nothing and does not throw', async () => {
    await expectUnchanged(jest.fn().mockRejectedValue(new Error('Bank holidays download failed: HTTP 500')));
  });

  it('garbage payload: changes nothing and does not throw', async () => {
    await expectUnchanged(jest.fn().mockResolvedValue({ hello: 'world' }));
  });

  it('keeps an existing cache when a later refresh fails', async () => {
    await refreshBankHolidays(db, NOW, jest.fn().mockResolvedValue(govUkPayload([EXTRA])));
    const later = '2026-11-09T09:00:00.000Z';
    await expect(refreshBankHolidays(db, later, jest.fn().mockRejectedValue(new Error('offline')))).resolves.toBe(
      'failed',
    );
    expect(await getSetting(db, BANK_HOLIDAYS_CHECKED_KEY)).toBe(NOW);
    expect(useBankHolidaysStore.getState().lookup.isBankHoliday('england-and-wales', EXTRA)).toBe(true);
  });

  it('skips the download within 7 days of the last successful check', async () => {
    await setSetting(db, BANK_HOLIDAYS_CHECKED_KEY, '2026-10-26T09:00:01.000Z');
    const fetcher = jest.fn().mockResolvedValue(govUkPayload());
    await expect(refreshBankHolidays(db, NOW, fetcher)).resolves.toBe('skipped');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('downloads again once 7 days have passed', async () => {
    await setSetting(db, BANK_HOLIDAYS_CHECKED_KEY, '2026-10-25T09:00:00.000Z');
    const fetcher = jest.fn().mockResolvedValue(govUkPayload());
    await expect(refreshBankHolidays(db, NOW, fetcher)).resolves.toBe('updated');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('ignores a check time in the future or an unreadable one', async () => {
    for (const checked of ['2027-01-01T00:00:00.000Z', 'yesterday', 12]) {
      await setSetting(db, BANK_HOLIDAYS_CHECKED_KEY, checked);
      const fetcher = jest.fn().mockResolvedValue(govUkPayload());
      await expect(refreshBankHolidays(db, NOW, fetcher)).resolves.toBe('updated');
    }
  });
});

describe('govUkFetcher', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('fetches the gov.uk URL with an abort signal and returns the JSON', async () => {
    const mock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => govUkPayload() });
    global.fetch = mock as unknown as typeof fetch;
    await expect(govUkFetcher()).resolves.toEqual(govUkPayload());
    expect(mock).toHaveBeenCalledWith(GOV_UK_BANK_HOLIDAYS_URL, expect.objectContaining({ signal: expect.anything() }));
  });

  it('rejects on an HTTP error, which refresh turns into "failed"', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }) as unknown as typeof fetch;
    await expect(govUkFetcher()).rejects.toThrow('HTTP 500');
    await expect(refreshBankHolidays(db, NOW)).resolves.toBe('failed');
    expect(await getSetting(db, BANK_HOLIDAYS_CACHE_KEY)).toBeUndefined();
  });

  it('aborts after 10 seconds', async () => {
    jest.useFakeTimers();
    try {
      global.fetch = jest.fn(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ) as unknown as typeof fetch;
      const result = govUkFetcher();
      jest.advanceTimersByTime(10_000);
      await expect(result).rejects.toThrow('aborted');
    } finally {
      jest.useRealTimers();
    }
  });
});
