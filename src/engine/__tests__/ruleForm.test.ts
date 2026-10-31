import { buildPremiumRules } from '../presets';
import {
  RULE_FORM_MESSAGES,
  type RuleFormValues,
  formToRule,
  newRuleForm,
  parsePoundsToPence,
  ruleFormErrors,
  ruleToForm,
} from '../ruleForm';
import type { PremiumRule, PremiumRuleType } from '../types';

const IDS = { id: 'r1', jobId: 'j1' };
const ALL_TYPES: PremiumRuleType[] = [
  'time_band',
  'day_of_week',
  'bank_holiday',
  'overtime_daily',
  'overtime_weekly',
  'overtime_period',
];

function form(type: PremiumRuleType, overrides: Partial<RuleFormValues> = {}): RuleFormValues {
  return { ...newRuleForm(type), ...overrides };
}

function fields(values: RuleFormValues): string[] {
  return ruleFormErrors(values).map((e) => e.field);
}

describe('newRuleForm', () => {
  it('gives valid defaults for every type', () => {
    for (const type of ALL_TYPES) {
      expect(ruleFormErrors(newRuleForm(type))).toEqual([]);
    }
  });

  it('uses the preset-style defaults', () => {
    expect(formToRule(newRuleForm('time_band'), IDS)).toEqual({
      ...IDS,
      name: 'Night',
      type: 'time_band',
      startTime: '22:00',
      endTime: '06:00',
      multiplier: 1.25,
      stacking: 'highest_only',
      priority: 0,
    });
    expect(formToRule(newRuleForm('day_of_week'), IDS)).toMatchObject({ daysOfWeek: [0], multiplier: 1.5 });
    expect(formToRule(newRuleForm('bank_holiday'), IDS)).toMatchObject({ name: 'Bank holiday', multiplier: 2 });
    expect(formToRule(newRuleForm('overtime_daily'), IDS)).toMatchObject({ thresholdHours: 8, multiplier: 1.5 });
    expect(formToRule(newRuleForm('overtime_weekly'), IDS)).toMatchObject({
      thresholdHours: 39,
      weekStartsOn: 1,
      multiplier: 1.5,
    });
    expect(formToRule(newRuleForm('overtime_period'), IDS)).toMatchObject({ thresholdHours: 160, multiplier: 1.5 });
  });
});

describe('round trip formToRule(ruleToForm(rule))', () => {
  it('is exact for every preset', () => {
    const rules = buildPremiumRules({
      jobId: 'j1',
      selected: ['nights', 'sundays', 'bank_holidays', 'overtime_39'],
      makeId: (() => {
        let n = 0;
        return () => `p${++n}`;
      })(),
    });
    expect(rules).toHaveLength(4);
    for (const rule of rules) {
      expect(formToRule(ruleToForm(rule), { id: rule.id, jobId: rule.jobId })).toStrictEqual(rule);
    }
  });

  const common = { id: 'f1', jobId: 'j9', stacking: 'stack', priority: 3 } as const;
  const flatRules: PremiumRule[] = [
    { ...common, name: 'Late', type: 'time_band', startTime: '18:30', endTime: '23:00', flatAddPencePerHour: 110 },
    { ...common, name: 'Weekend', type: 'day_of_week', daysOfWeek: [6, 0], flatAddPencePerHour: 5 },
    { ...common, name: 'Bank hol', type: 'bank_holiday', flatAddPencePerHour: 250 },
    { ...common, name: 'Long day', type: 'overtime_daily', thresholdHours: 10.5, flatAddPencePerHour: 1 },
    {
      ...common,
      name: 'Weekly OT',
      type: 'overtime_weekly',
      thresholdHours: 37.5,
      weekStartsOn: 0,
      flatAddPencePerHour: 199,
    },
    { ...common, name: 'Period OT', type: 'overtime_period', thresholdHours: 173.33, flatAddPencePerHour: 12345 },
  ];

  it.each(flatRules.map((r) => [r.type, r] as const))('is exact for a flat-add %s rule', (_type, rule) => {
    expect(formToRule(ruleToForm(rule), { id: rule.id, jobId: rule.jobId })).toStrictEqual(rule);
  });

  it('is exact for a multiplier rule of every type', () => {
    for (const type of ALL_TYPES) {
      const rule = formToRule(form(type, { multiplierText: '1.255', priority: 2, stacking: 'stack' }), IDS);
      expect(formToRule(ruleToForm(rule), IDS)).toStrictEqual(rule);
    }
  });

  it('shows flat adds as £ with 2 dp', () => {
    expect(ruleToForm(flatRules[0]!).flatText).toBe('1.10');
    expect(ruleToForm(flatRules[1]!).flatText).toBe('0.05');
    expect(ruleToForm(flatRules[5]!).flatText).toBe('123.45');
    expect(ruleToForm(flatRules[0]!).rateKind).toBe('flat');
  });

  it('defaults a weekly rule without weekStartsOn to Monday', () => {
    const rule: PremiumRule = {
      ...common,
      name: 'OT',
      type: 'overtime_weekly',
      thresholdHours: 40,
      multiplier: 1.5,
    };
    expect(ruleToForm(rule).weekStartsOn).toBe(1);
    expect(formToRule(ruleToForm(rule), IDS)).toMatchObject({ weekStartsOn: 1 });
  });
});

