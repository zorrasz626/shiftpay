import { generateShifts } from '../rota';
import type { DateRange } from '../shiftPay';
import { localDaysBetween, minutesBetween } from '../time';
import type { LocalDate, RotaDay, RotaPattern, ShiftTemplate } from '../types';

const range = (start: LocalDate, end: LocalDate): DateRange => ({ start, end });

const day: ShiftTemplate = {
  id: 'day',
  jobId: 'j1',
  name: 'Day',
  startTime: '07:00',
  endTime: '19:00',
  unpaidBreakMinutes: 30,
};

const night: ShiftTemplate = {
  id: 'night',
  jobId: 'j1',
  name: 'Night',
  startTime: '22:00',
  endTime: '06:00',
  unpaidBreakMinutes: 45,
};

const templates = [day, night];

const D: RotaDay = { shiftTemplateId: 'day' };
const N: RotaDay = { shiftTemplateId: 'night' };

function pattern(days: RotaDay[], startDate: LocalDate = '2026-01-01', extra: Partial<RotaPattern> = {}): RotaPattern {
  return { id: 'p1', jobId: 'j1', cycleLengthDays: days.length, startDate, days, ...extra };
}

const fourOnFourOff = pattern([D, D, D, D, 'OFF', 'OFF', 'OFF', 'OFF']);

/** 2-2-3: on 0,1 off 2,3 on 4,5,6 off 7,8 on 9,10 off 11,12,13. */
const twoTwoThreeDays: RotaDay[] = [D, D, 'OFF', 'OFF', D, D, D, 'OFF', 'OFF', D, D, 'OFF', 'OFF', 'OFF'];
const twoTwoThree = pattern(twoTwoThreeDays);

const cycleDay = (p: RotaPattern, date: LocalDate): number =>
  ((localDaysBetween(p.startDate, date) % p.cycleLengthDays) + p.cycleLengthDays) % p.cycleLengthDays;

