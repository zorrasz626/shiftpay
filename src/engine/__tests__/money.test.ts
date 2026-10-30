import {
  formatPence,
  parsePoundsToPence,
  roundPence,
  segmentPence,
  sumPence,
} from '../money';

describe('roundPence', () => {
  it('clears float noise before rounding (0.285 x 100 -> 29, not 28)', () => {
    expect(0.285 * 100).toBeLessThan(28.5); // proves the noise exists
    expect(roundPence(0.285 * 100)).toBe(29);
    expect(roundPence(1.005 * 100)).toBe(101);
    expect(roundPence(0.145 * 100)).toBe(15);
    expect(roundPence(2.675 * 100)).toBe(268);
  });

  it('rounds exact .5 half away from zero for positives', () => {
    expect(roundPence(0.5)).toBe(1);
    expect(roundPence(28.5)).toBe(29);
    expect(roundPence(29.5)).toBe(30);
  });

  it('rounds exact .5 half away from zero for negatives', () => {
    expect(roundPence(-0.5)).toBe(-1);
    expect(roundPence(-28.5)).toBe(-29);
    expect(roundPence(-0.285 * 100)).toBe(-29);
  });

  it('rounds non-half values to the nearest integer', () => {
    expect(roundPence(28.49)).toBe(28);
    expect(roundPence(28.51)).toBe(29);
    expect(roundPence(-28.49)).toBe(-28);
    expect(roundPence(-28.51)).toBe(-29);
    expect(roundPence(100)).toBe(100);
  });

  it('never returns negative zero', () => {
    expect(Object.is(roundPence(-0.4), 0)).toBe(true);
    expect(Object.is(roundPence(-0), 0)).toBe(true);
    expect(Object.is(roundPence(0), 0)).toBe(true);
  });

  it('throws on NaN and Infinity', () => {
    expect(() => roundPence(NaN)).toThrow(RangeError);
    expect(() => roundPence(Infinity)).toThrow(RangeError);
    expect(() => roundPence(-Infinity)).toThrow(RangeError);
  });
});

describe('segmentPence', () => {
  const SEVEN_AND_A_HALF_HOURS = 7 * 60 + 30;

  it('defaults the multiplier to 1', () => {
    expect(segmentPence(1234, SEVEN_AND_A_HALF_HOURS)).toBe(9255);
    expect(segmentPence(1200, 1)).toBe(20);
  });

  it('applies a 1.25 multiplier over 7h30m', () => {
    // 1234 * 7.5 * 1.25 = 11568.75
    expect(segmentPence(1234, SEVEN_AND_A_HALF_HOURS, 1.25)).toBe(11569);
    // 1137 * 7.5 * 1.25 = 10659.375
    expect(segmentPence(1137, SEVEN_AND_A_HALF_HOURS, 1.25)).toBe(10659);
  });

  it('applies a 1.333 multiplier over 7h30m, clearing float noise', () => {
    // exact value 12336.915; floats give 12336.914999...
    expect(1234 * (SEVEN_AND_A_HALF_HOURS / 60) * 1.333).not.toBe(12336.915);
    expect(segmentPence(1234, SEVEN_AND_A_HALF_HOURS, 1.333)).toBe(12337);
    // 1137 * 7.5 * 1.333 = 11367.1575
    expect(segmentPence(1137, SEVEN_AND_A_HALF_HOURS, 1.333)).toBe(11367);
  });

  it('returns 0 for zero minutes', () => {
    expect(segmentPence(1234, 0, 1.5)).toBe(0);
  });

  it('throws when the inputs produce a non-finite amount', () => {
    expect(() => segmentPence(NaN, 60)).toThrow(RangeError);
    expect(() => segmentPence(1234, Infinity)).toThrow(RangeError);
  });
});

describe('sumPence', () => {
  it('sums integer pence', () => {
    expect(sumPence([])).toBe(0);
    expect(sumPence([1, 2, 3])).toBe(6);
    expect(sumPence([11569, -100, 9255])).toBe(20724);
  });

  it('rejects non-integer values', () => {
    expect(() => sumPence([1, 2.5])).toThrow(TypeError);
    expect(() => sumPence([NaN])).toThrow(TypeError);
    expect(() => sumPence([Infinity])).toThrow(TypeError);
  });
});

describe('formatPence', () => {
  it.each([
    [0, '£0.00'],
    [1, '£0.01'],
    [99, '£0.99'],
    [100, '£1.00'],
    [1230, '£12.30'],
    [123456, '£1,234.56'],
    [100000000, '£1,000,000.00'],
    [-1, '-£0.01'],
    [-1230, '-£12.30'],
    [-123456, '-£1,234.56'],
  ])('formats %p as %p', (pence, text) => {
    expect(formatPence(pence)).toBe(text);
  });

  it('formats negative zero as £0.00', () => {
    expect(formatPence(-0)).toBe('£0.00');
  });

  it('rejects non-integer pence', () => {
    expect(() => formatPence(1.5)).toThrow(TypeError);
    expect(() => formatPence(NaN)).toThrow(TypeError);
  });
});

describe('parsePoundsToPence', () => {
  it.each([
    ['12.3', 1230],
    ['12.30', 1230],
    ['12', 1200],
    ['0', 0],
    ['0.5', 50],
    ['0.05', 5],
    ['£12.30', 1230],
    ['1,234.56', 123456],
    ['£1,234,567', 123456700],
    ['  £7.25  ', 725],
    ['-12.3', -1230],
    ['-£12.30', -1230],
  ])('parses %p as %p', (text, pence) => {
    expect(parsePoundsToPence(text)).toBe(pence);
  });

  it('never returns negative zero', () => {
    expect(Object.is(parsePoundsToPence('-0.00'), 0)).toBe(true);
  });

  it.each([
    'abc',
    '1.234',
    '',
    '   ',
    '£',
    '-',
    '.5',
    '12.',
    '1,23',
    '12,34.00',
    ',123',
    '1.2.3',
    '£-12',
    '--1',
    '1e3',
    '12p',
    '99999999999999999999',
  ])('returns null for invalid %p', (text) => {
    expect(parsePoundsToPence(text)).toBeNull();
  });

  it.each([0, 1, 99, 100, 123456, -1, -99, -100, -123456, 100000000])(
    'round-trips %p through formatPence',
    (pence) => {
      expect(parsePoundsToPence(formatPence(pence))).toBe(pence);
    },
  );
});
