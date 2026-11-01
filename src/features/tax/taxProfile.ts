/**
 * Tax profile (SPEC §7.8 "tax settings"): the inputs the net-pay estimate
 * needs, stored as one validated settings value under `tax.profile`.
 * Reading never throws: a missing or corrupt value gives the default.
 * `pensionPercent` is a decimal percentage (5 = 5%), not money.
 */
import { z } from 'zod';

import { type PensionMethod, parseTaxCode } from '../../engine/netPay';

export const TAX_PROFILE_KEY = 'tax.profile';

export const STUDENT_LOAN_OPTIONS = ['none', 'plan1', 'plan2', 'plan4', 'plan5'] as const;
export type StudentLoanOption = (typeof STUDENT_LOAN_OPTIONS)[number];

export const PENSION_METHODS = ['net_pay', 'relief_at_source', 'salary_sacrifice'] as const;

export const STUDENT_LOAN_LABELS: Record<StudentLoanOption, string> = {
  none: 'None',
  plan1: 'Plan 1',
  plan2: 'Plan 2',
  plan4: 'Plan 4',
  plan5: 'Plan 5',
};

export const PENSION_METHOD_LABELS: Record<PensionMethod, string> = {
  net_pay: 'Net pay',
  relief_at_source: 'Relief at source',
  salary_sacrifice: 'Salary sacrifice',
};

/** True when `n` has at most 2 decimal places (tolerant of float noise like 0.29 * 100). */
function atMostTwoDp(n: number): boolean {
  const scaled = n * 100;
  return Math.abs(scaled - Math.round(scaled)) < 1e-9;
}

export const taxProfileSchema = z.object({
  taxCode: z.string().refine((code) => parseTaxCode(code) !== null),
  studentLoan: z.enum(STUDENT_LOAN_OPTIONS),
  postgrad: z.boolean(),
  pensionPercent: z.number().finite().min(0).max(100).refine(atMostTwoDp),
  pensionMethod: z.enum(PENSION_METHODS),
});

export type TaxProfile = z.infer<typeof taxProfileSchema>;

export const DEFAULT_TAX_PROFILE: TaxProfile = {
  taxCode: '1257L',
  studentLoan: 'none',
  postgrad: false,
  pensionPercent: 0,
  pensionMethod: 'net_pay',
};

/** The stored profile if it is valid, else the default. Never throws. */
export function readTaxProfile(values: Record<string, unknown>): TaxProfile {
  const parsed = taxProfileSchema.safeParse(values[TAX_PROFILE_KEY]);
  return parsed.success ? parsed.data : { ...DEFAULT_TAX_PROFILE };
}

export const TAX_CODE_EMPTY_MESSAGE = 'Enter your tax code, e.g. 1257L';
export const TAX_CODE_UNSUPPORTED_MESSAGE = "This tax code isn't supported yet";
export const TAX_CODE_INVALID_MESSAGE =
  "This doesn't look like a tax code. Check your payslip, e.g. 1257L";
export const PENSION_PERCENT_MESSAGE = 'Enter a percentage from 0 to 100';

/** K codes and emergency (W1 / M1 / X) codes: real, but not handled by the estimate. */
const UNSUPPORTED_CODE_PATTERN = /^[SC]?(K\d+|(\d+[LMNT]|BR|D0|D1|NT|K\d+)(W1|M1|X))$/;

/**
 * Checks a typed tax code. Returns the normalised code (upper case, no
 * spaces) or an error message.
 */
export function checkTaxCode(text: string): { code: string } | { error: string } {
  const compact = text.replace(/\s+/g, '').toUpperCase();
  if (compact === '') return { error: TAX_CODE_EMPTY_MESSAGE };
  const parsed = parseTaxCode(compact);
  if (parsed !== null) return { code: parsed.code };
  if (UNSUPPORTED_CODE_PATTERN.test(compact)) return { error: TAX_CODE_UNSUPPORTED_MESSAGE };
  return { error: TAX_CODE_INVALID_MESSAGE };
}

/** "5", "5.5", "12.25" → number; anything else (or over 100) → null. */
export function parsePensionPercent(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n <= 100 ? n : null;
}

/** "No student loan", "Plan 2", "Plan 2 + postgraduate", "Postgraduate loan". */
export function studentLoanSummary(profile: TaxProfile): string {
  if (profile.studentLoan === 'none') return profile.postgrad ? 'Postgraduate loan' : 'No student loan';
  const plan = STUDENT_LOAN_LABELS[profile.studentLoan];
  return profile.postgrad ? `${plan} + postgraduate` : plan;
}

/** "No student loan · No pension", "Plan 2 · Pension 5%". */
export function taxProfileSummary(profile: TaxProfile): string {
  const pension = profile.pensionPercent === 0 ? 'No pension' : `Pension ${profile.pensionPercent}%`;
  return `${studentLoanSummary(profile)} · ${pension}`;
}
