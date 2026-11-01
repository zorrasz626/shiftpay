import snapshot from '../../config/bankHolidays.json';
import { createBankHolidayLookup } from '../bankHolidays';
import { sumPence } from '../money';
import { aggregatePeriod } from '../payPeriods';
import { payPeriodList, periodDetail } from '../periodList';
import type { PayPeriodListInput, PayPeriodListItem, PeriodDetail } from '../periodList';
import { shiftDetail } from '../shiftDetail';
import { monthlyStats } from '../stats';
import type { DateRange } from '../shiftPay';
import { addMinutes } from '../time';
import type {
  BankHolidayData,
  Job,
  LocalDate,
  OvertimePremiumMode,
  PremiumRule,
  Shift,
  ShiftStatus,
} from '../types';

const bankHolidays = createBankHolidayLookup(snapshot as BankHolidayData);

/** Weekly, Monday-Sunday periods (5 Jan 2026 is a Monday). Base 1200p/h, paid 5 days after. */
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
const fortnightly: Job = { ...job, payFrequency: 'fortnightly' };
const fourWeekly: Job = { ...job, payFrequency: 'four_weekly' };
const monthly: Job = { ...job, payFrequency: 'monthly', periodCutoffDay: 31 };
const withMode = (mode: OvertimePremiumMode): Job => ({ ...job, overtimePremiumMode: mode });

const common = { jobId: 'j1', priority: 0 } as const;
/** 22:00-06:00, +300p/h. */
const night: PremiumRule = {
  ...common,
  id: 'night',
  name: 'Night',
  stacking: 'highest_only',
  multiplier: 1.25,
  type: 'time_band',
  startTime: '22:00',
  endTime: '06:00',
};
/** Sundays, +200p/h, stacks. */
const sunday: PremiumRule = {
  ...common,
  id: 'sunday',
  name: 'Sunday',
  stacking: 'stack',
  flatAddPencePerHour: 200,
  type: 'day_of_week',
  daysOfWeek: [0],
};
/** Beyond 16h a Monday-Sunday week, +600p/h. */
const weeklyOt: PremiumRule = {
  ...common,
  id: 'ot-weekly',
  name: 'Weekly overtime',
  stacking: 'highest_only',
  multiplier: 1.5,
  type: 'overtime_weekly',
  thresholdHours: 16,
};
/** Beyond 16h a week, only +100p/h (less than Sunday's +200). */
const cheapWeeklyOt: PremiumRule = {
  ...common,
  id: 'ot-cheap',
  name: 'Weekly overtime',
  stacking: 'highest_only',
  flatAddPencePerHour: 100,
  type: 'overtime_weekly',
  thresholdHours: 16,
};

/**
 * A shift starting at `hour`:00 for `hours`. Jan-Mar 2027 dates are GMT, so
 * London = UTC.
 */
function sh(
  id: string,
  date: LocalDate,
  hour: number,
  hours: number,
  extra: { status?: ShiftStatus; jobId?: string; unpaidBreakMinutes?: number } = {},
): Shift {
  const start = `${date}T${String(hour).padStart(2, '0')}:00:00.000Z`;
  return {
    id,
    jobId: extra.jobId ?? 'j1',
    date,
    start,
    end: addMinutes(start, hours * 60),
    unpaidBreakMinutes: extra.unpaidBreakMinutes ?? 0,
    source: 'manual',
    status: extra.status ?? 'planned',
    overtimeFlag: false,
  };
}

/** The detail, checked against the engine: lines sum to the total, which equals aggregatePeriod. */
function detail(shifts: Shift[], j: Job, rules: PremiumRule[], period: DateRange): PeriodDetail {
  const d = periodDetail({ shifts, job: j, rules, bankHolidays, period });
  const engine = aggregatePeriod(shifts, j, rules, bankHolidays, period);
  expect(sumPence(d.lines.map((l) => l.pence))).toBe(d.totalGrossPence);
  expect(d.totalGrossPence).toBe(engine.totalGrossPence);
  expect(d.paidHours).toBe(engine.paidHours);
  expect(d.payDate).toBe(engine.payDate);
  // 0p lines are dropped, except overtime lines with hours (plain-time OT).
  expect(d.lines.every((l) => l.pence !== 0 || (l.kind === 'overtime' && l.hours > 0))).toBe(true);
  return d;
}

