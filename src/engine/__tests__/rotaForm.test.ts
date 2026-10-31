import { ROTA_PRESETS, type RotaPresetId, buildRota } from '../presets';
import {
  OFF_LABEL,
  ROTA_FORM_MESSAGES,
  type PatternFormValues,
  type TemplateFormValues,
  cycleDayDate,
  formToPattern,
  formToTemplate,
  isValidLocalDateText,
  newTemplateForm,
  nextOccurrences,
  patternFormErrors,
  patternToForm,
  resizeCycle,
  templateFormErrors,
  templateToForm,
} from '../rotaForm';
import type { RotaPattern, ShiftTemplate } from '../types';

const IDS = { id: 'x1', jobId: 'j1' };

function built(preset: RotaPresetId) {
  let next = 0;
  return buildRota({
    preset,
    jobId: 'j1',
    firstDayOn: '2026-10-19',
    startTime: '22:00',
    endTime: '06:00',
    unpaidBreakMinutes: 45,
    daysOfWeek: [1, 3, 5],
    makeId: () => `id${++next}`,
  });
}

function tForm(overrides: Partial<TemplateFormValues> = {}): TemplateFormValues {
  return { ...newTemplateForm(), name: 'Early', ...overrides };
}

const EARLY: ShiftTemplate = {
  id: 't1',
  jobId: 'j1',
  name: 'Early',
  startTime: '06:00',
  endTime: '14:00',
  unpaidBreakMinutes: 30,
};
const NIGHT: ShiftTemplate = {
  ...EARLY,
  id: 't2',
  name: 'Night',
  startTime: '22:00',
  endTime: '06:00',
};

describe('templates', () => {
  it('round-trips every preset template', () => {
    for (const { id } of ROTA_PRESETS) {
      const { template } = built(id);
      expect(
        formToTemplate(templateToForm(template), { id: template.id, jobId: template.jobId }),
      ).toEqual(template);
    }
  });

  it('new form is 09:00-17:00 with 30 min break and needs a name', () => {
    expect(newTemplateForm()).toEqual({
      name: '',
      startTime: '09:00',
      endTime: '17:00',
      breakText: '30',
    });
    expect(templateFormErrors(newTemplateForm())).toEqual([
      { field: 'name', message: ROTA_FORM_MESSAGES.name },
    ]);
    expect(formToTemplate(tForm({ name: '  Early ', breakText: ' 15 ' }), IDS)).toEqual({
      ...IDS,
      name: 'Early',
      startTime: '09:00',
      endTime: '17:00',
      unpaidBreakMinutes: 15,
    });
  });

  it('checks the name', () => {
    expect(templateFormErrors(tForm({ name: '   ' }))).toEqual([
      { field: 'name', message: ROTA_FORM_MESSAGES.name },
    ]);
    expect(templateFormErrors(tForm({ name: 'a'.repeat(30) }))).toEqual([]);
    expect(templateFormErrors(tForm({ name: 'a'.repeat(31) }))).toEqual([
      { field: 'name', message: ROTA_FORM_MESSAGES.nameTooLong },
    ]);
  });

  it('checks the times', () => {
    expect(templateFormErrors(tForm({ startTime: '24:00', endTime: '9:00' }))).toEqual([
      { field: 'startTime', message: ROTA_FORM_MESSAGES.startTime },
      { field: 'endTime', message: ROTA_FORM_MESSAGES.endTime },
    ]);
  });

  it('checks the break', () => {
    for (const breakText of ['', '-1', '1.5', 'abc', '241']) {
      expect(templateFormErrors(tForm({ breakText }))).toEqual([
        { field: 'breakText', message: ROTA_FORM_MESSAGES.breakNotWhole },
      ]);
    }
    expect(templateFormErrors(tForm({ breakText: '0' }))).toEqual([]);
    expect(templateFormErrors(tForm({ breakText: '240' }))).toEqual([]);
    // 1-hour shift: break must be under 60.
    expect(
      templateFormErrors(tForm({ startTime: '09:00', endTime: '10:00', breakText: '59' })),
    ).toEqual([]);
    expect(
      templateFormErrors(tForm({ startTime: '09:00', endTime: '10:00', breakText: '60' })),
    ).toEqual([{ field: 'breakText', message: ROTA_FORM_MESSAGES.breakTooLong }]);
    // Overnight 23:30-00:30 is 1 hour.
    expect(
      templateFormErrors(tForm({ startTime: '23:30', endTime: '00:30', breakText: '60' })),
    ).toEqual([{ field: 'breakText', message: ROTA_FORM_MESSAGES.breakTooLong }]);
    // Bad time: no break-length check.
    expect(
      templateFormErrors(tForm({ startTime: 'x', breakText: '240' })).map((e) => e.field),
    ).toEqual(['startTime']);
  });

  it('allows start == end as a 24-hour shift', () => {
    expect(
      templateFormErrors(tForm({ startTime: '07:00', endTime: '07:00', breakText: '240' })),
    ).toEqual([]);
  });

  it('formToTemplate throws on errors', () => {
    expect(() => formToTemplate(tForm({ name: '', breakText: 'x' }), IDS)).toThrow(
      'Invalid shift template form: name, breakText',
    );
  });
});

