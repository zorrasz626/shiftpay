import {
  LONDON_TZ,
  addLocalDays,
  addMinutes,
  instantToLocal,
  localDayLengthMinutes,
  localToInstant,
  minutesBetween,
  nextLocalMidnights,
  startOfLocalDay,
  utcOffsetMinutes,
} from '../time';

describe('zone constant', () => {
  it('is Europe/London', () => {
    expect(LONDON_TZ).toBe('Europe/London');
  });
});

describe('localToInstant', () => {
  it('converts winter (GMT) wall-clock times', () => {
    expect(localToInstant('2026-01-15', '09:00')).toBe('2026-01-15T09:00:00.000Z');
  });

  it('converts summer (BST) wall-clock times', () => {
    expect(localToInstant('2026-07-01', '09:00')).toBe('2026-07-01T08:00:00.000Z');
    expect(localToInstant('2026-07-01', '00:00')).toBe('2026-06-30T23:00:00.000Z');
  });

  it('moves a non-existent time forward (D4): 01:30 on 29 Mar 2026 -> 02:30 BST', () => {
    const instant = localToInstant('2026-03-29', '01:30');
    expect(instant).toBe('2026-03-29T01:30:00.000Z');
    expect(instantToLocal(instant).time).toBe('02:30');
  });

  it('moves a non-existent time forward in 2027 too', () => {
    expect(localToInstant('2027-03-28', '01:00')).toBe('2027-03-28T01:00:00.000Z');
  });

  it('uses the first occurrence of an ambiguous time (D4): 01:30 on 25 Oct 2026', () => {
    expect(localToInstant('2026-10-25', '01:30')).toBe('2026-10-25T00:30:00.000Z');
    expect(localToInstant('2027-10-31', '01:00')).toBe('2027-10-31T00:00:00.000Z');
  });

  it('handles the times right around the transitions', () => {
    expect(localToInstant('2026-03-29', '00:59')).toBe('2026-03-29T00:59:00.000Z');
    expect(localToInstant('2026-03-29', '02:00')).toBe('2026-03-29T01:00:00.000Z');
    expect(localToInstant('2026-10-25', '00:59')).toBe('2026-10-24T23:59:00.000Z');
    expect(localToInstant('2026-10-25', '02:00')).toBe('2026-10-25T02:00:00.000Z');
  });

  it('rejects malformed dates and times', () => {
    expect(() => localToInstant('2026-1-15', '09:00')).toThrow(/LocalDate/);
    expect(() => localToInstant('2026-02-30', '09:00')).toThrow(/LocalDate/);
    expect(() => localToInstant('2026-01-15', '9:00')).toThrow(/WallClockTime/);
    expect(() => localToInstant('2026-01-15', '24:00')).toThrow(/WallClockTime/);
    expect(() => localToInstant('2026-01-15', '12:60')).toThrow(/WallClockTime/);
  });
});

describe('instantToLocal', () => {
  it('gives the London date, time and day of week', () => {
    expect(instantToLocal('2026-06-30T23:30:00.000Z')).toEqual({
      date: '2026-07-01',
      time: '00:30',
      dayOfWeek: 3,
    });
    expect(instantToLocal('2026-03-29T00:30:00.000Z')).toEqual({
      date: '2026-03-29',
      time: '00:30',
      dayOfWeek: 0,
    });
  });

  it('shows both occurrences of the repeated hour on 25 Oct 2026', () => {
    expect(instantToLocal('2026-10-25T00:30:00.000Z').time).toBe('01:30');
    expect(instantToLocal('2026-10-25T01:30:00.000Z').time).toBe('01:30');
  });

  it('truncates seconds rather than rounding', () => {
    expect(instantToLocal('2026-01-15T09:00:59.999Z').time).toBe('09:00');
  });

  it('rejects an unparseable instant', () => {
    expect(() => instantToLocal('not-a-date')).toThrow(/IsoInstant/);
  });

  it('round-trips normal times all year', () => {
    const cases: [string, string][] = [
      ['2026-01-01', '00:00'],
      ['2026-03-28', '23:59'],
      ['2026-03-29', '03:00'],
      ['2026-06-21', '12:34'],
      ['2026-10-24', '22:00'],
      ['2026-10-25', '02:30'],
      ['2026-12-31', '23:59'],
      ['2028-02-29', '06:15'],
    ];
    for (const [date, time] of cases) {
      const local = instantToLocal(localToInstant(date, time));
      expect([local.date, local.time]).toEqual([date, time]);
    }
  });
});

describe('startOfLocalDay', () => {
  it('returns the instant of local midnight', () => {
    expect(startOfLocalDay('2026-01-15')).toBe('2026-01-15T00:00:00.000Z');
    expect(startOfLocalDay('2026-07-01')).toBe('2026-06-30T23:00:00.000Z');
    expect(startOfLocalDay('2026-03-29')).toBe('2026-03-29T00:00:00.000Z');
    expect(startOfLocalDay('2026-10-25')).toBe('2026-10-24T23:00:00.000Z');
  });
});

