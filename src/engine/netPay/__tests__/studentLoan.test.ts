import { studentLoanForPeriod, studentLoanPlanForPeriod } from '../studentLoan';
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

describe('studentLoanPlanForPeriod (monthly £3,000)', () => {
  it.each([
    // plan, monthly threshold, expected: (300000 - threshold) x rate
    ['plan1', '2690000/12 = 224166.667 -> 75833.333 x 9% = 6825', 6_825],
    ['plan2', '2938500/12 = 244875 -> 55125 x 9% = 4961.25', 4_961],
    ['plan4', '3379500/12 = 281625 -> 18375 x 9% = 1653.75', 1_654],
    ['plan5', '2500000/12 = 208333.333 -> 91666.667 x 9% = 8250', 8_250],
    ['postgrad', '2100000/12 = 175000 -> 125000 x 6% = 7500', 7_500],
  ] as const)('%s: %s', (plan, _working, expected) => {
    expect(studentLoanPlanForPeriod(300_000, 'monthly', plan, year)).toBe(expected);
  });

  it('is 0 below and exactly at the threshold', () => {
    expect(studentLoanPlanForPeriod(200_000, 'monthly', 'plan2', year)).toBe(0);
    expect(studentLoanPlanForPeriod(244_875, 'monthly', 'plan2', year)).toBe(0);
  });

  it('uses the weekly threshold for weekly pay', () => {
    // 2938500/52 = 56509.615; (60000 - 56509.615) x 9% = 314.135
    expect(studentLoanPlanForPeriod(60_000, 'weekly', 'plan2', year)).toBe(314);
  });
});

describe('studentLoanForPeriod', () => {
  it('no loans -> 0', () => {
    expect(studentLoanForPeriod(300_000, 'monthly', { plan: null, postgrad: false }, year)).toBe(0);
  });

  it('one plan only', () => {
    expect(studentLoanForPeriod(300_000, 'monthly', { plan: 'plan2', postgrad: false }, year)).toBe(
      4_961,
    );
  });

  it('postgrad only', () => {
    expect(studentLoanForPeriod(300_000, 'monthly', { plan: null, postgrad: true }, year)).toBe(
      7_500,
    );
  });

  it('plan + postgrad combined = sum of each rounded repayment (4961 + 7500)', () => {
    expect(studentLoanForPeriod(300_000, 'monthly', { plan: 'plan2', postgrad: true }, year)).toBe(
      12_461,
    );
  });

  it('below both thresholds -> 0', () => {
    expect(studentLoanForPeriod(150_000, 'monthly', { plan: 'plan1', postgrad: true }, year)).toBe(
      0,
    );
  });
});
