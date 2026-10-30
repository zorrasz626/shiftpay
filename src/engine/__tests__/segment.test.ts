import snapshot from '../../config/bankHolidays.json';
import { createBankHolidayLookup } from '../bankHolidays';
import { segmentShift } from '../segment';
import { localToInstant } from '../time';
import type {
  BankHolidayData,
  BankHolidayRegion,
  LocalDate,
  SegmentSlice,
  Shift,
  TimeBandRule,
  WallClockTime,
} from '../types';

const bankHolidays = createBankHolidayLookup(snapshot as BankHolidayData);

function shiftOf(
  startDate: LocalDate,
  startTime: WallClockTime,
  endDate: LocalDate,
  endTime: WallClockTime,
  unpaidBreakMinutes = 0,
): Shift {
  return {
    id: 's1',
    jobId: 'j1',
    date: startDate,
    start: localToInstant(startDate, startTime),
    end: localToInstant(endDate, endTime),
    unpaidBreakMinutes,
    source: 'manual',
    status: 'planned',
    overtimeFlag: false,
  };
}

function band(startTime: WallClockTime, endTime: WallClockTime): TimeBandRule {
  return {
    id: `band-${startTime}-${endTime}`,
    jobId: 'j1',
    name: 'Nights',
    stacking: 'stack',
    priority: 0,
    multiplier: 1.25,
    type: 'time_band',
    startTime,
    endTime,
  };
}

function segment(shift: Shift, timeBands: TimeBandRule[] = [], region: BankHolidayRegion = 'england-and-wales') {
  return segmentShift(shift, { timeBands, region, bankHolidays });
}

const sum = (slices: SegmentSlice[], key: 'minutes' | 'breakMinutes' | 'paidMinutes') =>
  slices.reduce((acc, s) => acc + s[key], 0);

/** Compact view: [start, end, localDate, dayOfWeek, minutes]. */
const shape = (slices: SegmentSlice[]) =>
  slices.map((s) => [s.start, s.end, s.localDate, s.dayOfWeek, s.minutes]);

// Thu 15 Jan 2026 22:00 GMT -> Fri 16 Jan 06:00 GMT.
const winterNight = (breakMinutes = 0) => shiftOf('2026-01-15', '22:00', '2026-01-16', '06:00', breakMinutes);

describe('segmentShift: cut points', () => {
  it('splits a 22:00-06:00 night at midnight only, with a 22:00-06:00 band', () => {
    const shift = winterNight();
    const slices = segment(shift, [band('22:00', '06:00')]);
    expect(shape(slices)).toEqual([
      [shift.start, '2026-01-16T00:00:00.000Z', '2026-01-15', 4, 120],
      ['2026-01-16T00:00:00.000Z', shift.end, '2026-01-16', 5, 360],
    ]);
  });

  it('splits at 23:00, 00:00 and 05:00 with a 23:00-05:00 band', () => {
    const shift = winterNight();
    const slices = segment(shift, [band('23:00', '05:00')]);
    expect(shape(slices)).toEqual([
      [shift.start, '2026-01-15T23:00:00.000Z', '2026-01-15', 4, 60],
      ['2026-01-15T23:00:00.000Z', '2026-01-16T00:00:00.000Z', '2026-01-15', 4, 60],
      ['2026-01-16T00:00:00.000Z', '2026-01-16T05:00:00.000Z', '2026-01-16', 5, 300],
      ['2026-01-16T05:00:00.000Z', shift.end, '2026-01-16', 5, 60],
    ]);
  });

  it('drops duplicate cut points (band edge on midnight, shared edges, edges at start/end)', () => {
    const slices = segment(winterNight(), [
      band('00:00', '06:00'),
      band('22:00', '06:00'),
      band('23:00', '05:00'),
      band('23:00', '00:00'),
    ]);
    expect(slices.map((s) => s.minutes)).toEqual([60, 60, 300, 60]);
  });

  it('ignores band edges outside the shift (day before, after the end)', () => {
    // 20:00-21:00 edges fall on 14, 15 and 16 Jan: all outside 22:00 -> 06:00.
    const slices = segment(winterNight(), [band('20:00', '21:00')]);
    expect(slices.map((s) => s.minutes)).toEqual([120, 360]);
  });

  it('returns one slice for a day shift with no boundaries inside', () => {
    const shift = shiftOf('2026-01-15', '09:00', '2026-01-15', '17:00');
    expect(shape(segment(shift, [band('22:00', '06:00')]))).toEqual([
      [shift.start, shift.end, '2026-01-15', 4, 480],
    ]);
  });

  it('slices are ordered, contiguous and cover the whole shift', () => {
    const shift = winterNight();
    const slices = segment(shift, [band('23:00', '05:00'), band('01:15', '03:45')]);
    expect(slices[0].start).toBe(shift.start);
    expect(slices[slices.length - 1].end).toBe(shift.end);
    for (let i = 1; i < slices.length; i++) expect(slices[i].start).toBe(slices[i - 1].end);
    expect(slices.every((s) => s.minutes > 0 && Number.isInteger(s.minutes))).toBe(true);
    expect(sum(slices, 'minutes')).toBe(480);
  });
});

