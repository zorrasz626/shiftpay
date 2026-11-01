/**
 * Builds the net-pay engine input (Pro) from the stored tax profile and a
 * period's gross pay. The tax-year config is passed in by the app (default
 * `TAX_YEARS`); the engine never imports it.
 */
import { TAX_YEARS } from '../../config/taxYears';
import {
  type NetPayInput,
  type ParsedTaxCode,
  type TaxYearConfig,
  parseTaxCode,
} from '../../engine/netPay';
import type { LocalDate, PayFrequency } from '../../engine/types';
import { DEFAULT_TAX_PROFILE, type TaxProfile } from './taxProfile';

export interface NetPayInputArgs {
  profile: TaxProfile;
  grossPence: number;
  frequency: PayFrequency;
  payDate: LocalDate;
  years?: readonly TaxYearConfig[];
}

/** The profile's tax code, or the default (1257L) if it somehow does not parse. */
function taxCodeOf(profile: TaxProfile): ParsedTaxCode {
  return (
    parseTaxCode(profile.taxCode) ?? (parseTaxCode(DEFAULT_TAX_PROFILE.taxCode) as ParsedTaxCode)
  );
}

export function buildNetPayInput({
  profile,
  grossPence,
  frequency,
  payDate,
  years = TAX_YEARS,
}: NetPayInputArgs): NetPayInput {
  return {
    grossPence,
    frequency,
    payDate,
    taxCode: taxCodeOf(profile),
    studentLoans: {
      plan: profile.studentLoan === 'none' ? null : profile.studentLoan,
      postgrad: profile.postgrad,
    },
    pension:
      profile.pensionPercent === 0
        ? null
        : { percent: profile.pensionPercent, method: profile.pensionMethod },
    years,
  };
}
