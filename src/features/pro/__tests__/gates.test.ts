import {
  FREE_LIMITS,
  type ProFeature,
  canAddJob,
  canAddRotaPattern,
  canAddRule,
  hasFeature,
} from '../gates';

describe('FREE_LIMITS', () => {
  it('allows 1 job, 1 rota pattern and 2 pay rules for free', () => {
    expect(FREE_LIMITS).toEqual({ jobs: 1, rotaPatterns: 1, rules: 2 });
  });
});

describe('canAddRule', () => {
  it.each([
    [0, true],
    [1, true],
    [2, false],
    [3, false],
  ])('free with %i rules → %s', (count, expected) => {
    expect(canAddRule(count, false)).toBe(expected);
  });

  it.each([0, 1, 2, 3])('Pro with %i rules → true', (count) => {
    expect(canAddRule(count, true)).toBe(true);
  });
});

describe('canAddJob', () => {
  it.each([
    [0, true],
    [1, false],
    [2, false],
    [3, false],
  ])('free with %i jobs → %s', (count, expected) => {
    expect(canAddJob(count, false)).toBe(expected);
  });

  it.each([0, 1, 2, 3])('Pro with %i jobs → true', (count) => {
    expect(canAddJob(count, true)).toBe(true);
  });
});

describe('canAddRotaPattern', () => {
  it.each([
    [0, true],
    [1, false],
    [2, false],
    [3, false],
  ])('free with %i patterns → %s', (count, expected) => {
    expect(canAddRotaPattern(count, false)).toBe(expected);
  });

  it.each([0, 1, 2, 3])('Pro with %i patterns → true', (count) => {
    expect(canAddRotaPattern(count, true)).toBe(true);
  });
});

describe('hasFeature', () => {
  const features: ProFeature[] = [
    'netPay',
    'payslipLines',
    'payslipExport',
    'stats',
    'backupExport',
  ];

  it.each(features)('%s is Pro only', (feature) => {
    expect(hasFeature(feature, false)).toBe(false);
    expect(hasFeature(feature, true)).toBe(true);
  });
});