/** The list, with every item checked against aggregatePeriod and periodDetail. */
function list(input: Omit<PayPeriodListInput, 'bankHolidays'>): PayPeriodListItem[] {
  const items = payPeriodList({ ...input, bankHolidays });
  for (const item of items) {
    const period = { start: item.start, end: item.end };
    const engine = aggregatePeriod(input.shifts, input.job, input.rules, bankHolidays, period);
    expect(item.totalGrossPence).toBe(engine.totalGrossPence);
    expect(item.paidHours).toBe(engine.paidHours);
    expect(item.payDate).toBe(engine.payDate);
    expect(detail(input.shifts, input.job, input.rules, period).totalGrossPence).toBe(
      item.totalGrossPence,
    );
  }
  return items;
}

const rows = (items: PayPeriodListItem[]) =>
  items.map((i) => [
    i.start,
    i.end,
    i.payDate,
    i.totalGrossPence,
    i.paidHours,
    i.shiftCount,
    i.when,
  ]);
const lineRows = (d: PeriodDetail) =>
  d.lines.map((l) => [l.key, l.label, l.kind, l.hours, l.pence]);

describe('payPeriodList', () => {
  // 18 Jan 2027 is a Monday. Range Wed 6 Jan - Wed 10 Feb; today Wed 20 Jan.
  const weeklyShifts = [
    sh('a', '2027-01-08', 9, 8), // 4-10 Jan: cut by the range start, not listed
    sh('b', '2027-01-12', 9, 8),
    sh('c', '2027-01-19', 9, 8),
    sh('d', '2027-01-21', 20, 8), // night 22:00-04:00 = 6h x 300
    sh('e', '2027-01-26', 9, 8),
    sh('f', '2027-02-02', 9, 8), // after 'next': not listed
  ];

  it('weekly: full periods only, newest first, ending with next', () => {
    const items = list({
      shifts: weeklyShifts,
      job,
      rules: [night],
      range: { start: '2027-01-06', end: '2027-02-10' },
      today: '2027-01-20',
    });
    expect(rows(items)).toEqual([
      ['2027-01-25', '2027-01-31', '2027-02-05', 9600, 8, 1, 'next'],
      ['2027-01-18', '2027-01-24', '2027-01-29', 21000, 16, 2, 'current'],
      ['2027-01-11', '2027-01-17', '2027-01-22', 9600, 8, 1, 'past'],
    ]);
  });

  it('weekly: a next period cut by the range end is not listed', () => {
    const items = list({
      shifts: weeklyShifts,
      job,
      rules: [night],
      range: { start: '2027-01-06', end: '2027-01-28' },
      today: '2027-01-20',
    });
    expect(items.map((i) => [i.start, i.when])).toEqual([
      ['2027-01-18', 'current'],
      ['2027-01-11', 'past'],
    ]);
  });

  it('fortnightly: cancelled, sick and other jobs’ shifts', () => {
    const shifts = [
      sh('w', '2027-01-05', 9, 8, { status: 'worked' }),
      sh('x', '2027-01-06', 9, 8, { status: 'cancelled' }),
      sh('s', '2027-01-24', 9, 8, { status: 'sick' }), // a Sunday: sick is base only
      sh('p', '2027-02-02', 9, 8),
      sh('o', '2027-02-03', 9, 8, { jobId: 'j2' }),
    ];
    const items = list({
      shifts,
      job: fortnightly,
      rules: [sunday],
      range: { start: '2027-01-01', end: '2027-03-31' },
      today: '2027-02-03',
    });
    expect(rows(items)).toEqual([
      ['2027-02-15', '2027-02-28', '2027-03-05', 0, 0, 0, 'next'],
      ['2027-02-01', '2027-02-14', '2027-02-19', 9600, 8, 1, 'current'],
      ['2027-01-18', '2027-01-31', '2027-02-05', 9600, 8, 1, 'past'],
      ['2027-01-04', '2027-01-17', '2027-01-22', 9600, 8, 1, 'past'],
    ]);
  });

  it('four-weekly', () => {
    const shifts = [
      sh('a', '2027-01-10', 9, 8), // Sunday: +200 x 8
      sh('b', '2027-02-09', 9, 8),
      sh('c', '2027-03-02', 9, 8),
    ];
    const items = list({
      shifts,
      job: fourWeekly,
      rules: [sunday],
      range: { start: '2027-01-01', end: '2027-04-30' },
      today: '2027-02-10',
    });
    expect(rows(items)).toEqual([
      ['2027-03-01', '2027-03-28', '2027-04-02', 9600, 8, 1, 'next'],
      ['2027-02-01', '2027-02-28', '2027-03-05', 9600, 8, 1, 'current'],
      ['2027-01-04', '2027-01-31', '2027-02-05', 11200, 8, 1, 'past'],
    ]);
  });

  it('monthly, cut-off 31: calendar months, February ends on the 28th', () => {
    const shifts = [
      sh('d', '2026-12-20', 9, 8), // December is cut by the range start
      sh('a', '2027-01-05', 9, 8),
      sh('b', '2027-02-26', 9, 8),
      sh('c', '2027-02-28', 9, 8), // Sunday: +200 x 8
      sh('e', '2027-03-01', 9, 8),
    ];
    const items = list({
      shifts,
      job: monthly,
      rules: [sunday],
      range: { start: '2026-12-15', end: '2027-03-31' },
      today: '2027-02-15',
    });
    expect(rows(items)).toEqual([
      ['2027-03-01', '2027-03-31', '2027-04-05', 9600, 8, 1, 'next'],
      ['2027-02-01', '2027-02-28', '2027-03-05', 20800, 16, 2, 'current'],
      ['2027-01-01', '2027-01-31', '2027-02-05', 9600, 8, 1, 'past'],
    ]);
  });

  it('weekly OT across a period boundary counts the earlier period’s shifts', () => {
    // Week Mon 28 Dec 2026 - Sun 3 Jan 2027 straddles the December / January periods.
    const shifts = [
      sh('a', '2026-12-28', 9, 8),
      sh('b', '2026-12-29', 9, 8),
      sh('c', '2027-01-01', 9, 8),
    ];
    const items = list({
      shifts,
      job: monthly,
      rules: [weeklyOt],
      range: { start: '2026-12-01', end: '2027-02-28' },
      today: '2027-01-10',
    });
    expect(rows(items)).toEqual([
      ['2027-02-01', '2027-02-28', '2027-03-05', 0, 0, 0, 'next'],
      ['2027-01-01', '2027-01-31', '2027-02-05', 14400, 8, 1, 'current'],
      ['2026-12-01', '2026-12-31', '2027-01-05', 19200, 16, 2, 'past'],
    ]);
    const jan = detail(shifts, monthly, [weeklyOt], { start: '2027-01-01', end: '2027-01-31' });
    expect(lineRows(jan)).toEqual([
      ['base', 'Base', 'base', 8, 9600],
      ['overtime:ot-weekly', 'Weekly overtime', 'overtime', 8, 4800],
    ]);
  });
});

