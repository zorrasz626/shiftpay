/**
 * Estimated employee Class 1 National Insurance for one pay period.
 *
 * Per-period basis: the annual primary threshold (PT) and upper earnings limit
 * (UEL) are divided by the number of pay periods per year (HMRC rounds its
 * published weekly/monthly thresholds; this estimate does not). Main rate on
 * pay between PT and UEL, upper rate on pay above the UEL.
 * The result is rounded once with `roundPence`; never negative.
 */
import { roundPence } from '../money';
import type { PayFrequency } from '../types';
import { PERIODS_PER_YEAR } from './taxYear';
import type { TaxYearConfig } from './types';

export function employeeNiForPeriod(
  niablePence: number,
  frequency: PayFrequency,
  year: TaxYearConfig,
): number {
  const periods = PERIODS_PER_YEAR[frequency];
  const { primaryThresholdPence, upperEarningsLimitPence, mainRate, upperRate } =
    year.nationalInsurance;
  const threshold = primaryThresholdPence / periods;
  const upperLimit = upperEarningsLimitPence / periods;
  const mainBand = Math.max(0, Math.min(niablePence, upperLimit) - threshold);
  const upperBand = Math.max(0, niablePence - upperLimit);
  return roundPence(mainBand * mainRate + upperBand * upperRate);
}