describe('addLocalDays', () => {
  it('adds and subtracts calendar days across months, years and leap days', () => {
    expect(addLocalDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addLocalDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addLocalDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addLocalDays('2026-10-25', 0)).toBe('2026-10-25');
    expect(addLocalDays('2026-01-01', 365)).toBe('2027-01-01');
  });

  it('rejects a malformed date', () => {
    expect(() => addLocalDays('2026/01/01', 1)).toThrow(/LocalDate/);
  });
});

describe('localDayLengthMinutes', () => {
  it('is 1440 on normal days', () => {
    expect(localDayLengthMinutes('2026-01-15')).toBe(1440);
    expect(localDayLengthMinutes('2026-07-01')).toBe(1440);
    expect(localDayLengthMinutes('2026-03-28')).toBe(1440);
    expect(localDayLengthMinutes('2026-10-26')).toBe(1440);
  });

  it('is 1380 on the GMT->BST days (29 Mar 2026, 28 Mar 2027)', () => {
    expect(localDayLengthMinutes('2026-03-29')).toBe(1380);
    expect(localDayLengthMinutes('2027-03-28')).toBe(1380);
  });

  it('is 1500 on the BST->GMT days (25 Oct 2026, 31 Oct 2027)', () => {
    expect(localDayLengthMinutes('2026-10-25')).toBe(1500);
    expect(localDayLengthMinutes('2027-10-31')).toBe(1500);
  });
});

describe('utcOffsetMinutes', () => {
  it('is 0 in GMT and 60 in BST', () => {
    expect(utcOffsetMinutes('2026-01-15T12:00:00.000Z')).toBe(0);
    expect(utcOffsetMinutes('2026-07-01T12:00:00.000Z')).toBe(60);
  });

  it('switches exactly at 01:00 UTC on the change days', () => {
    expect(utcOffsetMinutes('2026-03-29T00:59:00.000Z')).toBe(0);
    expect(utcOffsetMinutes('2026-03-29T01:00:00.000Z')).toBe(60);
    expect(utcOffsetMinutes('2026-10-25T00:59:00.000Z')).toBe(60);
    expect(utcOffsetMinutes('2026-10-25T01:00:00.000Z')).toBe(0);
  });
});

describe('addMinutes', () => {
  it('adds real elapsed minutes, forwards and backwards', () => {
    expect(addMinutes('2026-01-15T09:00:00.000Z', 510)).toBe('2026-01-15T17:30:00.000Z');
    expect(addMinutes('2026-01-15T17:30:00Z', -510)).toBe('2026-01-15T09:00:00.000Z');
  });

  it('ignores the BST/GMT change (elapsed time, not wall-clock)', () => {
    // 00:00 BST 25 Oct 2026 + 120 min = 01:00 GMT (the clocks went back in between).
    expect(addMinutes(localToInstant('2026-10-25', '00:00'), 120)).toBe('2026-10-25T01:00:00.000Z');
  });
});

describe('minutesBetween', () => {
  it('measures real elapsed minutes', () => {
    expect(minutesBetween('2026-01-15T09:00:00.000Z', '2026-01-15T17:30:00.000Z')).toBe(510);
    expect(minutesBetween('2026-01-15T17:30:00.000Z', '2026-01-15T09:00:00.000Z')).toBe(-510);
  });

  it('a 22:00 -> 06:00 night shift is 420 min across GMT->BST and 540 across BST->GMT', () => {
    const night = (start: string, end: string) =>
      minutesBetween(localToInstant(start, '22:00'), localToInstant(end, '06:00'));
    expect(night('2026-03-28', '2026-03-29')).toBe(420);
    expect(night('2027-03-27', '2027-03-28')).toBe(420);
    expect(night('2026-10-24', '2026-10-25')).toBe(540);
    expect(night('2027-10-30', '2027-10-31')).toBe(540);
    expect(night('2026-01-15', '2026-01-16')).toBe(480);
  });
});

describe('nextLocalMidnights', () => {
  it('lists every local midnight strictly inside the range', () => {
    expect(
      nextLocalMidnights(localToInstant('2026-03-28', '22:00'), localToInstant('2026-03-31', '01:00')),
    ).toEqual([
      '2026-03-29T00:00:00.000Z',
      '2026-03-29T23:00:00.000Z',
      '2026-03-30T23:00:00.000Z',
    ]);
    expect(
      nextLocalMidnights(localToInstant('2026-10-24', '22:00'), localToInstant('2026-10-25', '06:00')),
    ).toEqual(['2026-10-24T23:00:00.000Z']);
  });

  it('excludes midnights at either end of the range', () => {
    const start = startOfLocalDay('2026-07-01');
    const end = startOfLocalDay('2026-07-03');
    expect(nextLocalMidnights(start, end)).toEqual([startOfLocalDay('2026-07-02')]);
  });

  it('is empty for a same-day range or an empty/reversed range', () => {
    expect(
      nextLocalMidnights(localToInstant('2026-01-15', '09:00'), localToInstant('2026-01-15', '17:00')),
    ).toEqual([]);
    const t = localToInstant('2026-01-15', '09:00');
    expect(nextLocalMidnights(t, t)).toEqual([]);
    expect(nextLocalMidnights(t, localToInstant('2026-01-14', '09:00'))).toEqual([]);
  });
});
