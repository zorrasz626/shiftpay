import snapshot from '../../config/bankHolidays.json';
import { createBankHolidayLookup } from '../bankHolidays';
import { weekStart } from '../overtime';
import { calculateShifts } from '../shiftPay';
import { localToInstant } from '../time';
import type {
  BankHolidayData,
  Job,
  LocalDate,
  PremiumRule,
  Shift,
  ShiftBreakdown,
  ShiftStatus,
} from '../types';

const bankHolidays = createBankHolidayLookup(snapshot as BankHolidayData);

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

const common = { jobId: 'j1', stacking: 'highest_only' as const, priority: 0 };
const weekly39: PremiumRule = {
  ...common,
  id: 'weekly',
  name: 'Weekly OT',
  multiplier: 1.5,
  type: 'overtime_weekly',
  thresholdHours: 39,
};
const period25: PremiumRule = {
  ...common,
  id: 'period',
  name: 'Period OT',
  multiplier: 2,
  type: 'overtime_period',
  thresholdHours: 25,
};
const daily8: PremiumRule = {
  ...common,
  id: 'daily',
  name: 'Daily OT',
  multiplier: 1.5,
  type: 'overtime_daily',
  thresholdHours: 8,
};

/** A 08:00-18:00 shift with a 30 min break: 570 paid minutes (9.5h). Nov 2026 is GMT. */
function day(date: LocalDate, status: ShiftStatus = 'worked'): Shift {
  return {
    id: `s-${date}`,
    jobId: 'j1',
    date,
    start: localToInstant(date, '08:00'),
    end: localToInstant(date, '18:00'),
    unpaidBreakMinutes: 30,
    source: 'manual',
    status,
    overtimeFlag: false,
  };
}

// Mon 2 Nov 2026 ... Sun 8 Nov 2026.
const MON = '2026-11-02';
const TUE = '2026-11-03';
const WED = '2026-11-04';
const THU = '2026-11-05';
const FRI = '2026-11-06';
const SAT = '2026-11-07';
const SUN = '2026-11-08';
const week = { start: MON, end: SUN };

function expectConsistent(b: ShiftBreakdown) {
  const sum = (key: 'basePence' | 'premiumPence' | 'overtimePence' | 'totalPence') =>
    b.segments.reduce((acc, s) => acc + s[key], 0);
  expect(b.basePence).toBe(sum('basePence'));
  expect(b.premiumPence).toBe(sum('premiumPence'));
  expect(b.overtimePence).toBe(sum('overtimePence'));
  expect(b.totalGrossPence).toBe(sum('totalPence'));
  expect(b.totalGrossPence).toBe(b.basePence + b.premiumPence + b.overtimePence);
  for (const s of b.segments) {
    expect(s.paidMinutes).toBe(s.minutes - s.breakMinutes);
    expect(s.totalPence).toBe(s.basePence + s.premiumPence + s.overtimePence);
    for (const p of [s.basePence, s.premiumPence, s.overtimePence, s.totalPence]) {
      expect(Number.isInteger(p)).toBe(true);
    }
  }
}

const row = (b: ShiftBreakdown) =>
  b.segments.map((s) => [s.start, s.end, s.minutes, s.breakMinutes, s.paidMinutes, s.isOvertime, s.overtimeRuleId]);

describe('weekStart', () => {
  it('goes back to the first day of the week', () => {
    expect(weekStart(SUN, 1)).toBe(MON);
    expect(weekStart(MON, 1)).toBe(MON);
    expect(weekStart(SAT, 0)).toBe('2026-11-01');
    expect(weekStart(SUN, 0)).toBe(SUN);
  });
});

describe('calculateShifts: weekly overtime', () => {
  it('SPEC: weekly 39h threshold crossed mid-shift splits Friday at the exact instant', () => {
    // 4 x 10h Mon-Thu with 30 min breaks = 38h paid; Friday crosses 39h after 1 paid hour.
    const shifts = [MON, TUE, WED, THU, FRI].map((d) => day(d));
    const out = calculateShifts(shifts, job, [weekly39], bankHolidays, week);
    expect(out.map((b) => b.shiftId)).toEqual(shifts.map((s) => s.id));
    for (const b of out.slice(0, 4)) {
      expect([b.overtimePence, b.totalGrossPence, b.segments.some((s) => s.isOvertime)]).toEqual([0, 11400, false]);
    }
    const fri = out[4];
    expect(row(fri)).toEqual([
      ['2026-11-06T08:00:00.000Z', '2026-11-06T09:30:00.000Z', 90, 30, 60, false, undefined],
      ['2026-11-06T09:30:00.000Z', '2026-11-06T18:00:00.000Z', 510, 0, 510, true, 'weekly'],
    ]);
    // 9.5h base = 11400; 8.5h OT uplift at 600/h = 5100.
    expect([fri.basePence, fri.premiumPence, fri.overtimePence, fri.totalGrossPence, fri.paidHours]).toEqual([
      11400, 0, 5100, 16500, 9.5,
    ]);
    out.forEach(expectConsistent);
  });

  it('weeks are chronological: input order does not matter', () => {
    const shifts = [FRI, THU, WED, TUE, MON].map((d) => day(d));
    const out = calculateShifts(shifts, job, [weekly39], bankHolidays, week);
    expect(out.map((b) => [b.shiftId, b.overtimePence])).toEqual([
      ['s-2026-11-06', 5100],
      ['s-2026-11-05', 0],
      ['s-2026-11-04', 0],
      ['s-2026-11-03', 0],
      ['s-2026-11-02', 0],
    ]);
  });

  it('weekStartsOn: Monday by default; Sunday starts a new week when set', () => {
    const rule = { ...weekly39, thresholdHours: 9 };
    const shifts = [day(SAT), day(SUN)];
    const monday = calculateShifts(shifts, job, [rule], bankHolidays, week);
    // Saturday: last 30 min past 9h. Monday-start week: Sunday follows Saturday, so all 570 min are OT.
    expect(monday.map((b) => b.overtimePence)).toEqual([300, 5700]);
    const sunday = calculateShifts(shifts, job, [{ ...rule, weekStartsOn: 0 }], bankHolidays, week);
    // Sunday-start week: Sunday begins a new week.
    expect(sunday.map((b) => b.overtimePence)).toEqual([300, 300]);
  });

  it('a week that spans the period start counts the earlier shifts but returns only in-period shifts', () => {
    const shifts = [MON, TUE, WED, THU, FRI].map((d) => day(d));
    const out = calculateShifts(shifts, job, [weekly39], bankHolidays, { start: WED, end: '2026-11-10' });
    expect(out.map((b) => [b.shiftId, b.overtimePence])).toEqual([
      ['s-2026-11-04', 0],
      ['s-2026-11-05', 0],
      ['s-2026-11-06', 5100],
    ]);
  });

  it('shifts after the period end are not returned', () => {
    const out = calculateShifts([day(SUN), day('2026-11-09')], job, [weekly39], bankHolidays, week);
    expect(out.map((b) => b.shiftId)).toEqual(['s-2026-11-08']);
  });
});

