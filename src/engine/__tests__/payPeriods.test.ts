import snapshot from '../../config/bankHolidays.json';
import { createBankHolidayLookup } from '../bankHolidays';
import { aggregatePeriod, payDate, periodContaining, periodsBetween } from '../payPeriods';
import type { DateRange } from '../shiftPay';
import { addLocalDays, localToInstant } from '../time';
import type { BankHolidayData, Job, LocalDate, PayFrequency, PremiumRule, Shift, WallClockTime } from '../types';

const bankHolidays = createBankHolidayLookup(snapshot as BankHolidayData);

/** 5 Jan 2026 is a Monday. */
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

function jobWith(payFrequency: PayFrequency, extra: Partial<Job> = {}): Job {
  return { ...job, payFrequency, ...extra };
}

const range = (start: LocalDate, end: LocalDate): DateRange => ({ start, end });

describe('periodContaining: fixed-length periods', () => {
  it('weekly: 7 days from the anchor, stepping forwards and backwards', () => {
    const weekly = jobWith('weekly');
    expect(periodContaining('2026-01-05', weekly)).toEqual(range('2026-01-05', '2026-01-11'));
    expect(periodContaining('2026-01-11', weekly)).toEqual(range('2026-01-05', '2026-01-11'));
    expect(periodContaining('2026-01-12', weekly)).toEqual(range('2026-01-12', '2026-01-18'));
    // Before the anchor.
    expect(periodContaining('2026-01-04', weekly)).toEqual(range('2025-12-29', '2026-01-04'));
    expect(periodContaining('2025-06-01', weekly)).toEqual(range('2025-05-26', '2025-06-01'));
    // Across the GMT -> BST change (29 Mar 2026).
    expect(periodContaining('2026-03-29', weekly)).toEqual(range('2026-03-23', '2026-03-29'));
    expect(periodContaining('2026-03-30', weekly)).toEqual(range('2026-03-30', '2026-04-05'));
  });

  it('fortnightly: 14 days', () => {
    const fortnightly = jobWith('fortnightly');
    expect(periodContaining('2026-01-18', fortnightly)).toEqual(range('2026-01-05', '2026-01-18'));
    expect(periodContaining('2026-01-19', fortnightly)).toEqual(range('2026-01-19', '2026-02-01'));
    expect(periodContaining('2026-01-04', fortnightly)).toEqual(range('2025-12-22', '2026-01-04'));
  });

  it('four_weekly: 28 days', () => {
    const fourWeekly = jobWith('four_weekly');
    expect(periodContaining('2026-02-01', fourWeekly)).toEqual(range('2026-01-05', '2026-02-01'));
    expect(periodContaining('2026-02-02', fourWeekly)).toEqual(range('2026-02-02', '2026-03-01'));
    expect(periodContaining('2025-12-31', fourWeekly)).toEqual(range('2025-12-08', '2026-01-04'));
  });

  it('rejects an invalid date', () => {
    expect(() => periodContaining('2026-02-30', jobWith('weekly'))).toThrow('Invalid LocalDate');
    expect(() => periodContaining('2026-02-30', jobWith('monthly'))).toThrow('Invalid LocalDate');
  });
});

describe('periodContaining: monthly (anchor ignored, cut-off clamped)', () => {
  it('cut-off 31: calendar months, February in non-leap and leap years', () => {
    const m31 = jobWith('monthly', { periodCutoffDay: 31 });
    expect(periodContaining('2026-02-10', m31)).toEqual(range('2026-02-01', '2026-02-28'));
    expect(periodContaining('2028-02-29', m31)).toEqual(range('2028-02-01', '2028-02-29'));
    expect(periodContaining('2026-03-31', m31)).toEqual(range('2026-03-01', '2026-03-31'));
    expect(periodContaining('2026-12-31', m31)).toEqual(range('2026-12-01', '2026-12-31'));
    expect(periodContaining('2027-01-01', m31)).toEqual(range('2027-01-01', '2027-01-31'));
  });

  it('cut-off 30: 31 Jan-28 Feb, 1 Mar-30 Mar, leap 31 Jan-29 Feb', () => {
    const m30 = jobWith('monthly', { periodCutoffDay: 30 });
    expect(periodContaining('2026-01-31', m30)).toEqual(range('2026-01-31', '2026-02-28'));
    expect(periodContaining('2026-02-01', m30)).toEqual(range('2026-01-31', '2026-02-28'));
    expect(periodContaining('2026-03-01', m30)).toEqual(range('2026-03-01', '2026-03-30'));
    expect(periodContaining('2026-03-31', m30)).toEqual(range('2026-03-31', '2026-04-30'));
    expect(periodContaining('2028-02-29', m30)).toEqual(range('2028-01-31', '2028-02-29'));
    expect(periodContaining('2028-03-01', m30)).toEqual(range('2028-03-01', '2028-03-30'));
  });

  it('cut-off 15: 16th to 15th, across a year end', () => {
    const m15 = jobWith('monthly', { periodCutoffDay: 15 });
    expect(periodContaining('2026-01-16', m15)).toEqual(range('2026-01-16', '2026-02-15'));
    expect(periodContaining('2026-02-15', m15)).toEqual(range('2026-01-16', '2026-02-15'));
    expect(periodContaining('2026-01-01', m15)).toEqual(range('2025-12-16', '2026-01-15'));
  });

  it('cut-off 29 in a non-leap February', () => {
    const m29 = jobWith('monthly', { periodCutoffDay: 29 });
    expect(periodContaining('2026-02-28', m29)).toEqual(range('2026-01-30', '2026-02-28'));
    expect(periodContaining('2026-03-01', m29)).toEqual(range('2026-03-01', '2026-03-29'));
  });

  it('ignores the anchor date', () => {
    const a = jobWith('monthly', { periodCutoffDay: 15, payPeriodAnchorDate: '2026-01-05' });
    const b = jobWith('monthly', { periodCutoffDay: 15, payPeriodAnchorDate: '2019-07-23' });
    expect(periodContaining('2026-06-20', a)).toEqual(periodContaining('2026-06-20', b));
    expect(periodContaining('2026-06-20', a)).toEqual(range('2026-06-16', '2026-07-15'));
  });
});

