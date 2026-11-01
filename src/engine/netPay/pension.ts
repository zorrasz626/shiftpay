/**
 * Workplace pension contribution, as a percentage of gross pay.
 *
 * - `salary_sacrifice`: pay is reduced before income tax, NI and student loan.
 * - `net_pay`: the contribution comes off pay before income tax only.
 * - `relief_at_source`: taken after tax at 80% of the contribution (the
 *   provider claims basic-rate relief, assumed 20%); tax, NI and student loan
 *   are worked out on full gross.
 * The contribution is rounded once with `roundPence`.
 */
import { roundPence } from '../money';

export type PensionMethod = 'net_pay' | 'relief_at_source' | 'salary_sacrifice';

export interface PensionSetting {
  /** Employee contribution as a percentage of gross pay (5 = 5%). */
  percent: number;
  method: PensionMethod;
}

/** Share of a relief-at-source contribution the employee pays (basic-rate relief of 20%). */
export const RELIEF_AT_SOURCE_FACTOR = 0.8;

export interface PensionEffect {
  /** Amount taken from pay, in whole pence. */
  pensionPence: number;
  /** Pay that income tax is worked out on. */
  taxablePence: number;
  /** Pay that NI and student loan are worked out on. */
  niablePence: number;
}

export function pensionEffect(grossPence: number, pension: PensionSetting | null): PensionEffect {
  if (pension === null) {
    return { pensionPence: 0, taxablePence: grossPence, niablePence: grossPence };
  }
  const share = (grossPence * pension.percent) / 100;
  switch (pension.method) {
    case 'salary_sacrifice': {
      const pensionPence = roundPence(share);
      const reduced = grossPence - pensionPence;
      return { pensionPence, taxablePence: reduced, niablePence: reduced };
    }
    case 'net_pay': {
      const pensionPence = roundPence(share);
      return { pensionPence, taxablePence: grossPence - pensionPence, niablePence: grossPence };
    }
    case 'relief_at_source':
      return {
        pensionPence: roundPence(share * RELIEF_AT_SOURCE_FACTOR),
        taxablePence: grossPence,
        niablePence: grossPence,
      };
  }
}
