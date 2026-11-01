/**
 * Estimated income tax for one pay period.
 *
 * Per-period basis: the annual allowance and band limits are divided by the
 * number of pay periods per year. That equals cumulative PAYE when pay is the
 * same every period. Rough-estimate limits: no personal-allowance taper above
 * the taper threshold, no rounding of taxable pay to whole pounds, no
 * week-53 or cumulative catch-up. The result is rounded once with `roundPence`.
 */
import { roundPence } from '../money';
import type { PayFrequency } from '../types';
import { PERIODS_PER_YEAR } from './taxYear';
import type { ParsedTaxCode, TaxYearConfig } from './types';

export function incomeTaxForPeriod(
  grossPence: number,
  frequency: PayFrequency,
  code: ParsedTaxCode,
  year: TaxYearConfig,
): number {
  if (grossPence <= 0 || code.kind === 'noTax') {
    return 0;
  }
  const regionConfig = year.incomeTax[code.region];
  if (code.kind === 'flat') {
    return roundPence(grossPence * regionConfig.flatRates[code.flat]);
  }
  const periods = PERIODS_PER_YEAR[frequency];
  const taxable = grossPence - code.allowancePence / periods;
  let tax = 0;
  let lower = 0;
  for (const band of regionConfig.bands) {
    if (taxable <= lower) {
      break;
    }
    const upper = band.upToPence === null ? Infinity : band.upToPence / periods;
    tax += (Math.min(taxable, upper) - lower) * band.rate;
    lower = upper;
  }
  return roundPence(tax);
}
