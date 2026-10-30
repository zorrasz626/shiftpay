import { holidaySummary } from '../holiday';
import { addLocalDays, localToInstant } from '../time';
import type { Job, LocalDate, Shift, ShiftStatus, WallClockTime } from '../types';

const job: Job = {
  id: 'j1',
  name: 'Test job',
  baseRatePence: 1200,
  payFrequency: 'weekly',
  payPeriodAnchorDate: '2026-01-05',
  payDayOffsetDays: 5,
  periodCutoffDay: 31,
  contractedHoursPerWeek: 39,
  bankHolidayRegion: 'england-and-wales',
  overtimePremiumMode: 'highest',
  holidayYearStart: '2026-04-01',
  holidayEntitlementHours: 224,
  holidayMode: 'fixed',
};

const accrualJob: Job = { ...job, holidayMode: 'accrual' };

let nextId = 0;
function shift(
  date: LocalDate,
  status: ShiftStatus,
  start: WallClockTime = '09:00',
  end: WallClockTime = '17:00',
  extra: Partial<Shift> = {},
): Shift {
  const endDate = end <= start ? addLocalDays(date, 1) : date;
  nextId += 1;
  return {
    id: `s${nextId}`,
    jobId: 'j1',
    date,
    start: localToInstant(date, start),
    end: localToInstant(endDate, end),
    unpaidBreakMinutes: 0,
    source: 'manual',
    status,
    overtimeFlag: false,
    ...extra,
  };
}

describe('holidaySummary: fixed mode', () => {
  // 2026-04-01 .. 2027-03-31: 365 days.
  const shifts = [
    shift('2026-05-04', 'holiday'), // 8h taken
    shift('2026-06-01', 'holiday'), // 8h taken
    shift('2026-07-01', 'holiday'), // today: booked
    shift('2026-08-03', 'holiday', '09:00', '13:00'), // 4h booked
    shift('2026-06-15', 'worked'), // not holiday: ignored
    shift('2026-06-16', 'sick'),
  ];

  it('entitled, pro-rata accrued, taken vs booked split at today, remaining', () => {
    const s = holidaySummary(job, shifts, '2026-07-01');
    expect(s.yearStart).toBe('2026-04-01');
    expect(s.yearEnd).toBe('2027-03-31');
    expect(s.entitled).toBe(224);
    // 1 Apr .. 1 Jul inclusive = 92 days.
    expect(s.accrued).toBeCloseTo((224 * 92) / 365, 10);
    expect(s.taken).toBe(16);
    expect(s.booked).toBe(12);
    expect(s.remaining).toBe(196);
  });

  it('accrued on the first day of the year is one day of 365', () => {
    const s = holidaySummary(job, [], '2026-04-01');
    expect(s.accrued).toBeCloseTo(224 / 365, 10);
    expect(s.taken).toBe(0);
    expect(s.booked).toBe(0);
    expect(s.remaining).toBe(224);
  });

  it('accrued on the last day of the year equals the entitlement', () => {
    const s = holidaySummary(job, shifts, '2027-03-31');
    expect(s.yearStart).toBe('2026-04-01');
    expect(s.yearEnd).toBe('2027-03-31');
    expect(s.accrued).toBe(224);
    expect(s.taken).toBe(28);
    expect(s.booked).toBe(0);
  });

  it('remaining may go negative', () => {
    const over = Array.from({ length: 30 }, (_, i) =>
      shift(addLocalDays('2026-04-06', i), 'holiday'),
    );
    const s = holidaySummary(job, over, '2026-05-01');
    expect(s.taken + s.booked).toBe(240);
    expect(s.remaining).toBe(-16);
  });

  it('a year containing 29 Feb has 366 days', () => {
    const leap = { ...job, holidayYearStart: '2027-04-01' };
    const s = holidaySummary(leap, [], '2027-09-30');
    expect(s.yearEnd).toBe('2028-03-31');
    // 1 Apr 2027 .. 30 Sep 2027 = 183 days.
    expect(s.accrued).toBeCloseTo((224 * 183) / 366, 10);
  });
});

