import snapshot from '../../config/bankHolidays.json';
import { createBankHolidayLookup } from '../bankHolidays';
import type { BankHolidayData } from '../types';

const lookup = createBankHolidayLookup(snapshot as BankHolidayData);

describe('bundled gov.uk snapshot', () => {
  it('has dates-only lists for all three regions and a fetchedAt stamp', () => {
    expect(typeof snapshot.fetchedAt).toBe('string');
    for (const dates of Object.values(snapshot.regions)) {
      expect(dates.length).toBeGreaterThan(0);
      for (const d of dates) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('isBankHoliday', () => {
  it('knows the shared UK holidays in every region', () => {
    for (const region of ['england-and-wales', 'scotland', 'northern-ireland'] as const) {
      expect(lookup.isBankHoliday(region, '2026-12-25')).toBe(true);
      expect(lookup.isBankHoliday(region, '2026-01-01')).toBe(true);
    }
  });

  it('uses Christmas/Boxing Day substitute days', () => {
    // 2026: Boxing Day is a Saturday -> substitute Mon 28 Dec.
    expect(lookup.isBankHoliday('england-and-wales', '2026-12-28')).toBe(true);
    expect(lookup.isBankHoliday('england-and-wales', '2026-12-26')).toBe(false);
    // 2027: Christmas Sat, Boxing Day Sun -> substitutes Mon 27 and Tue 28 Dec.
    expect(lookup.isBankHoliday('england-and-wales', '2027-12-27')).toBe(true);
    expect(lookup.isBankHoliday('england-and-wales', '2027-12-28')).toBe(true);
    expect(lookup.isBankHoliday('england-and-wales', '2027-12-25')).toBe(false);
  });

  it('knows Scotland-only dates (2 January, St Andrew’s substitute day)', () => {
    expect(lookup.isBankHoliday('scotland', '2026-01-02')).toBe(true);
    expect(lookup.isBankHoliday('england-and-wales', '2026-01-02')).toBe(false);
    expect(lookup.isBankHoliday('northern-ireland', '2026-01-02')).toBe(false);
    // 30 Nov 2025 was a Sunday -> substitute Mon 1 Dec 2025.
    expect(lookup.isBankHoliday('scotland', '2025-12-01')).toBe(true);
    expect(lookup.isBankHoliday('england-and-wales', '2025-12-01')).toBe(false);
  });

  it('knows NI-only dates (17 March, Battle of the Boyne)', () => {
    expect(lookup.isBankHoliday('northern-ireland', '2026-03-17')).toBe(true);
    expect(lookup.isBankHoliday('england-and-wales', '2026-03-17')).toBe(false);
    expect(lookup.isBankHoliday('northern-ireland', '2027-07-12')).toBe(true);
    expect(lookup.isBankHoliday('scotland', '2027-07-12')).toBe(false);
    // 12 Jul 2026 is a Sunday -> substitute Mon 13 Jul.
    expect(lookup.isBankHoliday('northern-ireland', '2026-07-13')).toBe(true);
  });

  it('is false for normal days and for dates outside the snapshot', () => {
    expect(lookup.isBankHoliday('england-and-wales', '2026-06-10')).toBe(false);
    expect(lookup.isBankHoliday('england-and-wales', '1999-12-25')).toBe(false);
    expect(lookup.isBankHoliday('england-and-wales', '2099-12-25')).toBe(false);
  });

  it('is false for a region missing from the data', () => {
    const partial = createBankHolidayLookup({
      fetchedAt: '2026-10-30',
      regions: { 'england-and-wales': ['2026-12-25'] },
    });
    expect(partial.isBankHoliday('england-and-wales', '2026-12-25')).toBe(true);
    expect(partial.isBankHoliday('scotland', '2026-12-25')).toBe(false);
    expect(partial.datesInRange('scotland', '2026-01-01', '2026-12-31')).toEqual([]);
  });
});

describe('datesInRange', () => {
  it('returns the region’s holidays in [from, to], inclusive and sorted', () => {
    expect(lookup.datesInRange('england-and-wales', '2026-12-25', '2027-01-01')).toEqual([
      '2026-12-25',
      '2026-12-28',
      '2027-01-01',
    ]);
    expect(lookup.datesInRange('scotland', '2026-01-01', '2026-01-31')).toEqual([
      '2026-01-01',
      '2026-01-02',
    ]);
  });

  it('sorts unsorted input data and is empty for a reversed range', () => {
    const custom = createBankHolidayLookup({
      fetchedAt: '2026-10-30',
      regions: { 'northern-ireland': ['2026-12-25', '2026-03-17', '2026-07-13'] },
    });
    expect(custom.datesInRange('northern-ireland', '2026-01-01', '2026-12-31')).toEqual([
      '2026-03-17',
      '2026-07-13',
      '2026-12-25',
    ]);
    expect(custom.datesInRange('northern-ireland', '2026-12-31', '2026-01-01')).toEqual([]);
  });
});