describe('patterns', () => {
  it('round-trips every preset pattern', () => {
    for (const { id } of ROTA_PRESETS) {
      const { template, pattern } = built(id);
      const form = patternToForm(pattern);
      expect(patternFormErrors(form, [template.id])).toEqual([]);
      expect(formToPattern(form, { id: pattern.id, jobId: pattern.jobId })).toEqual(pattern);
    }
  });

  it('copies days rather than sharing them', () => {
    const { pattern } = built('mon_fri');
    const form = patternToForm(pattern);
    expect(form.days[0]).not.toBe(pattern.days[0]);
    const out = formToPattern(form, IDS);
    expect(out.days[0]).not.toBe(form.days[0]);
  });

  it('checks the start date', () => {
    const days: PatternFormValues['days'] = [{ shiftTemplateId: 't1' }];
    for (const startDate of ['', '2026-02-30', '2026-1-01', '01/11/2026']) {
      expect(patternFormErrors({ startDate, days }, ['t1'])).toEqual([
        { field: 'startDate', message: ROTA_FORM_MESSAGES.startDate },
      ]);
    }
    expect(isValidLocalDateText('2028-02-29')).toBe(true);
    expect(isValidLocalDateText('2026-13-01')).toBe(false);
  });

  it('checks the cycle length and days on', () => {
    const on = { shiftTemplateId: 't1' } as const;
    expect(patternFormErrors({ startDate: '2026-11-02', days: [] }, ['t1'])).toEqual([
      { field: 'days', message: ROTA_FORM_MESSAGES.cycleLength },
    ]);
    expect(
      patternFormErrors({ startDate: '2026-11-02', days: Array(57).fill(on) }, ['t1']),
    ).toEqual([{ field: 'days', message: ROTA_FORM_MESSAGES.cycleLength }]);
    expect(
      patternFormErrors({ startDate: '2026-11-02', days: Array(56).fill(on) }, ['t1']),
    ).toEqual([]);
    expect(patternFormErrors({ startDate: '2026-11-02', days: ['OFF', 'OFF'] }, ['t1'])).toEqual([
      { field: 'days', message: ROTA_FORM_MESSAGES.noDayOn },
    ]);
  });

  it('checks every template id exists', () => {
    const values: PatternFormValues = {
      startDate: '2026-11-02',
      days: [{ shiftTemplateId: 't1' }, { shiftTemplateId: 'gone' }],
    };
    expect(patternFormErrors(values, ['t1'])).toEqual([
      { field: 'days', message: ROTA_FORM_MESSAGES.unknownTemplate },
    ]);
    expect(patternFormErrors(values, ['t1', 'gone'])).toEqual([]);
  });

  it('formToPattern throws on errors', () => {
    expect(() => formToPattern({ startDate: 'nope', days: ['OFF'] }, IDS)).toThrow(
      'Invalid rota pattern form: startDate, days',
    );
  });
});