describe('calculateShifts: period overtime', () => {
  it('counts only in-period shifts towards the period threshold', () => {
    const shifts = [MON, TUE, WED, THU, FRI].map((d) => day(d));
    const out = calculateShifts(shifts, job, [period25], bankHolidays, { start: WED, end: '2026-11-10' });
    // Wed + Thu = 19h; Friday crosses 25h after 6 paid hours: last 3.5h (210 min) at x2.
    expect(out.map((b) => b.overtimePence)).toEqual([0, 0, 4200]);
    expect(row(out[2])).toEqual([
      ['2026-11-06T08:00:00.000Z', '2026-11-06T14:30:00.000Z', 390, 30, 360, false, undefined],
      ['2026-11-06T14:30:00.000Z', '2026-11-06T18:00:00.000Z', 210, 0, 210, true, 'period'],
    ]);
    out.forEach(expectConsistent);
  });

  it('daily + weekly + period on one shift: each minute is paid under its highest OT rule only', () => {
    const shifts = [MON, TUE, WED, THU, FRI].map((d) => day(d));
    const out = calculateShifts(shifts, job, [daily8, weekly39, period25], bankHolidays, {
      start: WED,
      end: '2026-11-10',
    });
    const fri = out[2];
    // Weekly marks the last 510 min (x1.5), period the last 210 (x2), daily the last 90 (x1.5).
    expect(row(fri)).toEqual([
      ['2026-11-06T08:00:00.000Z', '2026-11-06T09:30:00.000Z', 90, 30, 60, false, undefined],
      ['2026-11-06T09:30:00.000Z', '2026-11-06T14:30:00.000Z', 300, 0, 300, true, 'weekly'],
      ['2026-11-06T14:30:00.000Z', '2026-11-06T16:30:00.000Z', 120, 0, 120, true, 'period'],
      ['2026-11-06T16:30:00.000Z', '2026-11-06T18:00:00.000Z', 90, 0, 90, true, 'period'],
    ]);
    expect(fri.segments.map((s) => s.overtimePence)).toEqual([0, 3000, 2400, 1800]);
    // Wed and Thu only have daily OT: last 90 min at x1.5 = 900.
    expect(out.map((b) => b.overtimePence)).toEqual([900, 900, 7200]);
    out.forEach(expectConsistent);
  });
});

describe('calculateShifts: status', () => {
  it('sick and holiday hours do not push a later shift into overtime', () => {
    const rule = { ...weekly39, thresholdHours: 15 };
    for (const status of ['sick', 'holiday', 'cancelled'] as const) {
      const out = calculateShifts([day(MON, status), day(TUE)], job, [rule], bankHolidays, week);
      expect(out[1].overtimePence).toBe(0);
    }
    const worked = calculateShifts([day(MON, 'planned'), day(TUE)], job, [rule], bankHolidays, week);
    expect(worked[1].overtimePence).toBe(2400); // 19h - 15h = 4h x 600
  });

  it('a sick shift past the threshold is still paid at base only', () => {
    const rule = { ...weekly39, thresholdHours: 5 };
    const out = calculateShifts([day(MON), day(TUE, 'sick')], job, [rule], bankHolidays, week);
    expect(out[1].segments.map((s) => [s.isOvertime, s.totalPence])).toEqual([[false, 11400]]);
  });

  it('overtimeFlag makes the whole shift OT under the highest OT rule; it still counts towards thresholds', () => {
    const flagged = { ...day(MON), overtimeFlag: true };
    const rule = { ...weekly39, thresholdHours: 15 };
    const out = calculateShifts([flagged, day(TUE)], job, [rule, period25], bankHolidays, week);
    expect(row(out[0])).toEqual([
      ['2026-11-02T08:00:00.000Z', '2026-11-02T18:00:00.000Z', 600, 30, 570, true, 'period'],
    ]);
    expect(out[0].overtimePence).toBe(11400);
    // Tuesday: weekly 19h - 15h = last 4h at x1.5 (period 25h not reached).
    expect(out[1].overtimePence).toBe(2400);
  });

  it('ignores rules of another job', () => {
    const other = { ...weekly39, jobId: 'j2', thresholdHours: 0 };
    const out = calculateShifts([day(MON)], job, [other], bankHolidays, week);
    expect(out[0].overtimePence).toBe(0);
  });
});