describe('holidaySummary: accrual mode', () => {
  it('12.07% of worked hours: 100h -> 12.07h', () => {
    const worked = Array.from({ length: 10 }, (_, i) =>
      shift(addLocalDays('2026-04-06', i), 'worked', '08:00', '18:00'),
    );
    const s = holidaySummary(accrualJob, worked, '2026-05-01');
    expect(s.accrued).toBe(12.07);
    expect(s.entitled).toBe(12.07);
    expect(s.remaining).toBe(12.07);
  });

  it('sick, planned, cancelled and holiday hours are not accrued', () => {
    const shifts = [
      shift('2026-04-06', 'worked', '08:00', '18:00'), // 10h
      shift('2026-04-07', 'sick'),
      shift('2026-04-08', 'planned'),
      shift('2026-04-09', 'cancelled'),
      shift('2026-04-10', 'holiday'), // 8h taken
    ];
    const s = holidaySummary(accrualJob, shifts, '2026-05-01');
    expect(s.accrued).toBe(1.207);
    expect(s.taken).toBe(8);
    expect(s.remaining).toBe(-6.793);
  });

  it('worked shifts after today are not accrued; today is', () => {
    const shifts = [
      shift('2026-05-01', 'worked', '08:00', '18:00'), // today
      shift('2026-05-02', 'worked', '08:00', '18:00'), // future
    ];
    const s = holidaySummary(accrualJob, shifts, '2026-05-01');
    expect(s.accrued).toBe(1.207);
  });

  it('worked hours are paid hours (break deducted, overnight shifts)', () => {
    const shifts = [
      shift('2026-04-06', 'worked', '22:00', '06:00', { unpaidBreakMinutes: 30 }), // 7.5h
      shift('2026-04-07', 'worked', '09:00', '09:20', { unpaidBreakMinutes: 60 }), // 0h, not negative
    ];
    const s = holidaySummary(accrualJob, shifts, '2026-05-01');
    expect(s.accrued).toBe(0.90525);
  });
});

describe('holidaySummary: holiday-year boundaries', () => {
  it('today before this year’s anniversary falls in the previous year', () => {
    const s = holidaySummary(job, [], '2027-03-15');
    expect(s.yearStart).toBe('2026-04-01');
    expect(s.yearEnd).toBe('2027-03-31');
    const before = holidaySummary(job, [], '2026-03-31');
    expect(before.yearStart).toBe('2025-04-01');
    expect(before.yearEnd).toBe('2026-03-31');
  });

  it('a holidayYearStart in the future still gives the year containing today', () => {
    const s = holidaySummary({ ...job, holidayYearStart: '2030-01-01' }, [], '2026-07-01');
    expect(s.yearStart).toBe('2026-01-01');
    expect(s.yearEnd).toBe('2026-12-31');
  });

  it('a 29 Feb start clamps to 28 Feb in non-leap years', () => {
    const feb29 = { ...job, holidayYearStart: '2024-02-29' };
    expect(holidaySummary(feb29, [], '2027-02-27')).toMatchObject({
      yearStart: '2026-02-28',
      yearEnd: '2027-02-27',
    });
    expect(holidaySummary(feb29, [], '2027-02-28')).toMatchObject({
      yearStart: '2027-02-28',
      yearEnd: '2028-02-28',
    });
    expect(holidaySummary(feb29, [], '2028-02-29')).toMatchObject({
      yearStart: '2028-02-29',
      yearEnd: '2029-02-27',
    });
  });

  it('shifts outside the year or of another job are ignored', () => {
    const shifts = [
      shift('2026-03-31', 'holiday'), // previous year
      shift('2026-04-01', 'holiday'), // first day: counts
      shift('2027-03-31', 'holiday'), // last day: counts
      shift('2027-04-01', 'holiday'), // next year
      shift('2026-05-01', 'holiday', '09:00', '17:00', { jobId: 'j2' }),
      shift('2026-03-31', 'worked', '08:00', '18:00'),
      shift('2026-05-01', 'worked', '08:00', '18:00', { jobId: 'j2' }),
    ];
    const s = holidaySummary(job, shifts, '2026-07-01');
    expect(s.taken).toBe(8);
    expect(s.booked).toBe(8);
    expect(holidaySummary(accrualJob, shifts, '2026-07-01').accrued).toBe(0);
  });

  it('throws on an invalid today', () => {
    expect(() => holidaySummary(job, [], '2026-13-01')).toThrow();
  });
});

describe('holidaySummary: paid hours', () => {
  it('a holiday shift with an unpaid break counts paid hours only', () => {
    const shifts = [shift('2026-05-04', 'holiday', '09:00', '17:30', { unpaidBreakMinutes: 30 })];
    const s = holidaySummary(job, shifts, '2026-07-01');
    expect(s.taken).toBe(8);
    expect(s.remaining).toBe(216);
  });

  it('a holiday shift across the BST change counts real elapsed hours', () => {
    // 28 -> 29 Mar 2026: clocks go forward, 22:00-06:00 is 7h.
    const s = holidaySummary(job, [shift('2026-03-28', 'holiday', '22:00', '06:00')], '2026-03-30');
    expect(s.taken).toBe(7);
  });
});