describe('periodDetail', () => {
  const period = { start: '2027-01-11', end: '2027-01-17' };
  // Mon + Tue = 16h, then the Sunday shift is all weekly OT and all Sunday premium.
  const shifts = [
    sh('sun', '2027-01-17', 9, 8),
    sh('mon', '2027-01-11', 9, 8),
    sh('tue', '2027-01-12', 9, 8),
  ];

  it('replace: OT only on the Sunday hours', () => {
    const d = detail(shifts, withMode('replace'), [sunday, weeklyOt], period);
    expect(lineRows(d)).toEqual([
      ['base', 'Base', 'base', 24, 28800],
      ['overtime:ot-weekly', 'Weekly overtime', 'overtime', 8, 4800],
    ]);
    expect(d.totalGrossPence).toBe(33600);
  });

  it('highest: the larger uplift wins', () => {
    expect(lineRows(detail(shifts, withMode('highest'), [sunday, weeklyOt], period))).toEqual([
      ['base', 'Base', 'base', 24, 28800],
      ['overtime:ot-weekly', 'Weekly overtime', 'overtime', 8, 4800],
    ]);
    // Premium wins: no OT pay, so no OT hours and no byRule entry for the OT rule (F3).
    const rules = [sunday, cheapWeeklyOt];
    const engine = aggregatePeriod(shifts, withMode('highest'), rules, bankHolidays, period);
    expect(engine.byRule.find((r) => r.ruleId === 'ot-cheap')).toBeUndefined();
    expect(lineRows(detail(shifts, withMode('highest'), rules, period))).toEqual([
      ['base', 'Base', 'base', 24, 28800],
      ['premium:sunday', 'Sunday', 'premium', 8, 1600],
    ]);
  });

  it('stack: premium and OT both paid, in rules order', () => {
    const d = detail(shifts, withMode('stack'), [sunday, weeklyOt], period);
    expect(lineRows(d)).toEqual([
      ['base', 'Base', 'base', 24, 28800],
      ['premium:sunday', 'Sunday', 'premium', 8, 1600],
      ['overtime:ot-weekly', 'Weekly overtime', 'overtime', 8, 4800],
    ]);
    expect(d.totalGrossPence).toBe(35200);
  });

  it('stack, OT rule listed first: premiums still come before overtime', () => {
    const d = detail(shifts, withMode('stack'), [weeklyOt, sunday], period);
    expect(lineRows(d)).toEqual([
      ['base', 'Base', 'base', 24, 28800],
      ['premium:sunday', 'Sunday', 'premium', 8, 1600],
      ['overtime:ot-weekly', 'Weekly overtime', 'overtime', 8, 4800],
    ]);
    expect(d.totalGrossPence).toBe(35200);
  });

  it('highest, premium wins on some OT hours: OT hours count only OT-paid segments', () => {
    // Mon + Tue = 16h; Wed 4h is OT with no premium (OT +100 wins); Sun 8h is OT but Sunday +200 wins.
    const input = [...shifts, sh('wed', '2027-01-13', 9, 4)];
    const rules = [sunday, cheapWeeklyOt];
    const j = withMode('highest');
    const engine = aggregatePeriod(input, j, rules, bankHolidays, period);
    expect(engine.byRule.find((r) => r.ruleId === 'ot-cheap')).toMatchObject({
      hours: 4,
      pence: 400,
    });
    const d = detail(input, j, rules, period);
    expect(lineRows(d)).toEqual([
      ['base', 'Base', 'base', 28, 33600],
      ['premium:sunday', 'Sunday', 'premium', 8, 1600],
      ['overtime:ot-cheap', 'Weekly overtime', 'overtime', 4, 400],
    ]);
    const perShiftOtHours = input
      .map((s) => shiftDetail({ shift: s, shifts: input, job: j, rules, bankHolidays }))
      .flatMap((sd) => sd.lines.filter((l) => l.key === 'overtime:ot-cheap'))
      .reduce((acc, l) => acc + l.hours, 0);
    expect(perShiftOtHours).toBe(4);
    expect(d.lines[2].hours).toBe(perShiftOtHours);
  });

  it('shifts sorted by start; cancelled included at 0p; other jobs excluded', () => {
    const input = [
      sh('x', '2027-01-13', 9, 8, { status: 'cancelled' }),
      sh('s', '2027-01-12', 9, 8, { status: 'sick' }),
      sh('late', '2027-01-11', 14, 4, { unpaidBreakMinutes: 30 }),
      sh('early', '2027-01-11', 6, 4),
      sh('o', '2027-01-11', 9, 8, { jobId: 'j2' }),
      sh('before', '2027-01-10', 9, 8),
    ];
    const d = detail(input, job, [sunday], period);
    expect(d.shifts.map((s) => [s.id, s.status, s.paidHours, s.totalGrossPence])).toEqual([
      ['early', 'planned', 4, 4800],
      ['late', 'planned', 3.5, 4200],
      ['s', 'sick', 8, 9600],
      ['x', 'cancelled', 0, 0],
    ]);
    expect(d.shifts[0]).toEqual({
      id: 'early',
      date: '2027-01-11',
      start: '2027-01-11T06:00:00.000Z',
      end: '2027-01-11T10:00:00.000Z',
      status: 'planned',
      paidHours: 4,
      totalGrossPence: 4800,
    });
    expect(lineRows(d)).toEqual([['base', 'Base', 'base', 15.5, 18600]]);
  });

  it('an empty period has no lines and no shifts', () => {
    const d = detail(shifts, job, [sunday], { start: '2027-02-01', end: '2027-02-07' });
    expect(d).toEqual({
      totalGrossPence: 0,
      paidHours: 0,
      payDate: '2027-02-12',
      lines: [],
      shifts: [],
    });
  });
});

