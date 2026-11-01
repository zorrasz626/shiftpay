import { PERIODS_PER_YEAR, taxYearFor } from '../taxYear';
import type { TaxYearConfig } from '../types';

/** Only `id` and `startsOn` matter to the lookup. */
function makeYear(id: string, startsOn: string): TaxYearConfig {
  return { id, startsOn } as TaxYearConfig;
}

const y2425 = makeYear('2024/25', '2024-04-06');
const y2526 = makeYear('2025/26', '2025-04-06');
const y2627 = makeYear('2026/27', '2026-04-06');
const years = [y2627, y2425, y2526]; // deliberately unsorted

describe('taxYearFor', () => {
  it('5 April 2026 is still in 2025/26', () => {
    expect(taxYearFor('2026-04-05', years)).toEqual({ year: y2526, assumed: false });
  });

  it('6 April 2026 starts 2026/27', () => {
    expect(taxYearFor('2026-04-06', years)).toEqual({ year: y2627, assumed: false });
  });

  it('the latest year runs to 5 April of the next year', () => {
    expect(taxYearFor('2027-04-05', years)).toEqual({ year: y2627, assumed: false });
  });

  it('a date after the last year uses the latest year, assumed', () => {
    expect(taxYearFor('2027-04-06', years)).toEqual({ year: y2627, assumed: true });
    expect(taxYearFor('2030-01-01', [y2627])).toEqual({ year: y2627, assumed: true });
  });

  it('a date before the first year uses the latest year, assumed', () => {
    expect(taxYearFor('2024-04-05', years)).toEqual({ year: y2627, assumed: true });
  });

  it('throws when no years are configured', () => {
    expect(() => taxYearFor('2026-04-06', [])).toThrow(RangeError);
  });

  it('does not reorder the input array', () => {
    const input = [y2627, y2425];
    expect(taxYearFor('2024-05-01', input)).toEqual({ year: y2425, assumed: false });
    expect(input).toEqual([y2627, y2425]);
  });
});

describe('PERIODS_PER_YEAR', () => {
  it('matches each pay frequency', () => {
    expect(PERIODS_PER_YEAR).toEqual({ weekly: 52, fortnightly: 26, four_weekly: 13, monthly: 12 });
  });
});
