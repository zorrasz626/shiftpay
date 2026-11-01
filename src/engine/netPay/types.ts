/**
 * Net-pay (Pro) types. Type-only: no runtime code.
 *
 * Money is integer pence; rates are decimals (0.2 = 20%). All amounts are
 * annual; the engine divides them by the number of pay periods per year.
 * The engine never imports the tax-year config: callers pass it in.
 */
import type { LocalDate } from '../types';

/** Which income-tax bands apply: rest of UK (England, Wales, NI) or Scotland. */
export type TaxRegion = 'ruk' | 'scotland';

/** Codes that tax all pay at one rate (no allowance). */
export type FlatRateCode = 'BR' | 'D0' | 'D1';

export type StudentLoanPlan = 'plan1' | 'plan2' | 'plan4' | 'plan5' | 'postgrad';

/**
 * One income-tax band. `upToPence` is the annual upper limit of TAXABLE income
 * (income above the allowance), cumulative from 0; `null` = no upper limit
 * (must be the last band).
 */
export interface TaxBand {
  upToPence: number | null;
  rate: number;
}

export interface IncomeTaxRegionConfig {
  /** Bands in ascending order; the last one has `upToPence: null`. */
  bands: TaxBand[];
  /** Rate for each flat-rate code (e.g. rUK D0 = higher, Scottish SD0 = intermediate). */
  flatRates: Record<FlatRateCode, number>;
}

export interface NationalInsuranceConfig {
  /** Annual primary threshold (employee NI starts above this). */
  primaryThresholdPence: number;
  /** Annual upper earnings limit (main rate up to here, upper rate above). */
  upperEarningsLimitPence: number;
  mainRate: number;
  upperRate: number;
}

export interface StudentLoanConfig {
  /** Annual repayment threshold. */
  thresholdPence: number;
  rate: number;
}

/** Tax-year values. A UK tax year runs from 6 April to 5 April. */
export interface TaxYearConfig {
  /** Display id, e.g. `2026/27`. */
  id: string;
  /** First day of the tax year (6 April). */
  startsOn: LocalDate;
  personalAllowancePence: number;
  /** Income above which the personal allowance tapers (not applied by the estimate). */
  allowanceTaperThresholdPence: number;
  incomeTax: Record<TaxRegion, IncomeTaxRegionConfig>;
  nationalInsurance: NationalInsuranceConfig;
  studentLoans: Record<StudentLoanPlan, StudentLoanConfig>;
}

/** A parsed, supported PAYE tax code. */
export type ParsedTaxCode =
  | {
      kind: 'allowance';
      region: TaxRegion;
      /** Annual tax-free allowance (digits x £10 + £9; 0 for `0T`). */
      allowancePence: number;
      /** Normalised code, e.g. `S1257L`. */
      code: string;
    }
  | { kind: 'flat'; region: TaxRegion; flat: FlatRateCode; code: string }
  | { kind: 'noTax'; code: string };
