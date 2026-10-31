import {
  MANUAL_SHIFT_MESSAGES,
  type ManualShiftForm,
  isValidWallClock,
  manualShiftTimes,
  shiftToForm,
} from '../manualShift';
import { minutesBetween } from '../time';

function form(overrides: Partial<ManualShiftForm> = {}): ManualShiftForm {
  return { date: '2026-06-15', startTime: '08:00', endTime: '16:00', unpaidBreakMinutes: 30, ...overrides };
}

describe('isValidWallClock', () => {
  it.each(['00:00', '09:05', '12:30', '23:59'])('accepts %s', (s) => {
    expect(isValidWallClock(s)).toBe(true);
  });

  it.each(['24:00', '23:60', '9:00', '09:5', '0900', '', ' 09:00', '09:00 ', 'ab:cd'])('rejects "%s"', (s) => {
    expect(isValidWallClock(s)).toBe(false);
  });
});

describe('manualShiftTimes', () => {
  it('day shift in BST', () => {
    expect(manualShiftTimes(form())).toEqual({
      ok: true,
      start: '2026-06-15T07:00:00.000Z',
      end: '2026-06-15T15:00:00.000Z',
    });
  });

  it('overnight shift ends the next local day', () => {
    expect(manualShiftTimes(form({ date: '2026-01-10', startTime: '22:00', endTime: '06:00' }))).toEqual({
      ok: true,
      start: '2026-01-10T22:00:00.000Z',
      end: '2026-01-11T06:00:00.000Z',
    });
  });

  it('end equal to start is a 24-hour shift', () => {
    const r = manualShiftTimes(form({ date: '2026-01-10', startTime: '08:00', endTime: '08:00' }));
    expect(r).toEqual({ ok: true, start: '2026-01-10T08:00:00.000Z', end: '2026-01-11T08:00:00.000Z' });
  });

  it('night into 29 Mar 2026 (clocks go forward) is 11 hours', () => {
    const r = manualShiftTimes(form({ date: '2026-03-28', startTime: '20:00', endTime: '08:00' }));
    expect(r).toEqual({ ok: true, start: '2026-03-28T20:00:00.000Z', end: '2026-03-29T07:00:00.000Z' });
    if (!r.ok) throw new Error('expected ok');
    expect(minutesBetween(r.start, r.end)).toBe(11 * 60);
  });

  it('night into 25 Oct 2026 (clocks go back) is 13 hours', () => {
    const r = manualShiftTimes(form({ date: '2026-10-24', startTime: '20:00', endTime: '08:00' }));
    expect(r).toEqual({ ok: true, start: '2026-10-24T19:00:00.000Z', end: '2026-10-25T08:00:00.000Z' });
    if (!r.ok) throw new Error('expected ok');
    expect(minutesBetween(r.start, r.end)).toBe(13 * 60);
  });

  it('rejects a bad start time', () => {
    expect(manualShiftTimes(form({ startTime: '25:00' }))).toEqual({
      ok: false,
      errors: [{ field: 'startTime', message: MANUAL_SHIFT_MESSAGES.startTime }],
    });
  });

  it('rejects a bad end time', () => {
    expect(manualShiftTimes(form({ endTime: '8:00' }))).toEqual({
      ok: false,
      errors: [{ field: 'endTime', message: MANUAL_SHIFT_MESSAGES.endTime }],
    });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects break %p', (b) => {
    expect(manualShiftTimes(form({ unpaidBreakMinutes: b }))).toEqual({
      ok: false,
      errors: [{ field: 'unpaidBreakMinutes', message: MANUAL_SHIFT_MESSAGES.breakNotWhole }],
    });
  });

  it('reports every field error at once', () => {
    const r = manualShiftTimes(form({ startTime: 'x', endTime: 'y', unpaidBreakMinutes: -5 }));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected errors');
    expect(r.errors.map((e) => e.field)).toEqual(['startTime', 'endTime', 'unpaidBreakMinutes']);
  });

  it('accepts a zero break and a break just under the shift length', () => {
    expect(manualShiftTimes(form({ unpaidBreakMinutes: 0 })).ok).toBe(true);
    expect(manualShiftTimes(form({ unpaidBreakMinutes: 8 * 60 - 1 })).ok).toBe(true);
  });

  it.each([8 * 60, 9 * 60])('rejects a break of %p minutes on an 8-hour shift', (b) => {
    expect(manualShiftTimes(form({ unpaidBreakMinutes: b }))).toEqual({
      ok: false,
      errors: [{ field: 'unpaidBreakMinutes', message: MANUAL_SHIFT_MESSAGES.breakTooLong }],
    });
  });

  it('rejects a shift that collapses in the spring-forward gap', () => {
    // 01:30 on 29 Mar does not exist and reads as 02:30 BST, after 02:00 BST.
    const r = manualShiftTimes(form({ date: '2026-03-29', startTime: '01:30', endTime: '02:00', unpaidBreakMinutes: 0 }));
    expect(r).toEqual({ ok: false, errors: [{ field: 'endTime', message: MANUAL_SHIFT_MESSAGES.endBeforeStart }] });
  });

  it('throws on an invalid date', () => {
    expect(() => manualShiftTimes(form({ date: '2026-02-30' }))).toThrow('Invalid LocalDate');
  });
});

describe('shiftToForm', () => {
  it('returns London local times', () => {
    expect(
      shiftToForm({
        date: '2026-10-24',
        start: '2026-10-24T19:00:00.000Z',
        end: '2026-10-25T08:00:00.000Z',
        unpaidBreakMinutes: 45,
      }),
    ).toEqual({ date: '2026-10-24', startTime: '20:00', endTime: '08:00', unpaidBreakMinutes: 45 });
  });

  it.each<Partial<ManualShiftForm>>([
    {},
    { date: '2026-01-10', startTime: '22:00', endTime: '06:00' },
    { date: '2026-03-28', startTime: '20:00', endTime: '08:00' },
    { date: '2026-10-24', startTime: '20:00', endTime: '08:00', unpaidBreakMinutes: 0 },
    { date: '2026-01-10', startTime: '08:00', endTime: '08:00' },
  ])('round-trips through manualShiftTimes (%p)', (overrides) => {
    const f = form(overrides);
    const r = manualShiftTimes(f);
    if (!r.ok) throw new Error('expected ok');
    expect(shiftToForm({ date: f.date, start: r.start, end: r.end, unpaidBreakMinutes: f.unpaidBreakMinutes })).toEqual(f);
    expect(manualShiftTimes(shiftToForm({ ...f, start: r.start, end: r.end }))).toEqual(r);
  });
});
