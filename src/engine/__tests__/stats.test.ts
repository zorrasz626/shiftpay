import snapshot from '../../config/bankHolidays.json';
import { createBankHolidayLookup } from '../bankHolidays';
import { sumPence } from '../money';
import { calculateShifts } from '../shiftPay';
import { monthlyStats } from '../stats';
import type { MonthlyStats, MonthlyStatsInput } from '../stats';
import { addMinutes, localToInstant } from '../time';
import type { BankHolidayData, Job, LocalDate, PremiumRule, Shift, ShiftStatus } from '../types';

const bankHolidays = createBankHolidayLookup(snapshot as BankHolidayData);

/** Weekly, Monday-Sunday pay periods (18 Jan 2027 is a Monday). Base 1200p/h. */
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

const common = { jobId: 'j1', priority: 0, stacking: 'highest_only' } as const;
/** 22:00-06:00, +300p/h. */
const night: PremiumRule = {
  ...common,
  id: 'night',
  name: 'Night',
  multiplier: 1.25,
  type: 'time_band',
  startTime: '22:00',
  endTime: '06:00',
};
/** Beyond 16h in a Thursday-Wednesday week, +600p/h: the 28 Jan - 3 Feb 2027 week spans a month end. */
const weeklyOt: PremiumRule = {
  ...common,
  id: 'ot-weekly',
  name: 'Weekly overtime',
  multiplier: 1.5,
  type: 'overtime_weekly',
  thresholdHours: 16,
  weekStartsOn: 4,
};
/** As weeklyOt but only +100p/h (less than Night's +300). */
const cheapOt: PremiumRule = { ...weeklyOt, id: 'ot-cheap', name: 'Cheap OT', multiplier: undefined, flatAddPencePerHour: 100 };
/** Another job's rule: ignored. */
const otherJobRule: PremiumRule = { ...night, id: 'other', jobId: 'j2' };

/** A shift starting at London `hour`:00 on `date` for `hours`. */
function sh(
  id: string,
  date: LocalDate,
  hour: number,
  hours: number,
  extra: { status?: ShiftStatus; jobId?: string } = {},
): Shift {
  const start = localToInstant(date, `${String(hour).padStart(2, '0')}:00`);
  return {
    id,
    jobId: extra.jobId ?? 'j1',
    date,
    start,
    end: addMinutes(start, hours * 60),
    unpaidBreakMinutes: 0,
    source: 'manual',
    status: extra.status ?? 'planned',
    overtimeFlag: false,
  };
}

const LATER = '2027-06-01T00:00:00.000Z';

function stats(input: Partial<MonthlyStatsInput> & Pick<MonthlyStatsInput, 'shifts' | 'from' | 'to'>): MonthlyStats {
  const result = monthlyStats({ job, rules: [night], bankHolidays, now: LATER, ...input });
  // Totals are the sums of the months (pence never re-rounded).
  const pick = (k: 'grossPence' | 'basePence' | 'premiumPence' | 'overtimePence') =>
    sumPence(result.months.map((m) => m[k]));
  expect(result.totals.grossPence).toBe(pick('grossPence'));
  expect(result.totals.basePence).toBe(pick('basePence'));
  expect(result.totals.premiumPence).toBe(pick('premiumPence'));
  expect(result.totals.overtimePence).toBe(pick('overtimePence'));
  expect(result.totals.paidHours).toBeCloseTo(result.months.reduce((a, m) => a + m.paidHours, 0), 10);
  expect(result.totals.overtimeHours).toBeCloseTo(result.months.reduce((a, m) => a + m.overtimeHours, 0), 10);
  for (const m of result.months) {
    expect(m.grossPence).toBe(sumPence([m.basePence, m.premiumPence, m.overtimePence]));
  }
  return result;
}

const rows = (r: MonthlyStats) =>
  r.months.map((m) => [m.month, m.grossPence, m.basePence, m.premiumPence, m.overtimePence, m.paidHours, m.overtimeHours]);
const ruleRows = (byRule: MonthlyStats['totals']['byRule']) => byRule.map((r) => [r.ruleId, r.ruleName, r.type, r.hours, r.pence]);

