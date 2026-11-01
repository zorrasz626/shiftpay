/**
 * @jest-environment node
 */
import { exportBackup } from '../../../db/backup';
import { importBackup } from '../../../db/backupImport';
import { getAllSettings, setSetting } from '../../../db/settingsRepo';
import { createTestDb } from '../../../db/testDb';
import {
  DEFAULT_TAX_PROFILE,
  PENSION_PERCENT_MESSAGE,
  TAX_CODE_EMPTY_MESSAGE,
  TAX_CODE_INVALID_MESSAGE,
  TAX_CODE_UNSUPPORTED_MESSAGE,
  TAX_PROFILE_KEY,
  type TaxProfile,
  checkTaxCode,
  parsePensionPercent,
  readTaxProfile,
  taxProfileSummary,
} from '../taxProfile';

const valid: TaxProfile = {
  taxCode: 'S1257L',
  studentLoan: 'plan2',
  postgrad: true,
  pensionPercent: 5.5,
  pensionMethod: 'salary_sacrifice',
};

const withProfile = (value: unknown) => ({ [TAX_PROFILE_KEY]: value });

describe('readTaxProfile', () => {
  it('gives the default when nothing is stored', () => {
    expect(readTaxProfile({})).toEqual(DEFAULT_TAX_PROFILE);
    expect(DEFAULT_TAX_PROFILE).toEqual({
      taxCode: '1257L',
      studentLoan: 'none',
      postgrad: false,
      pensionPercent: 0,
      pensionMethod: 'net_pay',
    });
  });

  it('returns a valid stored profile', () => {
    expect(readTaxProfile(withProfile(valid))).toEqual(valid);
    expect(readTaxProfile(withProfile({ ...valid, pensionPercent: 100 }))).toEqual({
      ...valid,
      pensionPercent: 100,
    });
    expect(readTaxProfile(withProfile({ ...valid, pensionPercent: 0.29 })).pensionPercent).toBe(0.29);
  });

  it('gives the default for corrupt values, never throwing', () => {
    for (const bad of [
      null,
      'S1257L',
      42,
      [],
      { ...valid, taxCode: undefined },
      { ...valid, taxCode: 'K475' },
      { ...valid, taxCode: 'hello' },
      { ...valid, studentLoan: 'plan3' },
      { ...valid, postgrad: 'yes' },
      { ...valid, pensionMethod: 'other' },
      { ...valid, pensionPercent: '5' },
    ]) {
      expect(readTaxProfile(withProfile(bad))).toEqual(DEFAULT_TAX_PROFILE);
    }
  });

  it('gives the default for an out-of-range or over-precise percent', () => {
    for (const pensionPercent of [-1, 100.01, 101, Number.NaN, Number.POSITIVE_INFINITY, 5.123]) {
      expect(readTaxProfile(withProfile({ ...valid, pensionPercent }))).toEqual(DEFAULT_TAX_PROFILE);
    }
  });

  it('returns a fresh default each time', () => {
    const a = readTaxProfile({});
    a.taxCode = 'BR';
    expect(readTaxProfile({}).taxCode).toBe('1257L');
  });
});

describe('checkTaxCode', () => {
  it('normalises supported codes', () => {
    expect(checkTaxCode(' 1257 l ')).toEqual({ code: '1257L' });
    expect(checkTaxCode('sbr')).toEqual({ code: 'SBR' });
    expect(checkTaxCode('NT')).toEqual({ code: 'NT' });
  });

  it('says when a code is empty, unsupported or not a tax code', () => {
    expect(checkTaxCode('  ')).toEqual({ error: TAX_CODE_EMPTY_MESSAGE });
    for (const code of ['K475', 'SK100', '1257L W1', '1257LM1', '1257LX', 'BRW1']) {
      expect(checkTaxCode(code)).toEqual({ error: TAX_CODE_UNSUPPORTED_MESSAGE });
    }
    for (const code of ['hello', '1257', 'L1257']) {
      expect(checkTaxCode(code)).toEqual({ error: TAX_CODE_INVALID_MESSAGE });
    }
    expect(PENSION_PERCENT_MESSAGE).toMatch(/0 to 100/);
  });
});

describe('parsePensionPercent', () => {
  it('reads whole and up-to-2-dp percentages from 0 to 100', () => {
    expect(parsePensionPercent('0')).toBe(0);
    expect(parsePensionPercent(' 5 ')).toBe(5);
    expect(parsePensionPercent('12.25')).toBe(12.25);
    expect(parsePensionPercent('100')).toBe(100);
  });

  it('rejects anything else', () => {
    for (const text of ['', '-1', '5.123', '100.5', '101', 'abc', '5%', '.5']) {
      expect(parsePensionPercent(text)).toBeNull();
    }
  });
});

describe('taxProfileSummary', () => {
  it('summarises student loans and pension', () => {
    expect(taxProfileSummary(DEFAULT_TAX_PROFILE)).toBe('No student loan · No pension');
    expect(taxProfileSummary(valid)).toBe('Plan 2 + postgraduate · Pension 5.5%');
    expect(taxProfileSummary({ ...valid, postgrad: false, pensionPercent: 5 })).toBe(
      'Plan 2 · Pension 5%',
    );
    expect(taxProfileSummary({ ...DEFAULT_TAX_PROFILE, postgrad: true })).toBe(
      'Postgraduate loan · No pension',
    );
  });
});

describe('backup round-trip', () => {
  it('keeps tax.profile through export and import', async () => {
    const source = createTestDb();
    await setSetting(source, TAX_PROFILE_KEY, valid);
    const backup = JSON.parse(
      JSON.stringify(await exportBackup(source, '2026-11-01T09:00:00.000Z')),
    ) as Awaited<ReturnType<typeof exportBackup>>;

    const target = createTestDb();
    await setSetting(target, TAX_PROFILE_KEY, DEFAULT_TAX_PROFILE);
    await importBackup(target, backup);
    expect(readTaxProfile(await getAllSettings(target))).toEqual(valid);
  });
});