function expectContiguous(periods: DateRange[]) {
  for (let i = 1; i < periods.length; i++) {
    expect(periods[i].start).toBe(addLocalDays(periods[i - 1].end, 1));
  }
}

describe('periodsBetween', () => {
  it('weekly: every period overlapping the range, in order', () => {
    const out = periodsBetween(jobWith('weekly'), '2026-01-07', '2026-01-20');
    expect(out).toEqual([
      range('2026-01-05', '2026-01-11'),
      range('2026-01-12', '2026-01-18'),
      range('2026-01-19', '2026-01-25'),
    ]);
    expectContiguous(out);
  });

  it('monthly cut-off 30: contiguous and non-overlapping', () => {
    const out = periodsBetween(jobWith('monthly', { periodCutoffDay: 30 }), '2026-01-01', '2026-04-30');
    expect(out).toEqual([
      range('2025-12-31', '2026-01-30'),
      range('2026-01-31', '2026-02-28'),
      range('2026-03-01', '2026-03-30'),
      range('2026-03-31', '2026-04-30'),
    ]);
    expectContiguous(out);
  });

  it('a year of four-weekly periods before and after the anchor is contiguous', () => {
    const out = periodsBetween(jobWith('four_weekly'), '2025-07-01', '2026-07-01');
    expect(out[0].start <= '2025-07-01' && out[0].end >= '2025-07-01').toBe(true);
    expect(out[out.length - 1].start <= '2026-07-01' && out[out.length - 1].end >= '2026-07-01').toBe(true);
    expect(out).toContainEqual(range('2026-01-05', '2026-02-01'));
    expectContiguous(out);
  });

  it('a single day gives its period; an empty range gives none', () => {
    expect(periodsBetween(jobWith('weekly'), '2026-01-08', '2026-01-08')).toEqual([range('2026-01-05', '2026-01-11')]);
    expect(periodsBetween(jobWith('weekly'), '2026-01-09', '2026-01-08')).toEqual([]);
  });
});

describe('payDate', () => {
  it('is period end + payDayOffsetDays', () => {
    expect(payDate(range('2026-01-05', '2026-01-11'), jobWith('weekly'))).toBe('2026-01-16');
    expect(payDate(range('2026-01-05', '2026-01-11'), jobWith('weekly', { payDayOffsetDays: 0 }))).toBe('2026-01-11');
    expect(payDate(range('2026-02-01', '2026-02-28'), jobWith('monthly', { payDayOffsetDays: 3 }))).toBe('2026-03-03');
  });
});

