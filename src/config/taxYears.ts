/**
 * UK tax-year values for the estimated net pay (Pro). One object per tax year,
 * each starting 6 April. The engine never imports this file; app code passes
 * `TAX_YEARS` in, and the UI shows the `id` of the year it used.
 *
 * MUST be re-checked against gov.uk every April (and after each Budget /
 * Scottish Budget), and a new object added for each new tax year.
 * Money is integer pence; rates are decimals.
 *
 * 2026/27 values checked against gov.uk on 2026-11-21:
 * - EMP:  https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027
 *         (allowance, rUK + Scottish bands above the PAYE threshold, NI, student loans)
 * - ITR:  https://www.gov.uk/income-tax-rates (taper above £100,000, rUK gross edges)
 * - SCOT: https://www.gov.uk/scottish-income-tax (Scottish gross edges)
 */
import type { TaxYearConfig } from '../engine/netPay/types';

export const TAX_YEARS: TaxYearConfig[] = [
  {
    id: '2026/27',
    startsOn: '2026-04-06',
    personalAllowancePence: 1_257_000, // £12,570 (EMP, ITR)
    allowanceTaperThresholdPence: 10_000_000, // £100,000, £1 per £2 above (ITR)
    incomeTax: {
      // Band limits are taxable income above the allowance (EMP's figures).
      ruk: {
        bands: [
          { upToPence: 3_770_000, rate: 0.2 }, // basic £0-£37,700 (EMP)
          { upToPence: 12_514_000, rate: 0.4 }, // higher to £125,140 (EMP)
          { upToPence: null, rate: 0.45 }, // additional (EMP)
        ],
        flatRates: {
          BR: 0.2, // basic
          D0: 0.4, // higher
          D1: 0.45, // additional
        },
      },
      scotland: {
        bands: [
          { upToPence: 396_700, rate: 0.19 }, // starter £0-£3,967 (EMP; SCOT £12,571-£16,537)
          { upToPence: 1_695_600, rate: 0.2 }, // basic to £16,956 (EMP; SCOT to £29,526)
          { upToPence: 3_109_200, rate: 0.21 }, // intermediate to £31,092 (EMP; SCOT to £43,662)
          { upToPence: 6_243_000, rate: 0.42 }, // higher to £62,430 (EMP; SCOT to £75,000)
          { upToPence: 12_514_000, rate: 0.45 }, // advanced to £125,140 (EMP, SCOT)
          { upToPence: null, rate: 0.48 }, // top (EMP, SCOT)
        ],
        flatRates: {
          BR: 0.2, // SBR = basic
          D0: 0.21, // SD0 = intermediate
          D1: 0.42, // SD1 = higher
        },
      },
    },
    nationalInsurance: {
      primaryThresholdPence: 1_257_000, // £12,570 (EMP)
      upperEarningsLimitPence: 5_027_000, // £50,270 (EMP)
      mainRate: 0.08, // category A (EMP)
      upperRate: 0.02, // above UEL (EMP)
    },
    studentLoans: {
      plan1: { thresholdPence: 2_690_000, rate: 0.09 }, // £26,900 (EMP)
      plan2: { thresholdPence: 2_938_500, rate: 0.09 }, // £29,385 (EMP)
      plan4: { thresholdPence: 3_379_500, rate: 0.09 }, // £33,795 (EMP)
      plan5: { thresholdPence: 2_500_000, rate: 0.09 }, // £25,000 (EMP)
      postgrad: { thresholdPence: 2_100_000, rate: 0.06 }, // £21,000 (EMP)
    },
  },
];
