import { incomeTaxForPeriod } from '../incomeTax';
import { parseTaxCode } from '../taxCode';
import type { ParsedTaxCode, TaxYearConfig } from '../types';

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
        bands: [
          { upToPence: 396_700, rate: 0.19 },
          { upToPence: 1_695_600, rate: 0.2 },
          { upToPence: 3_109_200, rate: 0.21 },
          { upToPence: 6_243_000, rate: 0.42 },
          { upToPence: 12_514_000, rate: 0.45 },
          { upToPence: null, rate: 0.48 },
        ],
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

const year = makeYear('2026/27', '2026-04-06');

function code(text: string): ParsedTaxCode {
  const parsed = parseTaxCode(text);
  if (parsed === null) {
    throw new Error(`bad test code ${text}`);
  }
  return parsed;
}

describe('incomeTaxForPeriod', () => {
  it('1257L monthly £2,500 (rUK): (250000 - 1257900/12) x 20% = £290.35', () => {
    expect(incomeTaxForPeriod(250_000, 'monthly', code('1257L'), year)).toBe(29_035);
  });

  it('S1257L monthly £2,500: starter + basic + some intermediate = £287.43', () => {
    // taxable 145175; 33058.33 x 19% + (141300 - 33058.33) x 20% + (145175 - 141300) x 21%
    expect(incomeTaxForPeriod(250_000, 'monthly', code('S1257L'), year)).toBe(28_743);
  });

  it('1257L weekly £600: (60000 - 1257900/52) x 20% = £71.62', () => {
    expect(incomeTaxForPeriod(60_000, 'weekly', code('1257L'), year)).toBe(7_162);
  });

  it('1257L fortnightly £1,200: (120000 - 1257900/26) x 20% = £143.24', () => {
    expect(incomeTaxForPeriod(120_000, 'fortnightly', code('1257L'), year)).toBe(14_324);
  });

  it('1257L four-weekly £2,000: (200000 - 1257900/13) x 20% = £206.48', () => {
    expect(incomeTaxForPeriod(200_000, 'four_weekly', code('1257L'), year)).toBe(20_648);
  });

  it('1257L monthly £6,000 reaches the higher rate: £1,352.37', () => {
    // basic 314166.67 x 20% = 62833.33; higher (495175 - 314166.67) x 40% = 72403.33
    expect(incomeTaxForPeriod(600_000, 'monthly', code('1257L'), year)).toBe(135_237);
  });

  it('1257L monthly £15,000 reaches the additional rate: £5,128.54', () => {
    // 62833.33 + (1042833.33 - 314166.67) x 40% + (1395175 - 1042833.33) x 45%
    expect(incomeTaxForPeriod(1_500_000, 'monthly', code('1257L'), year)).toBe(512_854);
  });

  it('flat-rate codes tax all pay at one rate (rUK)', () => {
    expect(incomeTaxForPeriod(250_000, 'monthly', code('BR'), year)).toBe(50_000);
    expect(incomeTaxForPeriod(250_000, 'monthly', code('D0'), year)).toBe(100_000);
    expect(incomeTaxForPeriod(250_000, 'monthly', code('D1'), year)).toBe(112_500);
  });

  it('Scottish flat-rate codes use the Scottish rates', () => {
    expect(incomeTaxForPeriod(250_000, 'monthly', code('SBR'), year)).toBe(50_000);
    expect(incomeTaxForPeriod(250_000, 'monthly', code('SD0'), year)).toBe(52_500);
    expect(incomeTaxForPeriod(250_000, 'monthly', code('SD1'), year)).toBe(105_000);
  });

  it('BR rounds once: £123.45 x 20% = 2469 pence', () => {
    expect(incomeTaxForPeriod(12_345, 'weekly', code('BR'), year)).toBe(2_469);
  });

  it('NT pays no tax', () => {
    expect(incomeTaxForPeriod(250_000, 'monthly', code('NT'), year)).toBe(0);
  });

  it('0T taxes all pay through the bands (no allowance)', () => {
    expect(incomeTaxForPeriod(100_000, 'monthly', code('0T'), year)).toBe(20_000);
  });

  it('zero gross pays no tax', () => {
    expect(incomeTaxForPeriod(0, 'monthly', code('1257L'), year)).toBe(0);
    expect(incomeTaxForPeriod(0, 'monthly', code('BR'), year)).toBe(0);
  });

  it('is never negative: pay below the allowance or negative gross gives 0', () => {
    expect(incomeTaxForPeriod(80_000, 'monthly', code('1257L'), year)).toBe(0);
    expect(incomeTaxForPeriod(-5_000, 'weekly', code('D1'), year)).toBe(0);
  });
});