describe('aggregatePeriod', () => {
  // Weekly periods from Wed 4 Nov 2026 (GMT); the OT week starts on Monday.
  const wedJob = jobWith('weekly', { payPeriodAnchorDate: '2026-11-04' });
  const period = range('2026-11-04', '2026-11-10');
  const common = { jobId: 'j1', stacking: 'highest_only' as const, priority: 0 };
  const night: PremiumRule = {
    ...common,
    id: 'night',
    name: 'Nights',
    multiplier: 1.25,
    type: 'time_band',
    startTime: '22:00',
    endTime: '06:00',
  };
  const weekly39: PremiumRule = {
    ...common,
    id: 'weekly',
    name: 'Weekly OT',
    multiplier: 1.5,
    type: 'overtime_weekly',
    thresholdHours: 39,
  };
  const bh: PremiumRule = { ...common, id: 'bh', name: 'Bank holiday', multiplier: 2, type: 'bank_holiday' };

  function shift(
    id: string,
    date: LocalDate,
    start: WallClockTime,
    endDate: LocalDate,
    end: WallClockTime,
    jobId = 'j1',
  ): Shift {
    return {
      id,
      jobId,
      date,
      start: localToInstant(date, start),
      end: localToInstant(endDate, end),
      unpaidBreakMinutes: 0,
      source: 'manual',
      status: 'worked',
      overtimeFlag: false,
    };
  }
  const tenHours = (id: string, date: LocalDate) => shift(id, date, '08:00', date, '18:00');
  // Mon + Tue are before the period but in the same OT week as Wed-Fri.
  const shifts: Shift[] = [
    tenHours('mon', '2026-11-02'),
    tenHours('tue', '2026-11-03'),
    tenHours('wed', '2026-11-04'),
    tenHours('thu', '2026-11-05'),
    tenHours('fri', '2026-11-06'),
    shift('night', '2026-11-09', '22:00', '2026-11-10', '02:00'),
    tenHours('after', '2026-11-11'),
  ];

  it('totals are integer sums of the in-period shift totals; weekly OT counts earlier shifts', () => {
    const out = aggregatePeriod(shifts, wedJob, [night, weekly39, bh], bankHolidays, period);
    expect(out.shifts.map((s) => s.shiftId)).toEqual(['wed', 'thu', 'fri', 'night']);
    const sum = (key: 'basePence' | 'premiumPence' | 'overtimePence' | 'totalGrossPence') =>
      out.shifts.reduce((acc, s) => acc + s[key], 0);
    expect(out.basePence).toBe(sum('basePence'));
    expect(out.premiumPence).toBe(sum('premiumPence'));
    expect(out.overtimePence).toBe(sum('overtimePence'));
    expect(out.totalGrossPence).toBe(sum('totalGrossPence'));
    for (const p of [out.basePence, out.premiumPence, out.overtimePence, out.totalGrossPence]) {
      expect(Number.isInteger(p)).toBe(true);
    }
    // 34h at 1200; Mon+Tue+Wed = 30h, so Thu has 1h OT and Fri 10h (x0.5 = 600/h).
    expect([out.periodStart, out.periodEnd, out.payDate]).toEqual(['2026-11-04', '2026-11-10', '2026-11-15']);
    expect([out.basePence, out.premiumPence, out.overtimePence, out.totalGrossPence]).toEqual([
      40800, 1200, 6600, 48600,
    ]);
    expect(out.paidHours).toBe(34);
    expect(out.byRule).toEqual([
      { ruleId: 'night', ruleName: 'Nights', type: 'time_band', hours: 4, pence: 1200 },
      { ruleId: 'weekly', ruleName: 'Weekly OT', type: 'overtime_weekly', hours: 11, pence: 6600 },
    ]);
  });

  it('without the earlier shifts the same period has no weekly OT', () => {
    const out = aggregatePeriod(shifts.slice(2), wedJob, [night, weekly39], bankHolidays, period);
    expect([out.overtimePence, out.totalGrossPence]).toEqual([0, 42000]);
    expect(out.byRule.map((r) => r.ruleId)).toEqual(['night']);
  });

  it('byRule follows the order of the rules argument', () => {
    const out = aggregatePeriod(shifts, wedJob, [weekly39, night], bankHolidays, period);
    expect(out.byRule.map((r) => r.ruleId)).toEqual(['weekly', 'night']);
  });

  it('hours come from summed minutes (non-whole hours)', () => {
    const short = [shift('a', '2026-11-04', '22:00', '2026-11-04', '22:20'), shift('b', '2026-11-05', '22:00', '2026-11-05', '22:20')];
    const out = aggregatePeriod(short, wedJob, [night], bankHolidays, period);
    expect(out.paidHours).toBe(40 / 60);
    expect(out.byRule).toEqual([{ ruleId: 'night', ruleName: 'Nights', type: 'time_band', hours: 40 / 60, pence: 200 }]);
  });

  it("a second job's shifts (same rules array) don't change the first job's OT or output", () => {
    const otherNight: PremiumRule = { ...night, id: 'night2', jobId: 'j2' };
    const otherWeekly: PremiumRule = { ...weekly39, id: 'weekly2', jobId: 'j2' };
    const rules = [night, weekly39, otherNight, otherWeekly];
    const j2Shifts = [
      shift('j2-mon', '2026-11-02', '00:00', '2026-11-02', '07:00', 'j2'),
      shift('j2-wed', '2026-11-04', '00:00', '2026-11-04', '07:00', 'j2'),
    ];
    const alone = aggregatePeriod(shifts, wedJob, rules, bankHolidays, period);
    const mixed = aggregatePeriod([...j2Shifts, ...shifts], wedJob, rules, bankHolidays, period);
    expect(mixed).toEqual(alone);
    expect(alone.overtimePence).toBe(6600);
    expect(alone.byRule.map((r) => r.ruleId)).toEqual(['night', 'weekly']);
  });

  it('an empty period has zero totals and no rules', () => {
    const out = aggregatePeriod([], wedJob, [night, weekly39], bankHolidays, period);
    expect(out).toEqual({
      periodStart: '2026-11-04',
      periodEnd: '2026-11-10',
      payDate: '2026-11-15',
      shifts: [],
      byRule: [],
      basePence: 0,
      premiumPence: 0,
      overtimePence: 0,
      totalGrossPence: 0,
      paidHours: 0,
    });
  });
});
