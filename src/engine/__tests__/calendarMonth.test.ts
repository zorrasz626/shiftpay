import snapshot from '../../config/bankHolidays.json';
import { createBankHolidayLookup } from '../bankHolidays';
import { type CalendarDay, addMonths, calendarMonth, monthRange } from '../calendarMonth';
import type { BankHolidayData, LocalDate, Shift } from '../types';

const bankHolidays = createBankHolidayLookup(snapshot as BankHolidayData);

function shift(date: LocalDate, overrides: Partial<Shift> = {}): Shift {
  return {
    id: `s-${date}`,
    jobId: 'j1',
    date,
    start: `${date}T08:00:00.000Z`,
    end: `${date}T16:00:00.000Z`,
    unpaidBreakMinutes: 0,
    source: 'manual',
    status: 'planned',
    overtimeFlag: false,
    ...overrides,
  };
}

function month(year: number, m: number, shifts: Shift[] = [], today = '2026-06-17') {
  return calendarMonth({ year, month: m, shifts, bankHolidays, region: 'england-and-wales', today });
}

const days = (weeks: CalendarDay[][]): CalendarDay[] => weeks.flat();
const inMonth = (weeks: CalendarDay[][]): CalendarDay[] => days(weeks).filter((d) => d.inMonth);
const dayOf = (weeks: CalendarDay[][], date: LocalDate): CalendarDay => {
  const found = days(weeks).find((d) => d.date === date);
  if (found === undefined) throw new Error(`${date} not in grid`);
  return found;
};

/** Every in-month day, in order, with no gaps or duplicates. */
function expectWholeMonth(weeks: CalendarDay[][], first: LocalDate, count: number): void {
  const dates = inMonth(weeks).map((d) => d.date);
  expect(dates).toHaveLength(count);
  expect(new Set(dates).size).toBe(count);
  expect(dates[0]).toBe(first);
  inMonth(weeks).forEach((d, i) => expect(d.dayOfMonth).toBe(i + 1));
}

describe('calendarMonth grid', () => {
  it('lays out a month starting on Monday with no leading padding (June 2026)', () => {
    const { title, weeks } = month(2026, 6);
    expect(title).toBe('June 2026');
    expect(weeks).toHaveLength(5);
    weeks.forEach((w) => expect(w).toHaveLength(7));
    expect(weeks[0][0]).toMatchObject({ date: '2026-06-01', dayOfMonth: 1, inMonth: true });
    expect(weeks[4][1]).toMatchObject({ date: '2026-06-30', inMonth: true });
    expect(weeks[4][2]).toMatchObject({ date: '2026-07-01', dayOfMonth: 1, inMonth: false });
    expect(weeks[4][6].date).toBe('2026-07-05');
    expectWholeMonth(weeks, '2026-06-01', 30);
  });

  it('pads a month starting on Sunday with the previous Monday-Saturday (March 2026, DST)', () => {
    const { title, weeks } = month(2026, 3);
    expect(title).toBe('March 2026');
    expect(weeks).toHaveLength(6);
    expect(weeks[0].map((d) => d.date)).toEqual([
      '2026-02-23',
      '2026-02-24',
      '2026-02-25',
      '2026-02-26',
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
    ]);
    expect(weeks[0].slice(0, 6).every((d) => !d.inMonth)).toBe(true);
    expect(weeks[5][6].date).toBe('2026-04-05');
    expectWholeMonth(weeks, '2026-03-01', 31);
  });

  it('renders all 31 days of October 2026 (DST end) with no duplicates or gaps', () => {
    const { title, weeks } = month(2026, 10);
    expect(title).toBe('October 2026');
    expect(weeks).toHaveLength(5);
    expect(weeks[0][0].date).toBe('2026-09-28');
    expect(weeks[0][3]).toMatchObject({ date: '2026-10-01', inMonth: true });
    // 25 Oct (the 25-hour day) is a Sunday.
    expect(weeks[3][6].date).toBe('2026-10-25');
    expect(weeks[4][6]).toMatchObject({ date: '2026-11-01', inMonth: false });
    expectWholeMonth(weeks, '2026-10-01', 31);
  });

  it('handles leap Februaries', () => {
    expect(inMonth(month(2028, 2).weeks)).toHaveLength(29);
    expect(monthRange(2027, 2)).toEqual({ start: '2027-02-01', end: '2027-02-28' });
    expect(monthRange(2026, 12)).toEqual({ start: '2026-12-01', end: '2026-12-31' });
  });

  it('marks today only on its own date', () => {
    const { weeks } = month(2026, 6, [], '2026-06-17');
    expect(days(weeks).filter((d) => d.isToday).map((d) => d.date)).toEqual(['2026-06-17']);
    expect(days(month(2026, 7, [], '2026-06-17').weeks).some((d) => d.isToday)).toBe(false);
  });

  it('marks bank holidays for the job region', () => {
    const ew = month(2026, 8).weeks;
    expect(dayOf(ew, '2026-08-31').isBankHoliday).toBe(true);
    expect(dayOf(ew, '2026-08-03').isBankHoliday).toBe(false);
    const scot = calendarMonth({
      year: 2026,
      month: 8,
      shifts: [],
      bankHolidays,
      region: 'scotland',
      today: '2026-06-17',
    }).weeks;
    expect(dayOf(scot, '2026-08-03').isBankHoliday).toBe(true);
    expect(dayOf(scot, '2026-08-31').isBankHoliday).toBe(false);
  });
});