describe('segmentShift: bank holidays', () => {
  it('a shift into Christmas Day marks only the slice from 00:00', () => {
    const shift = shiftOf('2026-12-24', '20:00', '2026-12-25', '04:00');
    const slices = segment(shift);
    expect(slices.map((s) => [s.localDate, s.dayOfWeek, s.isBankHoliday])).toEqual([
      ['2026-12-24', 4, false],
      ['2026-12-25', 5, true],
    ]);
  });

  it('uses the given region', () => {
    // 2 Jan 2026 is a bank holiday in Scotland only.
    const shift = shiftOf('2026-01-01', '20:00', '2026-01-02', '04:00');
    expect(segment(shift, [], 'scotland').map((s) => s.isBankHoliday)).toEqual([true, true]);
    expect(segment(shift, [], 'england-and-wales').map((s) => s.isBankHoliday)).toEqual([true, false]);
  });
});

describe('segmentShift: BST/GMT changeovers', () => {
  it('BST->GMT night (24 -> 25 Oct 2026) is 540 min, cut at midnight and at the changeover', () => {
    const shift = shiftOf('2026-10-24', '22:00', '2026-10-25', '06:00');
    const slices = segment(shift);
    expect(shape(slices)).toEqual([
      [shift.start, '2026-10-24T23:00:00.000Z', '2026-10-24', 6, 120],
      ['2026-10-24T23:00:00.000Z', '2026-10-25T01:00:00.000Z', '2026-10-25', 0, 120],
      ['2026-10-25T01:00:00.000Z', shift.end, '2026-10-25', 0, 300],
    ]);
    expect(sum(slices, 'paidMinutes')).toBe(540);
  });

  it('GMT->BST night (28 -> 29 Mar 2026) is 420 min, cut at midnight and at the changeover', () => {
    const shift = shiftOf('2026-03-28', '22:00', '2026-03-29', '06:00');
    const slices = segment(shift);
    expect(shape(slices)).toEqual([
      [shift.start, '2026-03-29T00:00:00.000Z', '2026-03-28', 6, 120],
      ['2026-03-29T00:00:00.000Z', '2026-03-29T01:00:00.000Z', '2026-03-29', 0, 60],
      ['2026-03-29T01:00:00.000Z', shift.end, '2026-03-29', 0, 240],
    ]);
    expect(sum(slices, 'paidMinutes')).toBe(420);
  });

  it('a band edge at a non-existent local time moves forward (D4)', () => {
    // 01:30 on 29 Mar 2026 does not exist -> 02:30 BST (01:30Z); 05:00 BST = 04:00Z.
    const shift = shiftOf('2026-03-28', '22:00', '2026-03-29', '06:00');
    const slices = segment(shift, [band('01:30', '05:00')]);
    expect(slices.map((s) => [s.start, s.minutes])).toEqual([
      [shift.start, 120],
      ['2026-03-29T00:00:00.000Z', 60],
      ['2026-03-29T01:00:00.000Z', 30],
      ['2026-03-29T01:30:00.000Z', 150],
      ['2026-03-29T04:00:00.000Z', 60],
    ]);
    expect(sum(slices, 'minutes')).toBe(420);
  });

  it('a band edge at an ambiguous local time uses the first occurrence (D4)', () => {
    // 01:30 on 25 Oct 2026 happens twice -> first one, 01:30 BST (00:30Z).
    const shift = shiftOf('2026-10-24', '22:00', '2026-10-25', '06:00');
    const slices = segment(shift, [band('01:30', '05:00')]);
    expect(slices.map((s) => [s.start, s.minutes])).toEqual([
      [shift.start, 120],
      ['2026-10-24T23:00:00.000Z', 90],
      ['2026-10-25T00:30:00.000Z', 30],
      ['2026-10-25T01:00:00.000Z', 240],
      ['2026-10-25T05:00:00.000Z', 60],
    ]);
    expect(sum(slices, 'minutes')).toBe(540);
  });

  it('a shift starting exactly at the changeover has no extra cut', () => {
    const shift = { ...shiftOf('2026-10-25', '01:00', '2026-10-25', '05:00'), start: '2026-10-25T01:00:00.000Z' };
    expect(segment(shift).map((s) => s.minutes)).toEqual([240]);
  });
});

