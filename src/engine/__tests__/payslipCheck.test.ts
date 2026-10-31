import snapshot from '../../config/bankHolidays.json';
import { createBankHolidayLookup } from '../bankHolidays';
import {
  formatCauseDate,
  formatCauseHours,
  hoursDifferText,
  MAX_CAUSE_DATES,
  NO_CAUSE_TEXT,
  payslipCauseText,
  payslipCheck,
  payslipChip,
  ruleNameLookup,
  ruleNotOnPayslipText,
  shortfallMatchesOvertimeText,
  shortfallMatchesRuleText,
  UNKNOWN_RULE_NAME,
} from '../payslipCheck';
import { localToInstant } from '../time';
import type {
  BankHolidayData,
  Job,
  LocalDate,
  Payslip,
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

/** Monday 8h, plus Sundays 18th (8h) and 11th (4h + 3h): 23h, Sunday premium £18.00. */
const sundayShifts = [
  shift('2026-01-05', '09:00', '17:00'),
  shift('2026-01-18', '09:00', '17:00'),
  shift('2026-01-11', '14:00', '17:00'),
  shift('2026-01-11', '09:00', '13:00'),
];
const sundayExpected = 23 * 1200 + 1800;

/** Tuesday 10h: 2h over the 8h daily threshold, OT uplift 2h * £6.00. */
const otShifts = [shift('2026-01-06', '09:00', '19:00')];
const otExpected = 10 * 1200 + 1200;

function payslip(grossPaidPence: number, extra: Partial<Payslip> = {}): Payslip {
  return {
    id: 'p1',
    jobId: 'j1',
    periodStart: period.start,
    periodEnd: period.end,
    grossPaidPence,
    taxPence: 0,
    niPence: 0,
    pensionPence: 0,
    ...extra,
  };
}

function checkSunday(paid: number, extra: Partial<Payslip> = {}) {
  return payslipCheck({
    shifts: sundayShifts,
    job,
    rules: [sunday],
    bankHolidays,
    period,
    payslip: payslip(paid, extra),
  });
}

function checkOt(paid: number) {
  return payslipCheck({
    shifts: otShifts,
    job,
    rules: [dailyOt],
    bankHolidays,
    period,
    payslip: payslip(paid),
  });
}

describe('payslipCheck', () => {
  it('exact match -> "Match", positive, no causes', () => {
    expect(checkSunday(sundayExpected)).toEqual({
      status: 'match',
      chipLabel: 'Match',
      chipTone: 'positive',
      expectedPence: sundayExpected,
      paidPence: sundayExpected,
      diffPence: 0,
      expectedHours: 23,
      causes: [],
    });
  });

  it('underpaid by the Sunday premium, lines given -> not-on-payslip and shortfall causes', () => {
    const view = checkSunday(sundayExpected - 1800, {
      lines: [{ label: 'Basic pay', hours: 23, amountPence: 27600 }],
    });
    expect(view.status).toBe('underpaid');
    expect(view.chipLabel).toBe('Underpaid by £18.00');
    expect(view.chipTone).toBe('alert');
    expect(view.diffPence).toBe(-1800);
    expect(view.causes).toEqual([
      'Sundays for 11 Jan, 18 Jan not found on payslip?',
      'Shortfall is close to your Sundays pay (£18.00) — was it paid?',
    ]);
  });

  it('overpaid with no causes -> "Overpaid by £X", neutral, the no-cause text', () => {
    const view = checkSunday(sundayExpected + 500);
    expect(view.status).toBe('overpaid');
    expect(view.chipLabel).toBe('Overpaid by £5.00');
    expect(view.chipTone).toBe('neutral');
    expect(view.causes).toEqual([NO_CAUSE_TEXT]);
  });

  it('underpaid by an unrelated amount -> the no-cause text', () => {
    const view = checkSunday(sundayExpected - 5000);
    expect(view.chipLabel).toBe('Underpaid by £50.00');
    expect(view.causes).toEqual([NO_CAUSE_TEXT]);
  });

  it('OT shortfall shows the overtime cause only once', () => {
    const view = checkOt(otExpected - 1200);
    expect(view.expectedPence).toBe(otExpected);
    expect(view.status).toBe('underpaid');
    expect(view.chipLabel).toBe('Underpaid by £12.00');
    expect(view.causes).toEqual([
      'Shortfall is close to your overtime (£12.00) — overtime threshold not met?',
    ]);
  });

  it('within £1 but hours differ -> "Check", neutral, hours cause, hours passed through', () => {
    const view = checkSunday(sundayExpected, { hoursPaid: 23.5 });
    expect(view.status).toBe('check');
    expect(view.chipLabel).toBe('Check');
    expect(view.chipTone).toBe('neutral');
    expect(view.paidHours).toBe(23.5);
    expect(view.diffHours).toBe(0.5);
    expect(view.causes).toEqual(['Payslip shows 0.5 hours more than your shifts']);
  });
});

describe('payslipChip', () => {
  it('uses the absolute difference', () => {
    expect(payslipChip('underpaid', -123456)).toEqual({
      label: 'Underpaid by £1,234.56',
      tone: 'alert',
    });
    expect(payslipChip('overpaid', 101)).toEqual({ label: 'Overpaid by £1.01', tone: 'neutral' });
  });
});

describe('cause text', () => {
  it('formats dates from the string, without leading zeros', () => {
    expect(formatCauseDate('2026-10-03')).toBe('3 Oct');
    expect(formatCauseDate('2026-12-25')).toBe('25 Dec');
    expect(formatCauseDate('2026-01-01')).toBe('1 Jan');
  });

  it('formats hours without trailing zeros, singular for 1', () => {
    expect(formatCauseHours(-1)).toBe('1 hour');
    expect(formatCauseHours(2.5)).toBe('2.5 hours');
    expect(formatCauseHours(-2.75)).toBe('2.75 hours');
    expect(formatCauseHours(3)).toBe('3 hours');
  });

  it('hours_differ: fewer / more', () => {
    expect(hoursDifferText(-2.5)).toBe('Payslip shows 2.5 hours fewer than your shifts');
    expect(hoursDifferText(1)).toBe('Payslip shows 1 hour more than your shifts');
    expect(hoursDifferText(-1)).toBe('Payslip shows 1 hour fewer than your shifts');
  });

  it('rule_not_on_payslip: up to 3 dates, then "+N more"', () => {
    expect(MAX_CAUSE_DATES).toBe(3);
    expect(ruleNotOnPayslipText('Nights', ['2026-10-03', '2026-10-10'])).toBe(
      'Nights for 3 Oct, 10 Oct not found on payslip?',
    );
    expect(
      ruleNotOnPayslipText('Nights', [
        '2026-10-03',
        '2026-10-10',
        '2026-10-17',
        '2026-10-24',
        '2026-10-31',
      ]),
    ).toBe('Nights for 3 Oct, 10 Oct, 17 Oct +2 more not found on payslip?');
  });

  it('shortfall texts', () => {
    expect(shortfallMatchesRuleText('Nights', 2450)).toBe(
      'Shortfall is close to your Nights pay (£24.50) — was it paid?',
    );
    expect(shortfallMatchesOvertimeText(1200)).toBe(
      'Shortfall is close to your overtime (£12.00) — overtime threshold not met?',
    );
  });

  it('unknown rule id -> "a pay rule" (capitalised at sentence start)', () => {
    const name = ruleNameLookup([sunday]);
    expect(name('sunday')).toBe('Sundays');
    expect(name('gone')).toBe(UNKNOWN_RULE_NAME);
    expect(
      payslipCauseText({ kind: 'rule_not_on_payslip', ruleId: 'gone', dates: ['2026-10-03'] }, name),
    ).toBe('A pay rule for 3 Oct not found on payslip?');
    expect(
      payslipCauseText({ kind: 'shortfall_matches_rule', ruleId: 'gone', rulePence: 500 }, name),
    ).toBe('Shortfall is close to your a pay rule pay (£5.00) — was it paid?');
  });

  it('payslipCauseText covers every kind', () => {
    const name = ruleNameLookup([sunday]);
    expect(payslipCauseText({ kind: 'hours_differ', diffHours: -0.5 }, name)).toBe(
      'Payslip shows 0.5 hours fewer than your shifts',
    );
    expect(payslipCauseText({ kind: 'shortfall_matches_overtime', overtimePence: 900 }, name)).toBe(
      'Shortfall is close to your overtime (£9.00) — overtime threshold not met?',
    );
  });
});