describe('calendarMonth shifts', () => {
  it('shows a night shift across the October clock change once, with London times', () => {
    // Sat 24 Oct 19:00 BST (18:00Z) to Sun 25 Oct 07:00 GMT (07:00Z): 13 real hours.
    const night = shift('2026-10-24', {
      start: '2026-10-24T18:00:00.000Z',
      end: '2026-10-25T07:00:00.000Z',
      status: 'worked',
    });
    const { weeks } = month(2026, 10, [night]);
    const all = days(weeks).flatMap((d) => d.shifts);
    expect(all).toHaveLength(1);
    expect(dayOf(weeks, '2026-10-24').shifts).toEqual([
      { id: 's-2026-10-24', kind: 'night', code: 'N', label: 'Night shift 19:00–07:00, worked' },
    ]);
    expect(dayOf(weeks, '2026-10-25').shifts).toEqual([]);
  });

  it('shows a night shift across the March clock change once, with London times', () => {
    // Sat 28 Mar 19:00 GMT (19:00Z) to Sun 29 Mar 07:00 BST (06:00Z): 11 real hours.
    const night = shift('2026-03-28', {
      start: '2026-03-28T19:00:00.000Z',
      end: '2026-03-29T06:00:00.000Z',
    });
    const { weeks } = month(2026, 3, [night]);
    expect(days(weeks).flatMap((d) => d.shifts)).toHaveLength(1);
    expect(dayOf(weeks, '2026-03-28').shifts[0].label).toBe('Night shift 19:00–07:00, planned');
    expect(dayOf(weeks, '2026-03-29').shifts).toEqual([]);
  });

  it.each([
    ['cancelled beats overtime', { status: 'cancelled', overtimeFlag: true }, 'cancelled', 'X', 'Cancelled shift 09:00–17:00'],
    ['holiday', { status: 'holiday' }, 'holiday', 'H', 'Holiday 09:00–17:00'],
    ['sick', { status: 'sick', overtimeFlag: true }, 'sick', 'S', 'Sick 09:00–17:00'],
    ['overtime', { overtimeFlag: true, status: 'worked' }, 'overtime', 'OT', 'Overtime shift 09:00–17:00, worked'],
    ['day', {}, 'day', 'D', 'Day shift 09:00–17:00, planned'],
  ] as const)('codes %s', (_name, overrides, kind, code, label) => {
    const s = shift('2026-06-10', overrides as Partial<Shift>);
    expect(dayOf(month(2026, 6, [s]).weeks, '2026-06-10').shifts).toEqual([
      { id: 's-2026-06-10', kind, code, label },
    ]);
  });

  it('codes an evening shift starting at 18:00 as night even if it ends before midnight', () => {
    const s = shift('2026-06-10', {
      start: '2026-06-10T17:00:00.000Z',
      end: '2026-06-10T22:00:00.000Z',
    });
    expect(dayOf(month(2026, 6, [s]).weeks, '2026-06-10').shifts[0]).toMatchObject({
      kind: 'night',
      code: 'N',
      label: 'Night shift 18:00–23:00, planned',
    });
    const early = shift('2026-06-11', {
      start: '2026-06-11T16:59:00.000Z',
      end: '2026-06-11T22:00:00.000Z',
    });
    expect(dayOf(month(2026, 6, [early]).weeks, '2026-06-11').shifts[0].kind).toBe('day');
  });

  it('sorts a day’s shifts by start, keeps padded-day shifts and drops shifts outside the grid', () => {
    const late = shift('2026-06-10', { id: 'late', start: '2026-06-10T15:00:00.000Z', end: '2026-06-10T19:00:00.000Z' });
    const early = shift('2026-06-10', { id: 'early', start: '2026-06-10T05:00:00.000Z', end: '2026-06-10T09:00:00.000Z' });
    const padded = shift('2026-07-03');
    const outside = shift('2026-07-06');
    const { weeks } = month(2026, 6, [late, early, padded, outside]);
    expect(dayOf(weeks, '2026-06-10').shifts.map((s) => s.id)).toEqual(['early', 'late']);
    expect(dayOf(weeks, '2026-07-03')).toMatchObject({ inMonth: false });
    expect(dayOf(weeks, '2026-07-03').shifts).toHaveLength(1);
    expect(days(weeks).flatMap((d) => d.shifts)).toHaveLength(3);
  });
});

describe('addMonths', () => {
  it.each([
    [2026, 10, 1, 2026, 11],
    [2026, 12, 1, 2027, 1],
    [2026, 1, -1, 2025, 12],
    [2026, 3, 0, 2026, 3],
    [2026, 10, -22, 2024, 12],
    [2026, 11, 14, 2028, 1],
  ])('%i-%i plus %i is %i-%i', (y, m, n, ey, em) => {
    expect(addMonths(y, m, n)).toEqual({ year: ey, month: em });
  });
});