describe('parsePoundsToPence', () => {
  it('converts digit by digit with no float drift', () => {
    expect(parsePoundsToPence('1.10')).toBe(110);
    expect(parsePoundsToPence('1.1')).toBe(110);
    expect(parsePoundsToPence('0.29')).toBe(29);
    expect(parsePoundsToPence('4.35')).toBe(435);
    expect(parsePoundsToPence(' 2 ')).toBe(200);
  });

  it('rejects malformed or huge amounts', () => {
    for (const bad of ['', 'abc', '1,50', '0.333', '-1', '£1', '1.', '.5']) {
      expect(parsePoundsToPence(bad)).toBeNull();
    }
    expect(parsePoundsToPence('9'.repeat(20))).toBeNull();
  });
});

describe('ruleFormErrors', () => {
  it('requires a name', () => {
    expect(ruleFormErrors(form('bank_holiday', { name: '  ' }))).toEqual([
      { field: 'name', message: RULE_FORM_MESSAGES.name },
    ]);
  });

  it('accepts decimal multipliers above 0 and up to 10', () => {
    for (const ok of ['1.5', '1.25', '2', '1.255', '10', '0.5']) {
      expect(fields(form('bank_holiday', { multiplierText: ok }))).toEqual([]);
    }
  });

  it('rejects bad multipliers', () => {
    for (const bad of ['', '0', '0.0', 'abc', '1,5', '-1', '10.01', '1e1', '.5']) {
      expect(ruleFormErrors(form('bank_holiday', { multiplierText: bad }))).toEqual([
        { field: 'multiplierText', message: RULE_FORM_MESSAGES.multiplier },
      ]);
    }
  });

  it('checks the flat amount only when the rate is flat', () => {
    expect(fields(form('bank_holiday', { rateKind: 'flat', flatText: '0.01', multiplierText: 'x' }))).toEqual([]);
    for (const bad of ['', '0', '0.00', '0.333', 'abc', '1,10']) {
      expect(ruleFormErrors(form('bank_holiday', { rateKind: 'flat', flatText: bad }))).toEqual([
        { field: 'flatText', message: RULE_FORM_MESSAGES.flat },
      ]);
    }
  });

  it('checks band times for time_band only', () => {
    expect(ruleFormErrors(form('time_band', { startTime: '24:00', endTime: '6:00' }))).toEqual([
      { field: 'startTime', message: RULE_FORM_MESSAGES.startTime },
      { field: 'endTime', message: RULE_FORM_MESSAGES.endTime },
    ]);
    expect(fields(form('bank_holiday', { startTime: 'x', endTime: 'y' }))).toEqual([]);
  });

  it('needs at least one day for day_of_week only', () => {
    expect(ruleFormErrors(form('day_of_week', { daysOfWeek: [] }))).toEqual([
      { field: 'daysOfWeek', message: RULE_FORM_MESSAGES.daysOfWeek },
    ]);
    expect(fields(form('bank_holiday', { daysOfWeek: [] }))).toEqual([]);
  });

  it.each([
    ['overtime_daily', 24],
    ['overtime_weekly', 168],
    ['overtime_period', 744],
  ] as const)('limits the %s threshold to above 0 and up to %d', (type, max) => {
    expect(fields(form(type, { thresholdText: String(max) }))).toEqual([]);
    expect(fields(form(type, { thresholdText: '0.5' }))).toEqual([]);
    for (const bad of ['', '0', 'abc', '7,5', String(max + 0.1)]) {
      expect(ruleFormErrors(form(type, { thresholdText: bad }))).toEqual([
        { field: 'thresholdText', message: RULE_FORM_MESSAGES.threshold(max) },
      ]);
    }
  });

  it('ignores the threshold for non-overtime rules', () => {
    expect(fields(form('time_band', { thresholdText: '' }))).toEqual([]);
  });

  it('reports every bad field at once', () => {
    expect(fields(form('time_band', { name: '', multiplierText: '', startTime: '', endTime: '' }))).toEqual([
      'name',
      'multiplierText',
      'startTime',
      'endTime',
    ]);
  });
});

describe('formToRule', () => {
  it('throws on an invalid form', () => {
    expect(() => formToRule(form('day_of_week', { name: '', daysOfWeek: [] }), IDS)).toThrow(
      'Invalid rule form: name, daysOfWeek',
    );
  });

  it('trims the name and text inputs', () => {
    expect(
      formToRule(form('overtime_daily', { name: ' Long ', multiplierText: ' 1.5 ', thresholdText: ' 9 ' }), IDS),
    ).toMatchObject({ name: 'Long', multiplier: 1.5, thresholdHours: 9 });
  });

  it('stores flat adds as integer pence', () => {
    const rule = formToRule(form('bank_holiday', { rateKind: 'flat', flatText: '1.10' }), IDS);
    expect(rule.flatAddPencePerHour).toBe(110);
    expect(rule).not.toHaveProperty('multiplier');
  });
});
