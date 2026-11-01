/**
 * Estimated student-loan repayments for one pay period.
 *
 * At most one undergraduate plan (1, 2, 4 or 5) plus, optionally, a
 * postgraduate loan; both can apply at once. Each repayment is
 * `rate x (pay - annual threshold / periods per year)`, rounded once with
 * `roundPence`; the total is the sum of those (never re-rounded).
 * Callers pass NI-able pay (repayments are not reduced by net-pay pensions).
 */
import { roundPence, sumPence } from '../money';
import type { PayFrequency } from '../types';
import { PERIODS_PER_YEAR } from './taxYear';
import type { StudentLoanPlan, TaxYearConfig } from './types';

export type UndergraduatePlan = Exclude<StudentLoanPlan, 'postgrad'>;

export interface StudentLoanSelection {
  /** The undergraduate plan, or null for none. */
  plan: UndergraduatePlan | null;
  /** True when a postgraduate loan is also being repaid. */
  postgrad: boolean;
}

/** Repayment for one plan in one pay period, in whole pence (0 at or below the threshold). */
export function studentLoanPlanForPeriod(
  pence: number,
  frequency: PayFrequency,
  plan: StudentLoanPlan,
  year: TaxYearConfig,
): number {
  const { thresholdPence, rate } = year.studentLoans[plan];
  const excess = pence - thresholdPence / PERIODS_PER_YEAR[frequency];
  return excess > 0 ? roundPence(excess * rate) : 0;
}

/** Total student-loan repayments for one pay period, in whole pence. */
export function studentLoanForPeriod(
  pence: number,
  frequency: PayFrequency,
  loans: StudentLoanSelection,
  year: TaxYearConfig,
): number {
  const plans: StudentLoanPlan[] = [];
  if (loans.plan !== null) {
    plans.push(loans.plan);
  }
  if (loans.postgrad) {
    plans.push('postgrad');
  }
  return sumPence(plans.map((plan) => studentLoanPlanForPeriod(pence, frequency, plan, year)));
}