describe('OT hours are counted the same everywhere (F3)', () => {
  const period = { start: '2027-01-11', end: '2027-01-17' };
  // Mon + Tue = 16h; Wed 4h is OT with no premium; Sun 8h is OT and Sunday (+200 beats OT +100).
  const shifts = [
    sh('sun', '2027-01-17', 9, 8),
    sh('mon', '2027-01-11', 9, 8),
    sh('tue', '2027-01-12', 9, 8),
    sh('wed', '2027-01-13', 9, 4),
  ];
  /** Plain-time OT (x1.0): pays the hours at base rate, adding 0p. */
  const plainWeeklyOt: PremiumRule = {
    ...weeklyOt,
    id: 'ot-plain',
    name: 'Plain overtime',
    multiplier: 1,
  };

  it.each([
    // mode, OT rule, OT hours, [base, premium, OT, gross] pence
    ['highest', cheapWeeklyOt, 4, [33600, 1600, 400, 35600]],
    ['replace', cheapWeeklyOt, 12, [33600, 0, 1200, 34800]],
    ['stack', cheapWeeklyOt, 12, [33600, 1600, 1200, 36400]],
    // x1.0: Wed is OT at 0p; Sunday's premium out-bids it only in `highest`.
    ['highest', plainWeeklyOt, 4, [33600, 1600, 0, 35200]],
    ['replace', plainWeeklyOt, 12, [33600, 0, 0, 33600]],
    ['stack', plainWeeklyOt, 12, [33600, 1600, 0, 35200]],
  ] as const)(
    '%s, %#: periodDetail, shiftDetail, byRule and Stats agree on OT hours and pence',
    (mode, ot, otHours, pence) => {
      const rules = [sunday, ot];
      const j = withMode(mode);
      const engine = aggregatePeriod(shifts, j, rules, bankHolidays, period);
      const d = detail(shifts, j, rules, period);
      const stats = monthlyStats({
        shifts,
        job: j,
        rules,
        bankHolidays,
        from: '2027-01',
        to: '2027-01',
        now: '2027-12-31T00:00:00.000Z',
      });

      const byRuleOt = engine.byRule.find((r) => r.ruleId === ot.id);
      const lineOt = d.lines.find((l) => l.key === `overtime:${ot.id}`);
      const shiftOtHours = shifts
        .map((s) => shiftDetail({ shift: s, shifts, job: j, rules, bankHolidays }))
        .flatMap((sd) => sd.lines.filter((l) => l.key === `overtime:${ot.id}`))
        .reduce((acc, l) => acc + l.hours, 0);
      expect(byRuleOt?.hours).toBe(otHours);
      expect(lineOt?.hours).toBe(otHours);
      expect(shiftOtHours).toBe(otHours);
      expect(stats.totals.overtimeHours).toBe(otHours);
      expect(stats.months[0].overtimeHours).toBe(otHours);
      expect(stats.totals.byRule).toEqual(engine.byRule);

      // Pence are unchanged by the OT-hours definition, and agree across readers.
      expect([
        engine.basePence,
        engine.premiumPence,
        engine.overtimePence,
        engine.totalGrossPence,
      ]).toEqual(pence);
      expect([
        stats.totals.basePence,
        stats.totals.premiumPence,
        stats.totals.overtimePence,
        stats.totals.grossPence,
      ]).toEqual(pence);
      expect(d.totalGrossPence).toBe(pence[3]);
      expect(lineOt?.pence).toBe(pence[2]);
    },
  );
});
