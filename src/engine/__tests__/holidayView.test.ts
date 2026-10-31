import { formatHolidayHours, holidayView } from '../holidayView';
import type { HolidaySummary } from '../types';

function summary(over: Partial<HolidaySummary> = {}): HolidaySummary {
  const base = {
    yearStart: '2026-04-01',
    yearEnd: '2027-03-31',
    entitled: 224,
    accrued: 56.37,
    taken: 16,
    booked: 12,
    ...over,
  };
  return { remaining: base.entitled - base.taken - base.booked, ...base, ...over };
}

describe('formatHolidayHours', () => {
  it('at most 2 decimals, no trailing zeros', () => {
    expect(formatHolidayHours(37.5)).toBe('37.5 h');
    expect(formatHolidayHours(8)).toBe('8 h');
    expect(formatHolidayHours(0)).toBe('0 h');
    expect(formatHolidayHours(1.666666)).toBe('1.67 h');
    expect(formatHolidayHours(2.104)).toBe('2.1 h');
    expect(formatHolidayHours(0.1 + 0.2)).toBe('0.3 h');
  });
});

describe('holidayView: labels', () => {
  it('year label spans both inclusive dates', () => {
    expect(holidayView(summary(), 'fixed').yearLabel).toBe('1 Apr 2026 – 31 Mar 2027');
    const leap = summary({ yearStart: '2028-02-29', yearEnd: '2029-02-27' });
    expect(holidayView(leap, 'accrual').yearLabel).toBe('29 Feb 2028 – 27 Feb 2029');
  });

  it('mode labels', () => {
    expect(holidayView(summary(), 'fixed').modeLabel).toBe('Fixed entitlement');
    expect(holidayView(summary(), 'accrual').modeLabel).toBe('Accrues at 12.07% of hours worked');
  });

  it('remaining left vs over', () => {
    const left = holidayView(summary({ entitled: 70.5, taken: 16, booked: 12 }), 'fixed');
    expect(left.remainingHours).toBe(42.5);
    expect(left.remainingLabel).toBe('42.5 h left');

    const zero = holidayView(summary({ entitled: 28, taken: 16, booked: 12 }), 'fixed');
    expect(zero.remainingLabel).toBe('0 h left');

    const over = holidayView(summary({ entitled: 25, taken: 16, booked: 12 }), 'fixed');
    expect(over.remainingHours).toBe(-3);
    expect(over.remainingLabel).toBe('3 h over');
  });
});

describe('holidayView: rows', () => {
  it('fixed mode: entitled, accrued so far, taken, booked, remaining', () => {
    expect(holidayView(summary(), 'fixed').rows).toEqual([
      { key: 'entitled', label: 'Entitled', hours: 224 },
      { key: 'accrued', label: 'Accrued so far', hours: 56.37 },
      { key: 'taken', label: 'Taken', hours: 16 },
      { key: 'booked', label: 'Booked', hours: 12 },
      { key: 'remaining', label: 'Remaining', hours: 196 },
    ]);
  });

  it('accrual mode omits accrued so far (it equals entitled)', () => {
    const s = summary({ entitled: 30.18, accrued: 30.18, taken: 8, booked: 30 });
    expect(holidayView(s, 'accrual').rows).toEqual([
      { key: 'entitled', label: 'Entitled', hours: 30.18 },
      { key: 'taken', label: 'Taken', hours: 8 },
      { key: 'booked', label: 'Booked', hours: 30 },
      { key: 'remaining', label: 'Remaining', hours: s.remaining },
    ]);
  });
});

describe('holidayView: ring', () => {
  it('fractions of entitled', () => {
    const { ring } = holidayView(summary({ entitled: 200, taken: 50, booked: 20 }), 'fixed');
    expect(ring).toEqual({ takenFraction: 0.25, bookedFraction: 0.1 });
  });

  it('over-booked: booked clamped so the sum is at most 1', () => {
    const { ring } = holidayView(summary({ entitled: 100, taken: 70, booked: 60 }), 'fixed');
    expect(ring.takenFraction).toBe(0.7);
    expect(ring.bookedFraction).toBeCloseTo(0.3, 12);
    expect(ring.takenFraction + ring.bookedFraction).toBeLessThanOrEqual(1);
  });

  it('taken alone over entitled: taken 1, booked 0', () => {
    const { ring } = holidayView(summary({ entitled: 10, taken: 15, booked: 5 }), 'fixed');
    expect(ring).toEqual({ takenFraction: 1, bookedFraction: 0 });
  });

  it('entitled 0 (or less): both 0', () => {
    expect(holidayView(summary({ entitled: 0, taken: 0, booked: 8 }), 'accrual').ring).toEqual({
      takenFraction: 0,
      bookedFraction: 0,
    });
    expect(holidayView(summary({ entitled: -1, taken: 0, booked: 0 }), 'fixed').ring).toEqual({
      takenFraction: 0,
      bookedFraction: 0,
    });
  });
});
