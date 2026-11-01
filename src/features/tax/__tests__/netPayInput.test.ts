import { TAX_YEARS } from '../../../config/taxYears';
import { estimateNetPay, parseTaxCode } from '../../../engine/netPay';
import { buildNetPayInput } from '../netPayInput';
import { DEFAULT_TAX_PROFILE, type TaxProfile } from '../taxProfile';

const base = { grossPence: 60_000, frequency: 'weekly', payDate: '2026-06-19' } as const;

describe('buildNetPayInput', () => {
  it('default profile: 1257L, no loans, no pension, the configured tax years', () => {
    const input = buildNetPayInput({ ...base, profile: DEFAULT_TAX_PROFILE });
    expect(input).toEqual({
      ...base,
      taxCode: parseTaxCode('1257L'),
      studentLoans: { plan: null, postgrad: false },
      pension: null,
      years: TAX_YEARS,
    });
    const estimate = estimateNetPay(input);
    expect(estimate.taxYearId).toBe('2026/27');
    expect(estimate.incomeTaxPence).toBeGreaterThan(0);
  });

  it('maps student loan, postgrad and pension from the profile', () => {
    const profile: TaxProfile = {
      taxCode: 'S1257L',
      studentLoan: 'plan2',
      postgrad: true,
      pensionPercent: 5,
      pensionMethod: 'salary_sacrifice',
    };
    const input = buildNetPayInput({ ...base, profile });
    expect(input.taxCode).toEqual(parseTaxCode('S1257L'));
    expect(input.studentLoans).toEqual({ plan: 'plan2', postgrad: true });
    expect(input.pension).toEqual({ percent: 5, method: 'salary_sacrifice' });
  });

  it('postgraduate loan only', () => {
    const profile: TaxProfile = { ...DEFAULT_TAX_PROFILE, postgrad: true };
    expect(buildNetPayInput({ ...base, profile }).studentLoans).toEqual({
      plan: null,
      postgrad: true,
    });
  });

  it('falls back to 1257L when the tax code does not parse', () => {
    const profile: TaxProfile = { ...DEFAULT_TAX_PROFILE, taxCode: 'NOPE' };
    expect(buildNetPayInput({ ...base, profile }).taxCode).toEqual(parseTaxCode('1257L'));
  });

  it('uses the years passed in', () => {
    const years = [TAX_YEARS[0]];
    expect(buildNetPayInput({ ...base, profile: DEFAULT_TAX_PROFILE, years }).years).toBe(years);
  });
});