describe('resizeCycle', () => {
  const days: RotaPattern['days'] = [{ shiftTemplateId: 't1' }, 'OFF', { shiftTemplateId: 't2' }];

  it('grows by padding with OFF', () => {
    expect(resizeCycle(days, 5)).toEqual([...days, 'OFF', 'OFF']);
  });

  it('shrinks by keeping the first n', () => {
    expect(resizeCycle(days, 2)).toEqual([{ shiftTemplateId: 't1' }, 'OFF']);
    expect(resizeCycle(days, 0)).toEqual([]);
  });

  it('rejects a bad length', () => {
    expect(() => resizeCycle(days, -1)).toThrow('Invalid cycle length: -1');
    expect(() => resizeCycle(days, 1.5)).toThrow('Invalid cycle length: 1.5');
  });
});

describe('cycleDayDate', () => {
  it('counts calendar days across the clock change', () => {
    expect(cycleDayDate('2026-10-24', 0)).toBe('2026-10-24');
    expect(cycleDayDate('2026-10-24', 1)).toBe('2026-10-25');
    expect(cycleDayDate('2026-10-24', 2)).toBe('2026-10-26');
    expect(cycleDayDate('2026-03-28', 2)).toBe('2026-03-30');
  });
});

describe('nextOccurrences', () => {
  const pattern: RotaPattern = {
    id: 'p1',
    jobId: 'j1',
    cycleLengthDays: 4,
    startDate: '2026-10-20',
    days: [{ shiftTemplateId: 't1' }, { shiftTemplateId: 't2' }, 'OFF', 'OFF'],
  };

  it('previews 14 London dates across 25 Oct 2026 (BST ends)', () => {
    const preview = nextOccurrences(pattern, [EARLY, NIGHT], '2026-10-22', 14);
    expect(preview.map((p) => p.date)).toEqual([
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
    ]);
    // 2026-10-22 is cycle day 2.
    expect(preview.slice(0, 6).map((p) => p.label)).toEqual([
      OFF_LABEL,
      OFF_LABEL,
      'Early',
      'Night',
      OFF_LABEL,
      OFF_LABEL,
    ]);
    expect(preview[11]).toEqual({ date: '2026-11-02', label: 'Night' });
    expect(preview[13]).toEqual({ date: '2026-11-04', label: OFF_LABEL });
  });

  it('handles from before startDate', () => {
    const preview = nextOccurrences(pattern, [EARLY, NIGHT], '2026-10-15', 6);
    // 2026-10-15 is 5 days before day 0 -> cycle day 3.
    expect(preview).toEqual([
      { date: '2026-10-15', label: OFF_LABEL },
      { date: '2026-10-16', label: 'Early' },
      { date: '2026-10-17', label: 'Night' },
      { date: '2026-10-18', label: OFF_LABEL },
      { date: '2026-10-19', label: OFF_LABEL },
      { date: '2026-10-20', label: 'Early' },
    ]);
  });

  it('agrees with buildRota presets on day 0', () => {
    const { template, pattern: p } = built('four_on_four_off');
    expect(nextOccurrences(p, [template], p.startDate, 9).map((d) => d.label)).toEqual([
      'Shift',
      'Shift',
      'Shift',
      'Shift',
      OFF_LABEL,
      OFF_LABEL,
      OFF_LABEL,
      OFF_LABEL,
      'Shift',
    ]);
  });

  it('returns nothing for a count of 0 or less', () => {
    expect(nextOccurrences(pattern, [EARLY, NIGHT], '2026-10-22', 0)).toEqual([]);
    expect(nextOccurrences(pattern, [EARLY, NIGHT], '2026-10-22', -3)).toEqual([]);
  });

  it('throws on a missing template or empty cycle', () => {
    expect(() => nextOccurrences(pattern, [EARLY], '2026-10-20', 2)).toThrow(
      'shift template t2 not found',
    );
    expect(() => nextOccurrences({ ...pattern, days: [] }, [], '2026-10-20', 2)).toThrow(
      'no cycle days',
    );
  });
});
