import { payDate, periodContaining } from '../payPeriods';
import { newJobDefaults, paySchedule, validatePaySchedule } from '../paySchedule';
import type { PayScheduleInput } from '../paySchedule';
import type { Job, LocalDate } from '../types';

const base = newJobDefaults({ id: 'j1', name: 'Test job', baseRatePence: 1200, today: '2026-10-31' });

function jobFor(input: PayScheduleInput): Job {
  return { ...base, ...paySchedule(input) };
}

function roundTrip(input: PayScheduleInput, periodEnd: LocalDate = input.periodEndDate): LocalDate {
  const job = jobFor(input);
  return payDate(periodContaining(periodEnd, job), job);
}

describe('paySchedule: fixed-length frequencies', () => {
  it.each([
    ['weekly', '2026-11-06', '2026-11-01', '2026-10-26', 5],
    ['fortnightly', '2026-11-13', '2026-11-08', '2026-10-26', 5],
    ['four_weekly', '2026-11-27', '2026-11-22', '2026-10-26', 5],
    ['weekly', '2026-11-01', '2026-11-01', '2026-10-26', 0],
    ['four_weekly', '2026-12-31', '2026-11-30', '2026-11-03', 31],
  ] as const)('%s: pay %s, period end %s', (payFrequency, nextPayDate, periodEndDate, anchor, offset) => {
    const input = { payFrequency, nextPayDate, periodEndDate };
    expect(paySchedule(input)).toEqual({
      payFrequency,
      payPeriodAnchorDate: anchor,
      payDayOffsetDays: offset,
      periodCutoffDay: Number(periodEndDate.slice(8)),
    });
    expect(roundTrip(input)).toBe(nextPayDate);
  });

  it('round-trips across BST changes', () => {
    // Weekly period 23-29 Mar 2026 ends on the GMT->BST day.
    expect(roundTrip({ payFrequency: 'weekly', nextPayDate: '2026-04-03', periodEndDate: '2026-03-29' })).toBe(
      '2026-04-03',
    );
    // Fortnightly period 18-31 Oct 2026 spans the BST->GMT day (25 Oct).
    const fortnightly: PayScheduleInput = {
      payFrequency: 'fortnightly',
      nextPayDate: '2026-11-06',
      periodEndDate: '2026-10-31',
    };
    expect(paySchedule(fortnightly).payPeriodAnchorDate).toBe('2026-10-18');
    expect(roundTrip(fortnightly)).toBe('2026-11-06');
    // Four-weekly period 15 Mar - 11 Apr 2026 spans the GMT->BST day.
    expect(roundTrip({ payFrequency: 'four_weekly', nextPayDate: '2026-04-17', periodEndDate: '2026-04-11' })).toBe(
      '2026-04-17',
    );
  });

  it('later periods keep the same offset', () => {
    const input: PayScheduleInput = { payFrequency: 'fortnightly', nextPayDate: '2026-11-13', periodEndDate: '2026-11-08' };
    expect(roundTrip(input, '2026-11-20')).toBe('2026-11-27');
  });

  it('ignores a cut-off day given for a fixed-length frequency', () => {
    const fields = paySchedule({
      payFrequency: 'weekly',
      nextPayDate: '2026-11-06',
      periodEndDate: '2026-11-01',
      periodCutoffDay: 99,
    });
    expect(fields.periodCutoffDay).toBe(1);
  });
});

