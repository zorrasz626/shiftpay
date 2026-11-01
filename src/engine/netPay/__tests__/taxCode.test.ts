import { parseTaxCode } from '../taxCode';

describe('parseTaxCode', () => {
  it('parses 1257L as an rUK allowance of £12,579', () => {
    expect(parseTaxCode('1257L')).toEqual({
      kind: 'allowance',
      region: 'ruk',
      allowancePence: 1_257_900,
      code: '1257L',
    });
  });

  it.each(['1257M', '1257N', '1257T'])('accepts the %s suffix', (text) => {
    expect(parseTaxCode(text)).toMatchObject({ kind: 'allowance', allowancePence: 1_257_900 });
  });

  it('is case- and space-insensitive', () => {
    expect(parseTaxCode(' s 1257 l ')).toEqual({
      kind: 'allowance',
      region: 'scotland',
      allowancePence: 1_257_900,
      code: 'S1257L',
    });
    expect(parseTaxCode('br')).toEqual({ kind: 'flat', region: 'ruk', flat: 'BR', code: 'BR' });
  });

  it('S prefix means Scottish bands, C prefix means rUK bands', () => {
    expect(parseTaxCode('S1100L')).toMatchObject({ region: 'scotland', allowancePence: 1_100_900 });
    expect(parseTaxCode('C1257L')).toMatchObject({ region: 'ruk', code: 'C1257L' });
  });

  it('0T means no allowance', () => {
    expect(parseTaxCode('0T')).toEqual({
      kind: 'allowance',
      region: 'ruk',
      allowancePence: 0,
      code: '0T',
    });
    expect(parseTaxCode('S0T')).toMatchObject({ region: 'scotland', allowancePence: 0 });
  });

  it('parses flat-rate codes with and without a prefix', () => {
    expect(parseTaxCode('D0')).toEqual({ kind: 'flat', region: 'ruk', flat: 'D0', code: 'D0' });
    expect(parseTaxCode('D1')).toEqual({ kind: 'flat', region: 'ruk', flat: 'D1', code: 'D1' });
    expect(parseTaxCode('SBR')).toEqual({
      kind: 'flat',
      region: 'scotland',
      flat: 'BR',
      code: 'SBR',
    });
    expect(parseTaxCode('sd1')).toEqual({
      kind: 'flat',
      region: 'scotland',
      flat: 'D1',
      code: 'SD1',
    });
    expect(parseTaxCode('CD0')).toEqual({ kind: 'flat', region: 'ruk', flat: 'D0', code: 'CD0' });
  });

  it('parses NT', () => {
    expect(parseTaxCode('NT')).toEqual({ kind: 'noTax', code: 'NT' });
    expect(parseTaxCode('nt')).toEqual({ kind: 'noTax', code: 'NT' });
  });

  it.each([
    'K475',
    'SK475',
    '1257L W1',
    '1257LM1',
    '1257L X',
    '1257',
    'L',
    '',
    '   ',
    'D2',
    'XX1257L',
    '1257Q',
    'hello',
    '12-57L',
  ])('rejects %p', (text) => {
    expect(parseTaxCode(text)).toBeNull();
  });
});
