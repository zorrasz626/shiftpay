import { PREMIUM_PRESETS, ROTA_PRESETS, type BuildRotaInput, buildPremiumRules, buildRota } from '../presets';
import { generateShifts } from '../rota';
import { addLocalDays, minutesBetween } from '../time';
import type { LocalDate } from '../types';

function counter(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function input(overrides: Partial<BuildRotaInput> = {}): BuildRotaInput {
  return {
    preset: 'mon_fri',
    jobId: 'job-1',
    firstDayOn: '2026-03-23', // a Monday; 2026-03-29 is the spring-forward Sunday
    startTime: '09:00',
    endTime: '17:00',
    unpaidBreakMinutes: 30,
    makeId: counter(),
    ...overrides,
  };
}

/** Dates in [start, start + days) on which the rota generates a shift. */
function onDates(i: BuildRotaInput, start: LocalDate, days: number): LocalDate[] {
  const { template, pattern } = buildRota(i);
  return generateShifts(pattern, [template], { start, end: addLocalDays(start, days - 1) }).map((s) => s.date);
}

/** Expected on-dates from a boolean cycle starting at `from`, repeated over `days`. */
function expectedDates(from: LocalDate, cycle: boolean[], days: number): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = 0; d < days; d++) if (cycle[d % cycle.length]) out.push(addLocalDays(from, d));
  return out;
}

describe('ROTA_PRESETS', () => {
  it('lists the four presets with sentence-case labels', () => {
    expect(ROTA_PRESETS).toEqual([
      { id: 'mon_fri', label: 'Monday to Friday' },
      { id: 'four_on_four_off', label: '4 on, 4 off' },
      { id: 'two_two_three', label: '2-2-3' },
      { id: 'custom_weekly', label: 'Pick your days' },
    ]);
  });
});

describe('buildRota', () => {
  it('builds one "Shift" template and a pattern starting on firstDayOn, ids from makeId', () => {
    const { template, pattern } = buildRota(input({ preset: 'four_on_four_off' }));
    expect(template).toEqual({
      id: 'id-1',
      jobId: 'job-1',
      name: 'Shift',
      startTime: '09:00',
      endTime: '17:00',
      unpaidBreakMinutes: 30,
    });
    expect(pattern).toEqual({
      id: 'id-2',
      jobId: 'job-1',
      cycleLengthDays: 8,
      startDate: '2026-03-23',
      days: [
        { shiftTemplateId: 'id-1' },
        { shiftTemplateId: 'id-1' },
        { shiftTemplateId: 'id-1' },
        { shiftTemplateId: 'id-1' },
        'OFF',
        'OFF',
        'OFF',
        'OFF',
      ],
    });
  });

  it('mon_fri: weekdays only, across the spring-forward change', () => {
    const W = [true, true, true, true, true, false, false];
    expect(onDates(input(), '2026-03-23', 14)).toEqual(expectedDates('2026-03-23', W, 14));
  });

  it('mon_fri: a mid-week firstDayOn still follows the weekday', () => {
    // 2026-10-21 is a Wednesday; 2026-10-25 is the fall-back Sunday.
    const i = input({ firstDayOn: '2026-10-21' });
    expect(buildRota(i).pattern.cycleLengthDays).toBe(7);
    const W = [true, true, true, false, false, true, true]; // Wed Thu Fri Sat Sun Mon Tue
    expect(onDates(i, '2026-10-21', 14)).toEqual(expectedDates('2026-10-21', W, 14));
  });

  it('four_on_four_off: 8-day cycle over two cycles, shift lengths right across BST', () => {
    const i = input({ preset: 'four_on_four_off', firstDayOn: '2026-03-27' });
    const cycle = [true, true, true, true, false, false, false, false];
    expect(onDates(i, '2026-03-27', 16)).toEqual(expectedDates('2026-03-27', cycle, 16));
    const { template, pattern } = buildRota(input({ preset: 'four_on_four_off', firstDayOn: '2026-03-27' }));
    const shifts = generateShifts(pattern, [template], { start: '2026-03-27', end: '2026-03-30' });
    expect(shifts.map((s) => minutesBetween(s.start, s.end))).toEqual([480, 480, 480, 480]);
  });

  it('two_two_three: Panama 14-day cycle over two cycles, across the fall-back change', () => {
    const i = input({ preset: 'two_two_three', firstDayOn: '2026-10-19' });
    const cycle = [true, true, false, false, true, true, true, false, false, true, true, false, false, false];
    expect(buildRota(i).pattern.cycleLengthDays).toBe(14);
    expect(onDates(i, '2026-10-19', 28)).toEqual(expectedDates('2026-10-19', cycle, 28));
  });

  it('custom_weekly: only the picked weekdays', () => {
    const i = input({ preset: 'custom_weekly', daysOfWeek: [0, 3, 6, 3] });
    const W = [false, false, true, false, false, true, true]; // Mon..Sun: Wed, Sat, Sun
    expect(onDates(i, '2026-03-23', 14)).toEqual(expectedDates('2026-03-23', W, 14));
  });

  it('custom_weekly: needs at least one day', () => {
    expect(() => buildRota(input({ preset: 'custom_weekly' }))).toThrow(/at least one day/);
    expect(() => buildRota(input({ preset: 'custom_weekly', daysOfWeek: [] }))).toThrow(/at least one day/);
  });
});

describe('PREMIUM_PRESETS / buildPremiumRules', () => {
  it('lists the four presets with their labels', () => {
    expect(PREMIUM_PRESETS).toEqual([
      { id: 'nights', label: 'Nights ×1.25' },
      { id: 'sundays', label: 'Sundays ×1.5' },
      { id: 'bank_holidays', label: 'Bank hols ×2' },
      { id: 'overtime_39', label: 'Overtime after 39h/week ×1.5' },
    ]);
  });

  it('empty selection gives no rules', () => {
    expect(buildPremiumRules({ jobId: 'job-1', selected: [], makeId: counter() })).toEqual([]);
  });

  it('builds each preset with the exact values, in selection order', () => {
    const rules = buildPremiumRules({
      jobId: 'job-1',
      selected: ['overtime_39', 'nights', 'sundays', 'bank_holidays'],
      makeId: counter('r'),
    });
    const common = { jobId: 'job-1', stacking: 'highest_only', priority: 0 };
    expect(rules).toEqual([
      {
        ...common,
        id: 'r-1',
        name: 'Overtime',
        type: 'overtime_weekly',
        thresholdHours: 39,
        weekStartsOn: 1,
        multiplier: 1.5,
      },
      { ...common, id: 'r-2', name: 'Night', type: 'time_band', startTime: '22:00', endTime: '06:00', multiplier: 1.25 },
      { ...common, id: 'r-3', name: 'Sunday', type: 'day_of_week', daysOfWeek: [0], multiplier: 1.5 },
      { ...common, id: 'r-4', name: 'Bank holiday', type: 'bank_holiday', multiplier: 2 },
    ]);
  });
});