describe('paySchedule: monthly', () => {
  it.each([
    // cut-off, next pay, expected period end (= round-trip input), anchor, offset
    [31, '2026-03-03', '2026-02-28', '2026-02-01', 3],
    [31, '2026-04-30', '2026-04-30', '2026-04-01', 0],
    [31, '2026-07-05', '2026-06-30', '2026-06-01', 5],
    [30, '2028-03-01', '2028-02-29', '2028-01-31', 1],
    [15, '2026-01-10', '2025-12-15', '2025-11-16', 26],
    [25, '2026-03-31', '2026-03-25', '2026-02-26', 6],
  ] as const)('cut-off %i, pay %s -> period end %s', (periodCutoffDay, nextPayDate, end, anchor, offset) => {
    // periodEndDate is ignored for monthly: pass something unrelated.
    const input: PayScheduleInput = { payFrequency: 'monthly', nextPayDate, periodEndDate: '2000-01-01', periodCutoffDay };
    expect(paySchedule(input)).toEqual({
      payFrequency: 'monthly',
      payPeriodAnchorDate: anchor,
      payDayOffsetDays: offset,
      periodCutoffDay,
    });
    expect(roundTrip(input, end)).toBe(nextPayDate);
  });

  it('round-trips a period spanning the BST change', () => {
    // Cut-off 15: period 16 Mar - 15 Apr 2026 contains 29 Mar.
    const input: PayScheduleInput = {
      payFrequency: 'monthly',
      nextPayDate: '2026-04-20',
      periodEndDate: '2026-04-15',
      periodCutoffDay: 15,
    };
    expect(roundTrip(input)).toBe('2026-04-20');
    expect(roundTrip(input, '2026-03-29')).toBe('2026-04-20');
  });
});

describe('validatePaySchedule', () => {
  it('accepts valid input', () => {
    expect(validatePaySchedule({ payFrequency: 'weekly', nextPayDate: '2026-11-06', periodEndDate: '2026-11-01' })).toEqual(
      [],
    );
    expect(
      validatePaySchedule({ payFrequency: 'monthly', nextPayDate: '2026-11-06', periodEndDate: '', periodCutoffDay: 31 }),
    ).toEqual([]);
  });

  it('end_after_pay', () => {
    expect(validatePaySchedule({ payFrequency: 'weekly', nextPayDate: '2026-11-06', periodEndDate: '2026-11-07' })).toEqual([
      'end_after_pay',
    ]);
  });

  it('offset_too_large', () => {
    expect(
      validatePaySchedule({ payFrequency: 'fortnightly', nextPayDate: '2027-01-01', periodEndDate: '2026-11-30' }),
    ).toEqual(['offset_too_large']);
  });

  it('cutoff_missing', () => {
    expect(validatePaySchedule({ payFrequency: 'monthly', nextPayDate: '2026-11-06', periodEndDate: '' })).toEqual([
      'cutoff_missing',
    ]);
  });

  it.each([0, 32, 15.5, -1])('cutoff_out_of_range: %p', (periodCutoffDay) => {
    expect(
      validatePaySchedule({ payFrequency: 'monthly', nextPayDate: '2026-11-06', periodEndDate: '', periodCutoffDay }),
    ).toEqual(['cutoff_out_of_range']);
  });

  it('throws on an invalid date', () => {
    expect(() => validatePaySchedule({ payFrequency: 'weekly', nextPayDate: '2026-02-30', periodEndDate: '2026-02-01' })).toThrow();
  });

  it('paySchedule throws on invalid input', () => {
    expect(() => paySchedule({ payFrequency: 'monthly', nextPayDate: '2026-11-06', periodEndDate: '' })).toThrow(
      'cutoff_missing',
    );
  });
});

describe('newJobDefaults', () => {
  it('fills in the defaults', () => {
    expect(base).toEqual({
      id: 'j1',
      name: 'Test job',
      baseRatePence: 1200,
      contractedHoursPerWeek: 39,
      bankHolidayRegion: 'england-and-wales',
      overtimePremiumMode: 'highest',
      holidayYearStart: '2026-01-01',
      holidayEntitlementHours: 218.4,
      holidayMode: 'fixed',
    });
  });

  it('throws on an invalid today', () => {
    expect(() => newJobDefaults({ id: 'j', name: 'n', baseRatePence: 1, today: 'nope' })).toThrow();
  });
});
