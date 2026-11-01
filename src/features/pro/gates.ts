/**
 * Free vs Pro limits (SPEC §8). Pure: callers pass `isPro` from
 * `useEntitlement()`. Gates only block adding or opening Pro features; they
 * never delete or ignore data a user already has (e.g. rules over the limit
 * from a backup or a lapsed subscription still count in pay).
 */

export const FREE_LIMITS = { jobs: 1, rotaPatterns: 1, rules: 2 } as const;

/** Features that are Pro-only, with nothing included for free. */
export type ProFeature = 'netPay' | 'payslipLines' | 'payslipExport' | 'stats' | 'backupExport';

function underLimit(count: number, limit: number, isPro: boolean): boolean {
  return isPro || count < limit;
}

/** `ruleCount` = premium + overtime rules for the job. */
export function canAddRule(ruleCount: number, isPro: boolean): boolean {
  return underLimit(ruleCount, FREE_LIMITS.rules, isPro);
}

export function canAddJob(jobCount: number, isPro: boolean): boolean {
  return underLimit(jobCount, FREE_LIMITS.jobs, isPro);
}

export function canAddRotaPattern(patternCount: number, isPro: boolean): boolean {
  return underLimit(patternCount, FREE_LIMITS.rotaPatterns, isPro);
}

export function hasFeature(_feature: ProFeature, isPro: boolean): boolean {
  return isPro;
}
