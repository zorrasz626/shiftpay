import snapshot from '../../config/bankHolidays.json';
import { createBankHolidayLookup } from '../bankHolidays';
import { applyPremiums } from '../premiums';
import { segmentShift } from '../segment';
import { addMinutes, localToInstant } from '../time';
import type {
  BankHolidayData,
  BankHolidayRule,
  DayOfWeek,
  DayOfWeekRule,
  Job,
  LocalDate,
  PremiumRate,
  PremiumRule,
  Segment,
  SegmentSlice,
  Shift,
  StackingMode,
  TimeBandRule,
  WallClockTime,
} from '../types';

const bankHolidays = createBankHolidayLookup(snapshot as BankHolidayData);

function jobOf(baseRatePence: number): Job {
  return {
    id: 'j1',
    name: 'Test job',
    baseRatePence,
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
}

const common = (id: string, stacking: StackingMode, priority: number) => ({
  id,
  jobId: 'j1',
  name: id,
  stacking,
  priority,
});

function nights(
  stacking: StackingMode,
  rate: PremiumRate = { multiplier: 1.25 },
  startTime: WallClockTime = '22:00',
  endTime: WallClockTime = '06:00',
  id = 'night',
  priority = 0,
): TimeBandRule {
  return { ...common(id, stacking, priority), ...rate, type: 'time_band', startTime, endTime };
}

function days(
  stacking: StackingMode,
  daysOfWeek: DayOfWeek[],
  rate: PremiumRate = { multiplier: 1.5 },
  id = 'sunday',
  priority = 0,
): DayOfWeekRule {
  return { ...common(id, stacking, priority), ...rate, type: 'day_of_week', daysOfWeek };
}

function bankHoliday(stacking: StackingMode, rate: PremiumRate = { multiplier: 2 }): BankHolidayRule {
  return { ...common('bh', stacking, 0), ...rate, type: 'bank_holiday' };
}

/** A single hand-built slice (no segmentation) at a given local start. */
function sliceAt(
  date: LocalDate,
  time: WallClockTime,
  paidMinutes: number,
  dayOfWeek: DayOfWeek,
  isBankHoliday = false,
): SegmentSlice {
  const start = localToInstant(date, time);
  const end = addMinutes(start, paidMinutes);
  return { start, end, localDate: date, dayOfWeek, minutes: paidMinutes, breakMinutes: 0, paidMinutes, isBankHoliday };
}

function shiftOf(startDate: LocalDate, startTime: WallClockTime, endDate: LocalDate, endTime: WallClockTime): Shift {
  return {
    id: 's1',
    jobId: 'j1',
    date: startDate,
    start: localToInstant(startDate, startTime),
    end: localToInstant(endDate, endTime),
    unpaidBreakMinutes: 0,
    source: 'manual',
    status: 'planned',
    overtimeFlag: false,
  };
}

/** Sat 7 Nov 2026 22:00 -> Sun 8 Nov 06:00 (GMT, no changeover). */
function satNight(rules: PremiumRule[], base = 1200): Segment[] {
  const timeBands = rules.filter((r): r is TimeBandRule => r.type === 'time_band');
  const slices = segmentShift(shiftOf('2026-11-07', '22:00', '2026-11-08', '06:00'), {
    timeBands,
    region: 'england-and-wales',
    bankHolidays,
  });
  return applyPremiums(slices, jobOf(base), rules);
}

const one = (slice: SegmentSlice, rules: PremiumRule[], base = 1200): Segment =>
  applyPremiums([slice], jobOf(base), rules)[0];

describe('applyPremiums: stacking (SPEC §5 item 3)', () => {
  it('night x1.25 + Sunday x1.5, both highest_only: x1.5 only on Sunday', () => {
    const segs = satNight([nights('highest_only'), days('highest_only', [0])]);
    expect(segs.map((s) => [s.localDate, s.paidMinutes, s.basePence, s.ruleAmounts, s.totalPence])).toEqual([
      ['2026-11-07', 120, 2400, [{ ruleId: 'night', pence: 600 }], 3000],
      ['2026-11-08', 360, 7200, [{ ruleId: 'sunday', pence: 3600 }], 10800], // 7200 x 1.5
    ]);
  });

  it('both stack: 1 + 0.25 + 0.5 = x1.75 on Sunday', () => {
    const segs = satNight([nights('stack'), days('stack', [0])]);
    expect(segs[1].ruleAmounts).toEqual([
      { ruleId: 'night', pence: 1800 },
      { ruleId: 'sunday', pence: 3600 },
    ]);
    expect(segs[1].totalPence).toBe(12600); // 7200 x 1.75
  });

  it('mixed: max of highest_only uplifts plus the sum of stacked uplifts', () => {
    const weekend = days('highest_only', [0, 6], { flatAddPencePerHour: 200 }, 'weekend');
    const segs = satNight([nights('stack'), days('highest_only', [0]), weekend]);
    // Sat: weekend (200/h) is the only highest_only match; night stacks on top.
    expect(segs[0].ruleAmounts).toEqual([
      { ruleId: 'night', pence: 600 },
      { ruleId: 'weekend', pence: 400 },
    ]);
    // Sun: Sunday (600/h) beats weekend (200/h); night stacks on top.
    expect(segs[1].ruleAmounts).toEqual([
      { ruleId: 'night', pence: 1800 },
      { ruleId: 'sunday', pence: 3600 },
    ]);
    expect(segs[1].premiumPence).toBe(5400);
  });

  it('a night across Sat -> Sun shows the Sunday rule only after midnight', () => {
    const segs = satNight([nights('highest_only'), days('stack', [0])]);
    expect(segs.map((s) => s.ruleAmounts.map((r) => r.ruleId))).toEqual([['night'], ['night', 'sunday']]);
  });

  it('no matching rules: base pay only', () => {
    const seg = one(sliceAt('2026-11-04', '10:00', 60, 3), [nights('stack'), days('stack', [0])]);
    expect([seg.ruleAmounts, seg.basePence, seg.premiumPence, seg.totalPence]).toEqual([[], 1200, 0, 1200]);
  });
});

describe('applyPremiums: flat add vs multiplier (pence per hour)', () => {
  // Base 1200p/h: x1.125 -> 150p/h uplift.
  const mult = (priority: number, id = 'mult') => days('highest_only', [3], { multiplier: 1.125 }, id, priority);
  const flat = (pence: number, priority: number, id = 'flat') =>
    days('highest_only', [3], { flatAddPencePerHour: pence }, id, priority);
  const wed = sliceAt('2026-11-04', '10:00', 120, 3);
  const winner = (rules: PremiumRule[], slice = wed, base = 1200) => one(slice, rules, base).ruleAmounts;

  it('the larger uplift per hour wins regardless of priority', () => {
    expect(winner([mult(9), flat(160, 0)])).toEqual([{ ruleId: 'flat', pence: 320 }]);
    expect(winner([mult(0), flat(140, 9)])).toEqual([{ ruleId: 'mult', pence: 300 }]);
  });

  it('a tie goes to the higher priority', () => {
    expect(winner([mult(1), flat(150, 2)])).toEqual([{ ruleId: 'flat', pence: 300 }]);
    expect(winner([flat(150, 1), mult(2)])).toEqual([{ ruleId: 'mult', pence: 300 }]);
  });

  it('a tie on priority goes to the smaller rule id, whatever the input order', () => {
    expect(winner([mult(0, 'b'), flat(150, 0, 'a')])).toEqual([{ ruleId: 'a', pence: 300 }]);
    expect(winner([flat(150, 0, 'a'), mult(0, 'b')])).toEqual([{ ruleId: 'a', pence: 300 }]);
  });

  it('float noise in (m - 1) does not break a tie: 1000 x (1.1 - 1) ties with +100p/h', () => {
    const rules = [
      days('highest_only', [3], { multiplier: 1.1 }, 'mult', 0),
      days('highest_only', [3], { flatAddPencePerHour: 100 }, 'flat', 1),
    ];
    expect(winner(rules, sliceAt('2026-11-04', '10:00', 60, 3), 1000)).toEqual([{ ruleId: 'flat', pence: 100 }]);
  });

  it('a 0-paid-minute segment still picks a winner, with 0 pence', () => {
    expect(winner([mult(0), flat(160, 0)], sliceAt('2026-11-04', '10:00', 0, 3))).toEqual([
      { ruleId: 'flat', pence: 0 },
    ]);
  });
});

describe('applyPremiums: rule matching', () => {
  const ids = (slice: SegmentSlice, rules: PremiumRule[]) => one(slice, rules).ruleAmounts.map((r) => r.ruleId);

  it('time band 09:00-17:00 includes its start and excludes its end', () => {
    const band = nights('stack', { multiplier: 1.1 }, '09:00', '17:00', 'day');
    expect(ids(sliceAt('2026-11-04', '08:59', 1, 3), [band])).toEqual([]);
    expect(ids(sliceAt('2026-11-04', '09:00', 60, 3), [band])).toEqual(['day']);
    expect(ids(sliceAt('2026-11-04', '16:59', 1, 3), [band])).toEqual(['day']);
    expect(ids(sliceAt('2026-11-04', '17:00', 60, 3), [band])).toEqual([]);
  });

  it('time band 22:00-06:00 crosses midnight', () => {
    const band = nights('stack');
    expect(ids(sliceAt('2026-11-04', '21:59', 1, 3), [band])).toEqual([]);
    expect(ids(sliceAt('2026-11-04', '22:00', 60, 3), [band])).toEqual(['night']);
    expect(ids(sliceAt('2026-11-05', '00:00', 60, 4), [band])).toEqual(['night']);
    expect(ids(sliceAt('2026-11-05', '05:59', 1, 4), [band])).toEqual(['night']);
    expect(ids(sliceAt('2026-11-05', '06:00', 60, 4), [band])).toEqual([]);
  });

  it('time band with start == end covers the whole day', () => {
    const band = nights('stack', { multiplier: 1.1 }, '00:00', '00:00', 'allday');
    expect(ids(sliceAt('2026-11-04', '00:00', 60, 3), [band])).toEqual(['allday']);
    expect(ids(sliceAt('2026-11-04', '13:37', 60, 3), [band])).toEqual(['allday']);
  });

  it('day of week matches the slice dayOfWeek', () => {
    const rule = days('stack', [1, 5]);
    expect(ids(sliceAt('2026-11-02', '10:00', 60, 1), [rule])).toEqual(['sunday']);
    expect(ids(sliceAt('2026-11-03', '10:00', 60, 2), [rule])).toEqual([]);
  });

  it('bank holiday matches isBankHoliday', () => {
    const rule = bankHoliday('highest_only');
    expect(ids(sliceAt('2026-12-25', '10:00', 60, 5, true), [rule])).toEqual(['bh']);
    expect(ids(sliceAt('2026-12-24', '10:00', 60, 4, false), [rule])).toEqual([]);
  });

  it('ignores overtime rule types', () => {
    const ot: PremiumRule = { ...common('ot', 'stack', 0), multiplier: 1.5, type: 'overtime_daily', thresholdHours: 0 };
    const seg = one(sliceAt('2026-11-04', '10:00', 60, 3), [ot]);
    expect([seg.ruleAmounts, seg.isOvertime, seg.overtimePence, seg.totalPence]).toEqual([[], false, 0, 1200]);
  });
});

describe('applyPremiums: pence and rounding', () => {
  it('rounds each rule amount once: base 1137p, 37 min, x1.333', () => {
    // base 701.15 -> 701; uplift 701.15 x 0.333 = 233.48 -> 233. (Rounding 701.15 x 1.333 = 934.63 would give 935.)
    const seg = one(sliceAt('2026-11-04', '10:00', 37, 3), [days('stack', [3], { multiplier: 1.333 })], 1137);
    expect([seg.basePence, seg.ruleAmounts, seg.premiumPence, seg.totalPence]).toEqual([
      701,
      [{ ruleId: 'sunday', pence: 233 }],
      233,
      934,
    ]);
  });

  it('x1.1 on 1000p/h for 60 min is exactly 100p (float noise cleared)', () => {
    const seg = one(sliceAt('2026-11-04', '10:00', 60, 3), [days('stack', [3], { multiplier: 1.1 })], 1000);
    expect(seg.ruleAmounts).toEqual([{ ruleId: 'sunday', pence: 100 }]);
  });

  it('x1.15 on 1030p/h for 60 min: 154.5 (computed 154.4999...) rounds up to 155', () => {
    const seg = one(sliceAt('2026-11-04', '10:00', 60, 3), [days('stack', [3], { multiplier: 1.15 })], 1030);
    expect(seg.ruleAmounts).toEqual([{ ruleId: 'sunday', pence: 155 }]);
  });

  it('keeps the slice fields and adds integer pence that add up', () => {
    const segs = satNight([
      nights('stack', { multiplier: 1.333 }),
      days('stack', [0], { multiplier: 1.1 }),
      days('highest_only', [0, 6], { flatAddPencePerHour: 37 }, 'weekend'),
    ], 1137);
    for (const s of segs) {
      expect(s).toMatchObject({ isOvertime: false, overtimePence: 0 });
      expect(typeof s.dayOfWeek).toBe('number');
      const amounts = s.ruleAmounts.map((r) => r.pence);
      for (const p of [s.basePence, s.premiumPence, s.overtimePence, s.totalPence, ...amounts]) {
        expect(Number.isInteger(p)).toBe(true);
      }
      expect(s.premiumPence).toBe(amounts.reduce((a, b) => a + b, 0));
      expect(s.totalPence).toBe(s.basePence + s.premiumPence + s.overtimePence);
    }
  });
});
