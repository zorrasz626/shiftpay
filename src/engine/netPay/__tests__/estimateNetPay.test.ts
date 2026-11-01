import {
  RELIEF_AT_SOURCE_FACTOR,
  estimateNetPay,
  parseTaxCode,
  pensionEffect,
  type NetPayInput,
  type ParsedTaxCode,
  type TaxYearConfig,
} from '..';

/** Test tax year (independent of src/config so hand-computed values stay fixed). */
function makeYear(id: string, startsOn: string): TaxYearConfig {
  return {
    id,
    startsOn,
    personalAllowancePence: 1_257_000,
    allowanceTaperThresholdPence: 10_000_000,
    incomeTax: {
      ruk: {
        bands: [
          { upToPence: 3_770_000, rate: 0.2 },
          { upToPence: 12_514_000, rate: 0.4 },
          { upToPence: null, rate: 0.45 },
        ],
        flatRates: { BR: 0.2, D0: 0.4, D1: 0.45 },
      },
      scotland: {
        bands: [{ upToPence: null, rate: 0.2 }],
        flatRates: { BR: 0.2, D0: 0.21, D1: 0.42 },
      },
    },
    nationalInsurance: {
      primaryThresholdPence: 1_257_000,
      upperEarningsLimitPence: 5_027_000,
      mainRate: 0.08,
      upperRate: 0.02,
    },
    studentLoans: {
      plan1: { thresholdPence: 2_690_000, rate: 0.09 },
      plan2: { thresholdPence: 2_938_500, rate: 0.09 },
      plan4: { thresholdPence: 3_379_500, rate: 0.09 },
      plan5: { thresholdPence: 2_500_000, rate: 0.09 },
      postgrad: { thresholdPence: 2_100_000, rate: 0.06 },
    },
  };
}

const year2026 = makeYear('2026/27', '2026-04-06');
const year2027 = makeYear('2027/28', '2027-04-06');

function code(text: string): ParsedTaxCode {
  const parsed = parseTaxCode(text);
  if (parsed === null) {
    throw new Error(`bad test code ${text}`);
  }
  return parsed;
}

/** Monthly £2,500, 1257L, plan 2, paid 28 Nov 2026. */
function input(overrides: Partial<NetPayInput> = {}): NetPayInput {
  return {
    grossPence: 250_000,
    frequency: 'monthly',
    payDate: '2026-11-28',
    taxCode: code('1257L'),
    studentLoans: { plan: 'plan2', postgrad: false },
    pension: null,
    years: [year2026],
    ...overrides,
  };
}

function totalDeductions(r: ReturnType<typeof estimateNetPay>): number {
  return r.incomeTaxPence + r.niPence + r.studentLoanPence + r.pensionPence;
}

describe('estimateNetPay', () => {
  it('worked example: monthly £2,500, 1257L, plan 2, 5% net_pay', () => {
    // Pension (net_pay): 250000 x 5% = 12500 (£125.00); taxable pay = 237500.
    // Income tax: allowance 1257900/12 = 104825; (237500 - 104825) x 20% = 26535 (£265.35).
    // NI on full gross: PT 1257000/12 = 104750; (250000 - 104750) x 8% = 11620 (£116.20).
    // Plan 2 on full gross: 2938500/12 = 244875; (250000 - 244875) x 9% = 461.25 -> 461 (£4.61).
    // Deductions = 26535 + 11620 + 461 + 12500 = 51116; net = 250000 - 51116 = 198884 (£1,988.84).
    const result = estimateNetPay(input({ pension: { percent: 5, method: 'net_pay' } }));
    expect(result).toEqual({
      taxYearId: '2026/27',
      taxYearAssumed: false,
      incomeTaxPence: 26_535,
      niPence: 11_620,
      studentLoanPence: 461,
      pensionPence: 12_500,
      netPence: 198_884,
    });
    expect(result.netPence).toBe(250_000 - totalDeductions(result));
  });

  it('no pension: tax on full gross (250000 - 104825) x 20% = 29035', () => {
    const result = estimateNetPay(input());
    expect(result).toMatchObject({
      incomeTaxPence: 29_035,
      niPence: 11_620,
      studentLoanPence: 461,
      pensionPence: 0,
      netPence: 208_884,
    });
  });

  it('salary_sacrifice reduces pay for tax, NI and student loan', () => {
    // Pay after sacrifice 237500: tax 26535; NI (237500 - 104750) x 8% = 10620;
    // plan 2: 237500 < 244875 -> 0. Net = 250000 - 26535 - 10620 - 0 - 12500 = 200345.
    const result = estimateNetPay(input({ pension: { percent: 5, method: 'salary_sacrifice' } }));
    expect(result).toMatchObject({
      incomeTaxPence: 26_535,
      niPence: 10_620,
      studentLoanPence: 0,
      pensionPence: 12_500,
      netPence: 200_345,
    });
    expect(result.netPence).toBe(250_000 - totalDeductions(result));
  });

  it('relief_at_source changes no other deduction and takes 80% of the contribution', () => {
    // 12500 x 0.8 = 10000; tax/NI/SL as with no pension.
    // Net = 250000 - 29035 - 11620 - 461 - 10000 = 198884.
    const result = estimateNetPay(input({ pension: { percent: 5, method: 'relief_at_source' } }));
    expect(result).toMatchObject({
      incomeTaxPence: 29_035,
      niPence: 11_620,
      studentLoanPence: 461,
      pensionPence: 10_000,
      netPence: 198_884,
    });
    expect(result.netPence).toBe(250_000 - totalDeductions(result));
  });

  it('picks the tax year containing the pay date', () => {
    const result = estimateNetPay(input({ payDate: '2027-04-06', years: [year2026, year2027] }));
    expect(result.taxYearId).toBe('2027/28');
    expect(result.taxYearAssumed).toBe(false);
  });

  it('flags an assumed tax year when none covers the pay date', () => {
    const result = estimateNetPay(input({ payDate: '2027-05-01' }));
    expect(result.taxYearId).toBe('2026/27');
    expect(result.taxYearAssumed).toBe(true);
  });

  it('zero gross -> all zero', () => {
    const result = estimateNetPay(
      input({ grossPence: 0, pension: { percent: 5, method: 'net_pay' } }),
    );
    expect(result).toMatchObject({
      incomeTaxPence: 0,
      niPence: 0,
      studentLoanPence: 0,
      pensionPence: 0,
      netPence: 0,
    });
  });
});

describe('pensionEffect', () => {
  it('rounds the contribution once: 123457 x 3% = 3703.71 -> 3704', () => {
    expect(pensionEffect(123_457, { percent: 3, method: 'net_pay' })).toEqual({
      pensionPence: 3_704,
      taxablePence: 119_753,
      niablePence: 123_457,
    });
    expect(pensionEffect(123_457, { percent: 3, method: 'salary_sacrifice' })).toEqual({
      pensionPence: 3_704,
      taxablePence: 119_753,
      niablePence: 119_753,
    });
  });

  it('relief_at_source: 3703.71 x 0.8 = 2962.968 -> 2963, pay unchanged', () => {
    expect(RELIEF_AT_SOURCE_FACTOR).toBe(0.8);
    expect(pensionEffect(123_457, { percent: 3, method: 'relief_at_source' })).toEqual({
      pensionPence: 2_963,
      taxablePence: 123_457,
      niablePence: 123_457,
    });
  });

  it('no pension leaves pay unchanged', () => {
    expect(pensionEffect(123_457, null)).toEqual({
      pensionPence: 0,
      taxablePence: 123_457,
      niablePence: 123_457,
    });
  });
});