describe('monthlyStats', () => {
  it('sums shift totals per London month; a night shift over a month end counts in its start month', () => {
    const shifts = [
      sh('a', '2027-01-12', 9, 8, { status: 'worked' }), // 9600
      sh('b', '2027-01-31', 22, 8), // 31 Jan 22:00 - 1 Feb 06:00: 9600 + 8h x 300 night
      sh('c', '2027-02-09', 9, 8, { status: 'sick' }), // base only: 9600
      sh('d', '2027-02-10', 9, 8, { status: 'cancelled' }), // 0
      sh('x', '2027-02-11', 9, 8, { jobId: 'j2' }), // another job: ignored
    ];
    const r = stats({ shifts, from: '2027-01', to: '2027-02', rules: [night, otherJobRule] });
    expect(rows(r)).toEqual([
      ['2027-01', 21600, 19200, 2400, 0, 16, 0],
      ['2027-02', 9600, 9600, 0, 0, 8, 0],
    ]);
    // Each month's gross is the sum of its shifts' engine totals.
    const engine = new Map(
      calculateShifts(shifts, job, [night], bankHolidays, { start: '2027-01-01', end: '2027-02-28' }).map((b) => [
        b.shiftId,
        b.totalGrossPence,
      ]),
    );
    expect(r.months[0].grossPence).toBe(sumPence([engine.get('a') as number, engine.get('b') as number]));
    expect(r.months[1].grossPence).toBe(sumPence([engine.get('c') as number, engine.get('d') as number]));
    expect(ruleRows(r.months[0].byRule)).toEqual([['night', 'Night', 'time_band', 8, 2400]]);
    expect(r.months[1].byRule).toEqual([]);
    expect(r.totals.grossPence).toBe(31200);
    expect(r.totals.paidHours).toBe(24);
    expect(ruleRows(r.totals.byRule)).toEqual([['night', 'Night', 'time_band', 8, 2400]]);
    expect(r.hasData).toBe(true);
  });

  it('weekly OT over a month boundary: OT hours and per-rule premium land in the shift month', () => {
    const shifts = [
      sh('thu', '2027-01-28', 9, 8),
      sh('fri', '2027-01-29', 9, 8, { status: 'worked' }),
      sh('mon', '2027-02-01', 9, 8), // 16h reached: all OT
      sh('tue', '2027-02-02', 20, 8), // all OT, night 22:00-04:00 stacks
    ];
    const r = stats({
      shifts,
      from: '2027-01',
      to: '2027-02',
      job: { ...job, overtimePremiumMode: 'stack' },
      rules: [weeklyOt, night],
    });
    expect(rows(r)).toEqual([
      ['2027-01', 19200, 19200, 0, 0, 16, 0],
      ['2027-02', 30600, 19200, 1800, 9600, 16, 16],
    ]);
    expect(r.months[0].byRule).toEqual([]);
    expect(ruleRows(r.months[1].byRule)).toEqual([
      ['ot-weekly', 'Weekly overtime', 'overtime_weekly', 16, 9600],
      ['night', 'Night', 'time_band', 6, 1800],
    ]);
    expect(r.totals.overtimeHours).toBe(16);
    expect(ruleRows(r.totals.byRule)).toEqual(ruleRows(r.months[1].byRule));
  });

  it('OT segments whose OT lost to a premium (highest mode) are not OT hours', () => {
    const shifts = [sh('thu', '2027-01-28', 9, 8), sh('fri', '2027-01-29', 9, 8), sh('sat', '2027-01-30', 22, 4)];
    const r = stats({ shifts, from: '2027-01', to: '2027-01', rules: [cheapOt, night] });
    // Sat 22:00-02:00 is past 16h: OT +100 loses to Night +300.
    expect(rows(r)).toEqual([['2027-01', 25200, 24000, 1200, 0, 20, 0]]);
    expect(ruleRows(r.months[0].byRule)).toEqual([['night', 'Night', 'time_band', 4, 1200]]);
  });

  it('only counts shifts that have ended by now', () => {
    const shifts = [
      sh('past', '2027-01-04', 9, 8), // planned, ended: counted
      sh('now', '2027-01-05', 9, 8), // ends exactly at now: counted
      sh('running', '2027-01-06', 9, 8, { status: 'worked' }), // ends after now
      sh('booked', '2027-01-20', 9, 8, { status: 'holiday' }), // future holiday
    ];
    const r = stats({ shifts, from: '2027-01', to: '2027-01', now: localToInstant('2027-01-05', '17:00') });
    expect(rows(r)).toEqual([['2027-01', 19200, 19200, 0, 0, 16, 0]]);
    expect(r.hasData).toBe(true);
  });

  it('counts only shifts dated in the range, across a year end', () => {
    // Weekly periods overlap the range: 30 Nov - 6 Dec 2026 and 28 Dec 2026 - 3 Jan 2027.
    const shifts = [sh('nov', '2026-11-30', 9, 8), sh('dec', '2026-12-15', 9, 8), sh('jan', '2027-01-02', 9, 8)];
    expect(rows(stats({ shifts, from: '2026-12', to: '2026-12' }))).toEqual([['2026-12', 9600, 9600, 0, 0, 8, 0]]);
    expect(rows(stats({ shifts, from: '2026-11', to: '2027-01' })).map((m) => [m[0], m[1]])).toEqual([
      ['2026-11', 9600],
      ['2026-12', 9600],
      ['2027-01', 9600],
    ]);
  });

  it('no shifts: zero months; only cancelled shifts: no data', () => {
    const empty = stats({ shifts: [], from: '2027-01', to: '2027-02' });
    expect(rows(empty)).toEqual([
      ['2027-01', 0, 0, 0, 0, 0, 0],
      ['2027-02', 0, 0, 0, 0, 0, 0],
    ]);
    expect(empty.hasData).toBe(false);
    const cancelled = stats({ shifts: [sh('c', '2027-01-12', 9, 8, { status: 'cancelled' })], from: '2027-01', to: '2027-01' });
    expect(cancelled.hasData).toBe(false);
  });

  it('empty range (to before from): no months, zero totals, no data', () => {
    const r = stats({ shifts: [sh('a', '2027-01-12', 9, 8)], from: '2027-02', to: '2027-01' });
    expect(r.months).toEqual([]);
    expect(r.totals).toEqual({
      grossPence: 0,
      basePence: 0,
      premiumPence: 0,
      overtimePence: 0,
      paidHours: 0,
      overtimeHours: 0,
      byRule: [],
    });
    expect(r.hasData).toBe(false);
  });

  it('throws on an invalid month', () => {
    expect(() => stats({ shifts: [], from: '2027-13', to: '2027-12' })).toThrow();
    expect(() => stats({ shifts: [], from: '2027-01', to: 'zzz' })).toThrow();
  });
});
