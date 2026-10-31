import { bankHolidays } from '../bankHolidays';

describe('bundled bankHolidays lookup', () => {
  it('knows Christmas Day 2026 in England and Wales', () => {
    expect(bankHolidays.isBankHoliday('england-and-wales', '2026-12-25')).toBe(true);
  });

  it('returns false for an ordinary day', () => {
    expect(bankHolidays.isBankHoliday('england-and-wales', '2026-06-15')).toBe(false);
  });
});
