import snapshot from '../../config/bankHolidays.json';
import { createBankHolidayLookup } from '../bankHolidays';
import { aggregatePeriod } from '../payPeriods';
import { diffPayslip } from '../payslip';
import { localToInstant } from '../time';
import type {
  BankHolidayData,
  Job,
  LocalDate,
  Payslip,
  PeriodBreakdown,
  PremiumRule,
  Shift,
  WallClockTime,
} from '../types';

const bankHolidays = createBankHolidayLookup(snapshot as BankHolidayData);

const job: Job = {
  id: 'j1',
  name: 'Test job',
  baseRatePence: 1200,
  payFrequency: 'fortnightly',
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
const period = { start: '2026-01-05', end: '2026-01-18' };

const base = { jobId: 'j1', priority: 0 };
const sunday: PremiumRule = {
  ...base,
  id: 'sunday',
  name: 'Sundays',
  stacking: 'stack',
  multiplier: 1.1,
  type: 'day_of_week',
  daysOfWeek: [0],
};
const dailyOt: PremiumRule = {
  ...base,
  id: 'ot',
  name: 'Daily OT',
  stacking: 'stack',
  multiplier: 1.5,
  type: 'overtime_daily',
  thresholdHours: 8,
};

let nextId = 0;
function shift(date: LocalDate, start: WallClockTime, end: WallClockTime): Shift {
  nextId += 1;
  return {
    id: `s${nextId}`,
    jobId: 'j1',
    date,
    start: localToInstant(date, start),
    end: localToInstant(date, end),
    unpaidBreakMinutes: 0,
    source: 'manual',
    status: 'worked',
    overtimeFlag: false,
  };
}

/** Monday 8h, plus Sundays 18th (8h) and 11th (4h + 3h), listed out of date order. */
const sundayBreakdown: PeriodBreakdown = aggregatePeriod(
  [
    shift('2026-01-05', '09:00', '17:00'),
    shift('2026-01-18', '09:00', '17:00'),
    shift('2026-01-11', '14:00', '17:00'),
    shift('2026-01-11', '09:00', '13:00'),
  ],
  job,
  [sunday],
  bankHolidays,
  period,
);

/** Tuesday 10h: 2h over the 8h daily threshold. */
const otBreakdown: PeriodBreakdown = aggregatePeriod(
  [shift('2026-01-06', '09:00', '19:00')],
  job,
  [dailyOt],
  bankHolidays,
  period,
);

function payslip(
  breakdown: PeriodBreakdown,
  grossPaidPence: number,
  extra: Partial<Payslip> = {},
): Payslip {
  return {
    id: 'p1',
    jobId: 'j1',
    periodStart: breakdown.periodStart,
    periodEnd: breakdown.periodEnd,
    grossPaidPence,
    taxPence: 0,
    niPence: 0,
    pensionPence: 0,
    ...extra,
  };
}

const sundayPence = sundayBreakdown.byRule.find((r) => r.ruleId === 'sunday')?.pence ?? 0;

describe('diffPayslip fixtures', () => {
  it('builds a Sunday premium and an OT total from real shifts', () => {
    expect(sundayBreakdown.paidHours).toBe(23);
    expect(sundayPence).toBe(1800);
    expect(sundayBreakdown.totalGrossPence).toBe(23 * 1200 + 1800);
    expect(otBreakdown.overtimePence).toBeGreaterThan(0);
  });
});

describe('diffPayslip status', () => {
  const expected = sundayBreakdown.totalGrossPence;

  it('exact match', () => {
    const diff = diffPayslip(payslip(sundayBreakdown, expected), sundayBreakdown);
    expect(diff).toEqual({
      status: 'match',
      expectedPence: expected,
      paidPence: expected,
      diffPence: 0,
      expectedHours: 23,
      causes: [],
    });
  });

  it.each([100, -100])('within £1 (%i p) is a match', (delta) => {
    const diff = diffPayslip(payslip(sundayBreakdown, expected + delta), sundayBreakdown);
    expect(diff.status).toBe('match');
    expect(diff.diffPence).toBe(delta);
  });

  it('101p over is overpaid, with no shortfall causes', () => {
    const diff = diffPayslip(payslip(sundayBreakdown, expected + 101), sundayBreakdown);
    expect(diff.status).toBe('overpaid');
    expect(diff.diffPence).toBe(101);
    expect(diff.causes).toEqual([]);
  });

  it('101p under is underpaid', () => {
    const diff = diffPayslip(payslip(sundayBreakdown, expected - 101), sundayBreakdown);
    expect(diff.status).toBe('underpaid');
    expect(diff.diffPence).toBe(-101);
    expect(diff.causes).toEqual([]);
  });
});

describe('diffPayslip causes', () => {
  it('underpaid by the Sunday premium (within £1) -> shortfall_matches_rule', () => {
    const paid = sundayBreakdown.totalGrossPence - sundayPence + 50;
    const diff = diffPayslip(payslip(sundayBreakdown, paid), sundayBreakdown);
    expect(diff.status).toBe('underpaid');
    expect(diff.causes).toEqual([
      { kind: 'shortfall_matches_rule', ruleId: 'sunday', rulePence: sundayPence },
    ]);
  });

  it('underpaid by the OT total -> shortfall_matches_overtime', () => {
    const ot = otBreakdown.overtimePence;
    const diff = diffPayslip(payslip(otBreakdown, otBreakdown.totalGrossPence - ot), otBreakdown);
    expect(diff.status).toBe('underpaid');
    // The OT rule is itself a byRule entry, so it also matches as a rule (cause 3 before cause 4).
    expect(diff.causes).toEqual([
      { kind: 'shortfall_matches_rule', ruleId: 'ot', rulePence: ot },
      { kind: 'shortfall_matches_overtime', overtimePence: ot },
    ]);
  });

  it('underpaid by an unrelated amount -> no OT cause', () => {
    const diff = diffPayslip(payslip(otBreakdown, otBreakdown.totalGrossPence - 5000), otBreakdown);
    expect(diff.status).toBe('underpaid');
    expect(diff.causes).toEqual([]);
  });

  it('underpaid with no overtime -> no OT cause even when the shortfall is tiny', () => {
    const diff = diffPayslip(
      payslip(sundayBreakdown, sundayBreakdown.totalGrossPence - 150),
      sundayBreakdown,
    );
    expect(diff.causes).toEqual([]);
  });

  it('lines missing the Sunday rule -> rule_not_on_payslip with sorted unique dates; within £1 -> check', () => {
    const lines = [
      { label: 'Basic pay', hours: 23, amountPence: 27600 },
      { label: 'Sunday premium', amountPence: 1800 },
    ];
    const diff = diffPayslip(
      payslip(sundayBreakdown, sundayBreakdown.totalGrossPence - 40, { lines }),
      sundayBreakdown,
    );
    expect(diff.status).toBe('check');
    expect(diff.causes).toEqual([
      { kind: 'rule_not_on_payslip', ruleId: 'sunday', dates: ['2026-01-11', '2026-01-18'] },
    ]);
  });

  it('a line naming the rule (any case) -> no cause', () => {
    const lines = [{ label: 'SUNDAYS enhancement', amountPence: 1800 }];
    const diff = diffPayslip(
      payslip(sundayBreakdown, sundayBreakdown.totalGrossPence, { lines }),
      sundayBreakdown,
    );
    expect(diff.status).toBe('match');
    expect(diff.causes).toEqual([]);
  });

  it('an OT rule missing from the lines uses the dates of its OT segments', () => {
    const diff = diffPayslip(
      payslip(otBreakdown, otBreakdown.totalGrossPence, {
        lines: [{ label: 'Basic', amountPence: 1 }],
      }),
      otBreakdown,
    );
    expect(diff.causes).toEqual([
      { kind: 'rule_not_on_payslip', ruleId: 'ot', dates: ['2026-01-06'] },
    ]);
  });

  it('hoursPaid off by 0.5h -> hours_differ, first in the list', () => {
    const paid = sundayBreakdown.totalGrossPence - sundayPence;
    const diff = diffPayslip(payslip(sundayBreakdown, paid, { hoursPaid: 22.5 }), sundayBreakdown);
    expect(diff.paidHours).toBe(22.5);
    expect(diff.diffHours).toBe(-0.5);
    expect(diff.causes).toEqual([
      { kind: 'hours_differ', diffHours: -0.5 },
      { kind: 'shortfall_matches_rule', ruleId: 'sunday', rulePence: sundayPence },
    ]);
  });

  it('hoursPaid off by 0.5h with the amount right -> check', () => {
    const diff = diffPayslip(
      payslip(sundayBreakdown, sundayBreakdown.totalGrossPence, { hoursPaid: 23.5 }),
      sundayBreakdown,
    );
    expect(diff.status).toBe('check');
    expect(diff.causes).toEqual([{ kind: 'hours_differ', diffHours: 0.5 }]);
  });

  it.each([23.25, 22.75])('hoursPaid %f (0.25h off) -> no cause', (hoursPaid) => {
    const diff = diffPayslip(
      payslip(sundayBreakdown, sundayBreakdown.totalGrossPence, { hoursPaid }),
      sundayBreakdown,
    );
    expect(diff.status).toBe('match');
    expect(diff.diffHours).toBe(hoursPaid - 23);
    expect(diff.causes).toEqual([]);
  });

  it('clears float noise when comparing hours', () => {
    const diff = diffPayslip(
      payslip(sundayBreakdown, sundayBreakdown.totalGrossPence, { hoursPaid: 23.1 + 0.15 }),
      sundayBreakdown,
    );
    expect(diff.diffHours).toBe(0.25);
    expect(diff.causes).toEqual([]);
  });
});
