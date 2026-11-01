import { employeeNiForPeriod } from '../nationalInsurance';
import type { TaxYearConfig } from '../types';

/** Test tax year (independent of src/config so hand-computed values stay fixed). */
const year: TaxYearConfig = {
  id: '2026/27',
  startsOn: '2026-04-06',
  personalAllowancePence: 1_257_000,
  allowanceTaperThresholdPence: 10_000_000,
  incomeTax: {
    ruk: { bands: [{ upToPence: null, rate: 0.2 }], flatRates: { BR: 0.2, D0: 0.4, D1: 0.45 } },
    scotland: {
      bands: [{ upToPence: null, rate: 0.2 }],
      flatRates: { BR: 0.2, D0: 0.21, D1: 0.42 },
    },
  },
  // PT £12,570, UEL £50,270, 8% / 2%.
  nationalInsurance: {
    primaryThresholdPence: 1_257_000,
    upperEarningsLimitPence: 5_027_000,
    mainRate: 0.08,
    upperRate: 0.02,
  },
  studentLoans: {
    plan1: { thresholdPence: 2_690_000, rate: 0.09 },
    plan2: { thresholdPence: 2_938_500, rate: 0.09 },
    plan4: { thresholdPence: 3_379_500, rate: 0.09 },
    plan5: { thresholdPence: 2_500_000, rate: 0.09 },
    postgrad: { thresholdPence: 2_100_000, rate: 0.06 },
  },
};

describe('employeeNiForPeriod', () => {
  it('is 0 below, and exactly at, the monthly primary threshold (1257000/12 = 104750)', () => {
    expect(employeeNiForPeriod(100_000, 'monthly', year)).toBe(0);
    expect(employeeNiForPeriod(104_750, 'monthly', year)).toBe(0);
  });

  it('is 0 for zero or negative pay', () => {
    expect(employeeNiForPeriod(0, 'monthly', year)).toBe(0);
    expect(employeeNiForPeriod(-5_000, 'weekly', year)).toBe(0);
  });

  it('monthly £2,500 between PT and UEL: (250000 - 104750) x 8% = £116.20', () => {
    expect(employeeNiForPeriod(250_000, 'monthly', year)).toBe(11_620);
  });

  it('monthly £6,000 above UEL: (418916.67 - 104750) x 8% + (600000 - 418916.67) x 2% = £287.55', () => {
    // 25133.333 + 3621.667 = 28755.000
    expect(employeeNiForPeriod(600_000, 'monthly', year)).toBe(28_755);
  });

  it('weekly vs monthly thresholds: £500 is above the weekly PT but below the monthly one', () => {
    // Weekly PT = 1257000/52 = 24173.077; (50000 - 24173.077) x 8% = 2066.154
    expect(employeeNiForPeriod(50_000, 'weekly', year)).toBe(2_066);
    expect(employeeNiForPeriod(50_000, 'monthly', year)).toBe(0);
  });

  it('weekly £1,500 above the weekly UEL (5027000/52 = 96673.077)', () => {
    // (96673.077 - 24173.077) x 8% = 5800; (150000 - 96673.077) x 2% = 1066.538
    expect(employeeNiForPeriod(150_000, 'weekly', year)).toBe(6_867);
  });

  it('four-weekly and fortnightly use 13 and 26 periods', () => {
    // Four-weekly PT = 96692.308; (200000 - 96692.308) x 8% = 8264.615
    expect(employeeNiForPeriod(200_000, 'four_weekly', year)).toBe(8_265);
    // Fortnightly PT = 48346.154; (100000 - 48346.154) x 8% = 4132.308
    expect(employeeNiForPeriod(100_000, 'fortnightly', year)).toBe(4_132);
  });
});