describe('segmentShift: unpaid break (D7)', () => {
  const paid = (slices: SegmentSlice[]) => slices.map((s) => s.paidMinutes);
  const breaks = (slices: SegmentSlice[]) => slices.map((s) => s.breakMinutes);

  it('takes 30 min off the longest slice', () => {
    const slices = segment(winterNight(30), [band('23:00', '05:00')]);
    expect(breaks(slices)).toEqual([0, 0, 30, 0]);
    expect(paid(slices)).toEqual([60, 60, 270, 60]);
  });

  it('on a tie, takes it off the earliest slice', () => {
    const slices = segment(shiftOf('2026-01-15', '20:00', '2026-01-16', '04:00', 30));
    expect(slices.map((s) => s.minutes)).toEqual([240, 240]);
    expect(paid(slices)).toEqual([210, 240]);
  });

  it('a break longer than the longest slice spills to the next longest (tie -> earliest)', () => {
    const slices = segment(winterNight(330), [band('23:00', '05:00')]);
    expect(breaks(slices)).toEqual([30, 0, 300, 0]);
    expect(paid(slices)).toEqual([30, 60, 0, 60]);
  });

  it('a break equal to or longer than the shift leaves every slice at 0 paid', () => {
    for (const brk of [480, 1000]) {
      const slices = segment(winterNight(brk), [band('23:00', '05:00')]);
      expect(paid(slices)).toEqual([0, 0, 0, 0]);
      expect(breaks(slices)).toEqual([60, 60, 300, 60]);
    }
  });

  it('sum(paidMinutes) = total minutes - break, never negative', () => {
    for (const brk of [0, 1, 30, 59, 61, 300, 361, 479, 480, 481]) {
      const slices = segment(winterNight(brk), [band('23:00', '05:00')]);
      expect(sum(slices, 'paidMinutes')).toBe(Math.max(0, 480 - brk));
      expect(sum(slices, 'breakMinutes')).toBe(Math.min(480, brk));
      expect(slices.every((s) => s.paidMinutes >= 0 && s.paidMinutes === s.minutes - s.breakMinutes)).toBe(true);
    }
  });
});

describe('segmentShift: validation', () => {
  it('throws if the shift ends at or before its start', () => {
    expect(() => segment(shiftOf('2026-01-15', '09:00', '2026-01-15', '09:00'))).toThrow(/end/i);
    expect(() => segment(shiftOf('2026-01-15', '09:00', '2026-01-15', '08:00'))).toThrow(/end/i);
  });

  it('throws if the shift is longer than 26h; exactly 26h passes', () => {
    expect(() => segment(shiftOf('2026-01-15', '08:00', '2026-01-16', '10:01'))).toThrow(/26h/);
    expect(segment(shiftOf('2026-01-15', '08:00', '2026-01-16', '10:00')).map((s) => s.minutes)).toEqual([
      960, 600,
    ]);
  });

  it('throws on a negative or fractional break', () => {
    expect(() => segment(winterNight(-1))).toThrow(/break/i);
    expect(() => segment(winterNight(1.5))).toThrow(/break/i);
  });
});