describe('generateShifts', () => {
  it('4-on-4-off over 2026: 184 shifts, all on "on" cycle days, none on "off" days', () => {
    const shifts = generateShifts(fourOnFourOff, templates, range('2026-01-01', '2026-12-31'));
    // 365 days = 45 cycles of 8 (180 shifts) + 5 days (cycle days 0-4: 4 on).
    expect(shifts).toHaveLength(184);
    for (const s of shifts) expect(cycleDay(fourOnFourOff, s.date)).toBeLessThan(4);
    const dates = new Set(shifts.map((s) => s.date));
    expect(dates.size).toBe(184);
    // Every on-day in range has a shift.
    expect(dates.has('2026-01-01')).toBe(true);
    expect(dates.has('2026-01-04')).toBe(true);
    expect(dates.has('2026-01-05')).toBe(false);
    expect(dates.has('2026-01-08')).toBe(false);
    expect(dates.has('2026-01-09')).toBe(true);
    expect(dates.has('2026-12-30')).toBe(true); // day 363 -> cycle day 3
    expect(dates.has('2026-12-31')).toBe(false); // day 364 -> cycle day 4 (off)
  });

  it('2-2-3 (14-day cycle) over 2026: 183 shifts on the right days', () => {
    const shifts = generateShifts(twoTwoThree, templates, range('2026-01-01', '2026-12-31'));
    // 365 = 26 cycles of 14 (7 on each = 182) + 1 day (cycle day 0: on).
    expect(shifts).toHaveLength(183);
    const onDays = new Set([0, 1, 4, 5, 6, 9, 10]);
    for (const s of shifts) expect(onDays.has(cycleDay(twoTwoThree, s.date))).toBe(true);
    expect(shifts.slice(0, 7).map((s) => s.date)).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-05',
      '2026-01-06',
      '2026-01-07',
      '2026-01-10',
      '2026-01-11',
    ]);
  });

  it('returns shifts ordered by date with the full Shift shape', () => {
    const shifts = generateShifts(fourOnFourOff, templates, range('2026-01-03', '2026-01-10'));
    expect(shifts.map((s) => s.date)).toEqual(['2026-01-03', '2026-01-04', '2026-01-09', '2026-01-10']);
    expect(shifts[0]).toEqual({
      id: 'p1:2026-01-03',
      jobId: 'j1',
      date: '2026-01-03',
      start: '2026-01-03T07:00:00.000Z',
      end: '2026-01-03T19:00:00.000Z',
      unpaidBreakMinutes: 30,
      source: 'pattern',
      status: 'planned',
      overtimeFlag: false,
    });
    expect('notes' in shifts[0]).toBe(false);
  });

  it('a night shift ends the next day and belongs to its start date', () => {
    const p = pattern([N]);
    const shifts = generateShifts(p, templates, range('2026-01-31', '2026-01-31'));
    expect(shifts).toHaveLength(1);
    expect(shifts[0]).toMatchObject({
      date: '2026-01-31',
      start: '2026-01-31T22:00:00.000Z',
      end: '2026-02-01T06:00:00.000Z',
      unpaidBreakMinutes: 45,
    });
  });

  it('a shift with endTime equal to startTime lasts 24 hours', () => {
    const allDay: ShiftTemplate = { ...day, id: 'all', startTime: '08:00', endTime: '08:00' };
    const shifts = generateShifts(pattern([{ shiftTemplateId: 'all' }]), [allDay], range('2026-06-01', '2026-06-01'));
    expect(minutesBetween(shifts[0].start, shifts[0].end)).toBe(24 * 60);
  });

  describe('DST', () => {
    const nights = pattern([N]);
    const days = pattern([D]);

    it('night into spring-forward (29 Mar 2026) is 7h elapsed', () => {
      const [s] = generateShifts(nights, templates, range('2026-03-28', '2026-03-28'));
      expect(s.start).toBe('2026-03-28T22:00:00.000Z');
      expect(s.end).toBe('2026-03-29T05:00:00.000Z');
      expect(minutesBetween(s.start, s.end)).toBe(7 * 60);
    });

    it('night into fall-back (25 Oct 2026) is 9h elapsed', () => {
      const [s] = generateShifts(nights, templates, range('2026-10-24', '2026-10-24'));
      expect(s.start).toBe('2026-10-24T21:00:00.000Z');
      expect(s.end).toBe('2026-10-25T06:00:00.000Z');
      expect(minutesBetween(s.start, s.end)).toBe(9 * 60);
    });

    it('day shift on 29 Mar 2026 is in BST', () => {
      const [s] = generateShifts(days, templates, range('2026-03-29', '2026-03-29'));
      expect(s.start).toBe('2026-03-29T06:00:00.000Z');
      expect(s.end).toBe('2026-03-29T18:00:00.000Z');
    });

    it('day shift on 25 Oct 2026 is in GMT', () => {
      const [s] = generateShifts(days, templates, range('2026-10-25', '2026-10-25'));
      expect(s.start).toBe('2026-10-25T07:00:00.000Z');
      expect(s.end).toBe('2026-10-25T19:00:00.000Z');
    });
  });

  it('works for dates before startDate (cycle index normalised)', () => {
    const p = pattern([D, D, D, D, 'OFF', 'OFF', 'OFF', 'OFF'], '2026-03-01');
    // 2026-02-21 .. 2026-02-28 are cycle days 0..7 of the previous cycle.
    const shifts = generateShifts(p, templates, range('2026-02-20', '2026-02-28'));
    expect(shifts.map((s) => s.date)).toEqual(['2026-02-21', '2026-02-22', '2026-02-23', '2026-02-24']);
  });

  it('single-day range: on day gives one shift, off day gives none', () => {
    expect(generateShifts(fourOnFourOff, templates, range('2026-01-02', '2026-01-02'))).toHaveLength(1);
    expect(generateShifts(fourOnFourOff, templates, range('2026-01-06', '2026-01-06'))).toEqual([]);
  });

  it('includes a night starting on the last day of the range', () => {
    const shifts = generateShifts(pattern([N]), templates, range('2026-01-01', '2026-01-02'));
    expect(shifts.map((s) => s.date)).toEqual(['2026-01-01', '2026-01-02']);
    expect(shifts[1].end).toBe('2026-01-03T06:00:00.000Z');
  });

  it('is deterministic', () => {
    const r = range('2026-01-01', '2026-03-31');
    expect(generateShifts(twoTwoThree, templates, r)).toEqual(generateShifts(twoTwoThree, templates, r));
  });

  describe('throws', () => {
    const r = range('2026-01-01', '2026-01-31');

    it('when days.length !== cycleLengthDays', () => {
      expect(() => generateShifts(pattern([D, 'OFF'], '2026-01-01', { cycleLengthDays: 3 }), templates, r)).toThrow(
        Error,
      );
    });

    it('when cycleLengthDays < 1', () => {
      expect(() => generateShifts(pattern([], '2026-01-01', { cycleLengthDays: 0 }), templates, r)).toThrow(Error);
    });

    it('when a referenced template id is missing', () => {
      expect(() => generateShifts(pattern([{ shiftTemplateId: 'nope' }, 'OFF']), templates, r)).toThrow(/nope/);
    });

    it('when range.start > range.end', () => {
      expect(() => generateShifts(fourOnFourOff, templates, range('2026-02-01', '2026-01-31'))).toThrow(Error);
    });
  });
});
