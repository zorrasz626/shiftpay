/**
 * UK tax-year values for the estimated net pay (Pro). One object per tax year,
 * each starting 6 April. The engine never imports this file; app code passes
 * `TAX_YEARS` in, and the UI shows the `id` of the year it used.
 *
 * MUST be checked against gov.uk every April (and after each Budget / Scottish
 * Budget): every value marked TODO-VERIFY is a best-known figure, not yet
 * confirmed. Money is integer pence; rates are decimals.
 */
import type { TaxYearConfig } from '../engine/netPay/types';

export const TAX_YEARS: TaxYearConfig[] = [
  {
    id: '2026/27',
    startsOn: '2026-04-06',
    personalAllowancePence: 1_257_000, // TODO-VERIFY gov.uk (£12,570)
    allowanceTaperThresholdPence: 10_000_000, // TODO-VERIFY gov.uk (£100,000)
    incomeTax: {
      // Band limits are taxable income above the allowance.
      ruk: {
        bands: [
          { upToPence: 3_770_000, rate: 0.2 }, // TODO-VERIFY gov.uk basic £0-£37,700
          { upToPence: 12_514_000, rate: 0.4 }, // TODO-VERIFY gov.uk higher to £125,140
          { upToPence: null, rate: 0.45 }, // TODO-VERIFY gov.uk additional
        ],
        flatRates: {
          BR: 0.2, // TODO-VERIFY gov.uk basic
          D0: 0.4, // TODO-VERIFY gov.uk higher
          D1: 0.45, // TODO-VERIFY gov.uk additional
        },
      },
      scotland: {
        bands: [
          { upToPence: 396_700, rate: 0.19 }, // TODO-VERIFY gov.uk starter £0-£3,967
          { upToPence: 1_695_600, rate: 0.2 }, // TODO-VERIFY gov.uk basic to £16,956
          { upToPence: 3_109_200, rate: 0.21 }, // TODO-VERIFY gov.uk intermediate to £31,092
          { upToPence: 6_243_000, rate: 0.42 }, // TODO-VERIFY gov.uk higher to £62,430
          { upToPence: 12_514_000, rate: 0.45 }, // TODO-VERIFY gov.uk advanced to £125,140
          { upToPence: null, rate: 0.48 }, // TODO-VERIFY gov.uk top
        ],
        flatRates: {
          BR: 0.2, // TODO-VERIFY gov.uk SBR = basic
          D0: 0.21, // TODO-VERIFY gov.uk SD0 = intermediate
          D1: 0.42, // TODO-VERIFY gov.uk SD1 = higher
        },
      },
    },
    nationalInsurance: {
      primaryThresholdPence: 1_257_000, // TODO-VERIFY gov.uk (£12,570)
      upperEarningsLimitPence: 5_027_000, // TODO-VERIFY gov.uk (£50,270)
      mainRate: 0.08, // TODO-VERIFY gov.uk
      upperRate: 0.02, // TODO-VERIFY gov.uk
    },
    studentLoans: {
      plan1: { thresholdPence: 2_690_000, rate: 0.09 }, // TODO-VERIFY gov.uk (£26,900)
      plan2: { thresholdPence: 2_938_500, rate: 0.09 }, // TODO-VERIFY gov.uk (£29,385)
      plan4: { thresholdPence: 3_379_500, rate: 0.09 }, // TODO-VERIFY gov.uk (£33,795)
      plan5: { thresholdPence: 2_500_000, rate: 0.09 }, // TODO-VERIFY gov.uk (£25,000)
      postgrad: { thresholdPence: 2_100_000, rate: 0.06 }, // TODO-VERIFY gov.uk (£21,000)
    },
  },
];
