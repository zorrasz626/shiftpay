/**
 * Estimated net pay for one pay period (SPEC §5, Pro).
 *
 * Combines income tax, employee NI, student loan and pension. Each deduction
 * is rounded once (inside its own function, via `roundPence`); net pay is
 * gross minus the sum of the rounded deductions, never re-rounded.
 * The tax year is picked from `payDate`; `taxYearAssumed` is true when no
 * configured year covers it and the latest one was used instead.
 */
import { sumPence } from '../money';
import type { LocalDate, PayFrequency } from '../types';
import { incomeTaxForPeriod } from './incomeTax';
import { employeeNiForPeriod } from './nationalInsurance';
import { pensionEffect, type PensionSetting } from './pension';
import { studentLoanForPeriod, type StudentLoanSelection } from './studentLoan';
import { taxYearFor } from './taxYear';
import type { ParsedTaxCode, TaxYearConfig } from './types';

export interface NetPayInput {
  grossPence: number;
  frequency: PayFrequency;
  payDate: LocalDate;
  taxCode: ParsedTaxCode;
  studentLoans: StudentLoanSelection;
  /** null = no pension contribution. */
  pension: PensionSetting | null;
  years: readonly TaxYearConfig[];
}

export interface NetPayEstimate {
  /** Id of the tax year used, e.g. `2026/27` (the UI must show it). */
  taxYearId: string;
  taxYearAssumed: boolean;
  incomeTaxPence: number;
  niPence: number;
  studentLoanPence: number;
  pensionPence: number;
  netPence: number;
}

export function estimateNetPay(input: NetPayInput): NetPayEstimate {
  const { year, assumed } = taxYearFor(input.payDate, input.years);
  const { pensionPence, taxablePence, niablePence } = pensionEffect(input.grossPence, input.pension);
  const incomeTaxPence = incomeTaxForPeriod(taxablePence, input.frequency, input.taxCode, year);
  const niPence = employeeNiForPeriod(niablePence, input.frequency, year);
  const studentLoanPence = studentLoanForPeriod(
    niablePence,
    input.frequency,
    input.studentLoans,
    year,
  );
  const deductions = sumPence([incomeTaxPence, niPence, studentLoanPence, pensionPence]);
  return {
    taxYearId: year.id,
    taxYearAssumed: assumed,
    incomeTaxPence,
    niPence,
    studentLoanPence,
    pensionPence,
    netPence: input.grossPence - deductions,
  };
}
