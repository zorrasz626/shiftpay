import snapshot from '../../config/bankHolidays.json';
import { createBankHolidayLookup } from '../bankHolidays';
import { calculateShift, calculateShifts } from '../shiftPay';
import { localToInstant } from '../time';
import type {
  BankHolidayData,
  Job,
  LocalDate,
  PremiumRule,
  Shift,
  ShiftBreakdown,
  WallClockTime,
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

const base = { jobId: 'j1', priority: 0 };
const night: PremiumRule = {
  ...base,
  id: 'night',
  name: 'Nights',
  stacking: 'highest_only',
  multiplier: 1.25,
  type: 'time_band',
  startTime: '22:00',
  endTime: '06:00',
};
const bh: PremiumRule = { ...base, id: 'bh', name: 'Bank holiday', stacking: 'highest_only', multiplier: 2, type: 'bank_holiday' };
const sunday: PremiumRule = {
  ...base,
  id: 'sunday',
  name: 'Sundays',
  stacking: 'stack',
  multiplier: 1.1,
  type: 'day_of_week',
  daysOfWeek: [0],
};
const overtime: PremiumRule = {
  ...base,
  id: 'ot',
  name: 'Daily OT',
  stacking: 'stack',
  multiplier: 1.5,
  type: 'overtime_daily',
  thresholdHours: 0,
};

function shiftOf(
  startDate: LocalDate,
  startTime: WallClockTime,
  endDate: LocalDate,
  endTime: WallClockTime,
  unpaidBreakMinutes = 0,
): Shift {
  return {
    id: 'shift-1',
    jobId: 'j1',
    date: startDate,
    start: localToInstant(startDate, startTime),
    end: localToInstant(endDate, endTime),
    unpaidBreakMinutes,
    source: 'manual',
    status: 'worked',
    overtimeFlag: false,
  };
}

function expectConsistent(b: ShiftBreakdown) {
  const sum = (key: 'basePence' | 'premiumPence' | 'overtimePence' | 'totalPence') =>
    b.segments.reduce((acc, s) => acc + s[key], 0);
  expect(b.basePence).toBe(sum('basePence'));
  expect(b.premiumPence).toBe(sum('premiumPence'));
  expect(b.overtimePence).toBe(sum('overtimePence'));
  expect(b.totalGrossPence).toBe(sum('totalPence'));
  expect(b.totalGrossPence).toBe(b.basePence + b.premiumPence + b.overtimePence);
  for (const p of [b.basePence, b.premiumPence, b.overtimePence, b.totalGrossPence]) {
    expect(Number.isInteger(p)).toBe(true);
  }
}

describe('calculateShift', () => {
  it('bank holiday x2 applies only from 00:00 on 25 Dec 2026 (1.4 scenario)', () => {
    const b = calculateShift(shiftOf('2026-12-24', '20:00', '2026-12-25', '04:00'), job, [bh], bankHolidays);
    expect(b.segments.map((s) => [s.localDate, s.isBankHoliday, s.ruleAmounts, s.totalPence])).toEqual([
      ['2026-12-24', false, [], 4800],
      ['2026-12-25', true, [{ ruleId: 'bh', pence: 4800 }], 9600],
    ]);
    expect([b.shiftId, b.basePence, b.premiumPence, b.overtimePence, b.totalGrossPence, b.paidHours]).toEqual([
      'shift-1',
      9600,
      4800,
      0,
      14400,
      8,
    ]);
    expectConsistent(b);
  });

  it('segments at the job time bands: night vs bank holiday, highest only', () => {
    const b = calculateShift(shiftOf('2026-12-24', '20:00', '2026-12-25', '04:00'), job, [night, bh], bankHolidays);
    expect(b.segments.map((s) => [s.start, s.ruleAmounts])).toEqual([
      ['2026-12-24T20:00:00.000Z', []],
      ['2026-12-24T22:00:00.000Z', [{ ruleId: 'night', pence: 600 }]],
      ['2026-12-25T00:00:00.000Z', [{ ruleId: 'bh', pence: 4800 }]],
    ]);
    expectConsistent(b);
  });

  it('uses the job bank-holiday region', () => {
    // 2 Jan 2026 is a bank holiday in Scotland only.
    const shift = shiftOf('2026-01-02', '09:00', '2026-01-02', '10:00');
    const ew = calculateShift(shift, job, [bh], bankHolidays);
    const sc = calculateShift(shift, { ...job, bankHolidayRegion: 'scotland' }, [bh], bankHolidays);
    expect([ew.premiumPence, sc.premiumPence]).toEqual([0, 1200]);
  });

  it('paidHours is paid minutes / 60 after the break; daily OT from 0h makes every paid minute OT', () => {
    // Sun 8 Nov 2026 09:00-16:45 with a 30 min break: 435 paid min = 7.25h.
    const shift = shiftOf('2026-11-08', '09:00', '2026-11-08', '16:45', 30);
    const plain = calculateShift(shift, job, [sunday], bankHolidays);
    expect([plain.paidHours, plain.basePence, plain.premiumPence, plain.totalGrossPence]).toEqual([7.25, 8700, 870, 9570]);
    // highest: OT uplift 600/h beats Sunday 120/h, so the Sunday premium is dropped.
    const b = calculateShift(shift, job, [sunday, overtime], bankHolidays);
    expect(b.paidHours).toBe(7.25);
    expect([b.basePence, b.premiumPence, b.overtimePence, b.totalGrossPence]).toEqual([8700, 0, 4350, 13050]);
    expect(b.segments.map((s) => [s.isOvertime, s.overtimeRuleId, s.ruleAmounts])).toEqual([[true, 'ot', []]]);
    expectConsistent(b);
  });

  it('rounds per segment and never re-rounds the totals (x1.333, odd minutes)', () => {
    const odd: PremiumRule = { ...night, id: 'odd', stacking: 'stack', multiplier: 1.333 };
    const b = calculateShift(
      shiftOf('2026-11-04', '21:13', '2026-11-05', '00:47'),
      { ...job, baseRatePence: 1137 },
      [odd],
      bankHolidays,
    );
    expect(b.segments.map((s) => [s.paidMinutes, s.basePence, s.premiumPence])).toEqual([
      [47, 891, 0], // 1137 x 47/60 = 890.65
      [120, 2274, 757], // 2274 x 0.333 = 757.24
      [47, 891, 297], // 890.65 x 0.333 = 296.59
    ]);
    expect(b.totalGrossPence).toBe(891 + 2274 + 757 + 891 + 297);
    expectConsistent(b);
  });

  it('daily OT: paid minutes beyond the threshold, split at the instant it is crossed', () => {
    // Wed 4 Nov 2026 08:00-18:00, 30 min break: 570 paid; 8h threshold -> last 90 min.
    const daily8: PremiumRule = { ...overtime, thresholdHours: 8 };
    const b = calculateShift(shiftOf('2026-11-04', '08:00', '2026-11-04', '18:00', 30), job, [daily8], bankHolidays);
    expect(b.segments.map((s) => [s.start, s.end, s.minutes, s.breakMinutes, s.paidMinutes, s.isOvertime])).toEqual([
      ['2026-11-04T08:00:00.000Z', '2026-11-04T16:30:00.000Z', 510, 30, 480, false],
      ['2026-11-04T16:30:00.000Z', '2026-11-04T18:00:00.000Z', 90, 0, 90, true],
    ]);
    expect([b.basePence, b.overtimePence, b.totalGrossPence, b.paidHours]).toEqual([11400, 900, 12300, 9.5]);
    // Under the threshold: no split, no OT; totals equal the no-OT result.
    const under = calculateShift(shiftOf('2026-11-04', '08:00', '2026-11-04', '16:00'), job, [daily8], bankHolidays);
    expect([under.segments.length, under.overtimePence, under.totalGrossPence]).toEqual([1, 0, 9600]);
    expectConsistent(b);
  });

  it('calculateShift ignores weekly and period rules (they need several shifts)', () => {
    const weekly: PremiumRule = { ...base, id: 'w', name: 'W', stacking: 'stack', multiplier: 1.5, type: 'overtime_weekly', thresholdHours: 0 };
    const period: PremiumRule = { ...base, id: 'p', name: 'P', stacking: 'stack', multiplier: 1.5, type: 'overtime_period', thresholdHours: 0 };
    const b = calculateShift(shiftOf('2026-11-04', '08:00', '2026-11-04', '10:00'), job, [weekly, period], bankHolidays);
    expect(b.overtimePence).toBe(0);
  });

  describe('night OT hour under each overtimePremiumMode (night x1.25, OT x1.5)', () => {
    // Wed 4 Nov 22:00 - Thu 06:00, all nights; daily 7h -> the 05:00-06:00 hour is OT.
    const shift = shiftOf('2026-11-04', '22:00', '2026-11-05', '06:00');
    const daily7: PremiumRule = { ...overtime, thresholdHours: 7 };
    const otHour = (mode: Job['overtimePremiumMode']) => {
      const b = calculateShift(shift, { ...job, overtimePremiumMode: mode }, [night, daily7], bankHolidays);
      expectConsistent(b);
      expect(b.segments.map((s) => [s.start, s.isOvertime])).toEqual([
        ['2026-11-04T22:00:00.000Z', false],
        ['2026-11-05T00:00:00.000Z', false],
        ['2026-11-05T05:00:00.000Z', true],
      ]);
      const s = b.segments[2];
      return [s.basePence, s.premiumPence, s.overtimePence, s.totalPence, s.overtimeRuleId];
    };

    it('replace = x1.5', () => expect(otHour('replace')).toEqual([1200, 0, 600, 1800, 'ot']));
    it('highest = x1.5 (OT 600/h beats night 300/h)', () => expect(otHour('highest')).toEqual([1200, 0, 600, 1800, 'ot']));
    it('stack = x1.75', () => expect(otHour('stack')).toEqual([1200, 300, 600, 2100, 'ot']));
  });

  it('highest: the premium wins when it is higher (BH x2 vs OT x1.5); the hour is still OT', () => {
    const daily8: PremiumRule = { ...overtime, thresholdHours: 8 };
    const b = calculateShift(shiftOf('2026-12-25', '09:00', '2026-12-25', '18:00'), job, [bh, daily8], bankHolidays);
    const last = b.segments[1];
    expect([last.start, last.isOvertime, last.overtimeRuleId, last.ruleAmounts, last.overtimePence, last.totalPence]).toEqual([
      '2026-12-25T17:00:00.000Z',
      true,
      'ot',
      [{ ruleId: 'bh', pence: 1200 }],
      0,
      2400,
    ]);
    expectConsistent(b);
  });

  it('highest with flat amounts: flat OT +500/h vs flat night +400/h and +600/h', () => {
    const flatNight: PremiumRule = {
      ...base,
      id: 'fn',
      name: 'Flat nights',
      stacking: 'highest_only',
      flatAddPencePerHour: 400,
      type: 'time_band',
      startTime: '22:00',
      endTime: '06:00',
    };
    const flatOt: PremiumRule = {
      ...base,
      id: 'fo',
      name: 'Flat OT',
      stacking: 'highest_only',
      flatAddPencePerHour: 500,
      type: 'overtime_daily',
      thresholdHours: 0,
    };
    const shift = shiftOf('2026-11-04', '23:00', '2026-11-04', '23:30');
    const b = calculateShift(shift, job, [flatNight, flatOt], bankHolidays);
    expect([b.premiumPence, b.overtimePence, b.totalGrossPence]).toEqual([0, 250, 850]);
    const lower = calculateShift(shift, job, [{ ...flatNight, flatAddPencePerHour: 600 }, flatOt], bankHolidays);
    expect([lower.premiumPence, lower.overtimePence, lower.totalGrossPence]).toEqual([300, 0, 900]);
  });

  it('OT rules do not stack: the highest uplift wins, a tie goes to priority, then the smaller id', () => {
    const shift = shiftOf('2026-11-04', '08:00', '2026-11-04', '09:00');
    const a: PremiumRule = { ...overtime, id: 'a' };
    const b: PremiumRule = { ...overtime, id: 'b' };
    const big: PremiumRule = { ...overtime, id: 'big', multiplier: 2 };
    const pick = (rules: PremiumRule[]) => {
      const out = calculateShift(shift, job, rules, bankHolidays);
      return [out.segments.map((s) => s.overtimeRuleId), out.overtimePence];
    };
    expect(pick([a, big, b])).toEqual([['big'], 1200]);
    expect(pick([big, a])).toEqual([['big'], 1200]);
    expect(pick([b, a])).toEqual([['a'], 600]);
    expect(pick([a, b])).toEqual([['a'], 600]);
    expect(pick([a, { ...b, priority: 1 }])).toEqual([['b'], 600]);
    expect(pick([{ ...b, priority: 1 }, a])).toEqual([['b'], 600]);
  });

  describe('status', () => {
    const shift = shiftOf('2026-12-24', '20:00', '2026-12-25', '04:00');

    it('cancelled: no segments, all totals 0', () => {
      const b = calculateShift({ ...shift, status: 'cancelled' }, job, [night, bh, overtime], bankHolidays);
      expect(b).toEqual({
        shiftId: 'shift-1',
        segments: [],
        basePence: 0,
        premiumPence: 0,
        overtimePence: 0,
        totalGrossPence: 0,
        paidHours: 0,
      });
    });

    it.each(['sick', 'holiday'] as const)('%s: base rate only, no premiums, no OT, even with overtimeFlag', (status) => {
      const b = calculateShift({ ...shift, status, overtimeFlag: true }, job, [night, bh, overtime], bankHolidays);
      expect([b.basePence, b.premiumPence, b.overtimePence, b.totalGrossPence, b.paidHours]).toEqual([9600, 0, 0, 9600, 8]);
      expect(b.segments.every((s) => !s.isOvertime && s.ruleAmounts.length === 0)).toBe(true);
      expectConsistent(b);
    });

    it('planned is paid like worked', () => {
      const planned = calculateShift({ ...shift, status: 'planned' }, job, [night, bh], bankHolidays);
      const worked = calculateShift(shift, job, [night, bh], bankHolidays);
      expect(planned).toEqual(worked);
    });
  });

  it('overtimeFlag: every paid minute is OT under the highest OT rule of any type', () => {
    const shift = { ...shiftOf('2026-11-04', '08:00', '2026-11-04', '10:00', 30), overtimeFlag: true };
    const daily12: PremiumRule = { ...overtime, thresholdHours: 12 };
    const weekly: PremiumRule = { ...base, id: 'w', name: 'W', stacking: 'stack', multiplier: 2, type: 'overtime_weekly', thresholdHours: 39 };
    const b = calculateShift(shift, job, [daily12, weekly], bankHolidays);
    expect(b.segments.map((s) => [s.paidMinutes, s.isOvertime, s.overtimeRuleId, s.overtimePence])).toEqual([
      [90, true, 'w', 1800],
    ]);
    // With no OT rule the flag changes nothing.
    const none = calculateShift(shift, job, [night], bankHolidays);
    expect([none.overtimePence, none.totalGrossPence, none.segments[0].isOvertime]).toEqual([0, 1800, false]);
  });

  it('ignores rules of another job', () => {
    const otherNight: PremiumRule = { ...night, jobId: 'j2' };
    const otherOt: PremiumRule = { ...overtime, jobId: 'j2' };
    const b = calculateShift(shiftOf('2026-11-04', '22:00', '2026-11-05', '02:00'), job, [otherNight, otherOt], bankHolidays);
    expect([b.segments.length, b.premiumPence, b.overtimePence, b.totalGrossPence]).toEqual([2, 0, 0, 4800]);
  });
});

describe('calculateShifts', () => {
  it("ignores shifts of another job: they count to no threshold and are not returned", () => {
    const weekly8: PremiumRule = { ...base, id: 'w8', name: 'Weekly OT', stacking: 'stack', multiplier: 1.5, type: 'overtime_weekly', thresholdHours: 8 };
    const other: Shift = { ...shiftOf('2026-11-02', '08:00', '2026-11-02', '18:00'), id: 'other', jobId: 'j2' };
    const mine: Shift = { ...shiftOf('2026-11-03', '08:00', '2026-11-03', '16:00'), id: 'mine' };
    const out = calculateShifts([other, mine], job, [weekly8], bankHolidays, { start: '2026-11-02', end: '2026-11-08' });
    expect(out.map((b) => [b.shiftId, b.overtimePence, b.totalGrossPence])).toEqual([['mine', 0, 9600]]);
  });
});
