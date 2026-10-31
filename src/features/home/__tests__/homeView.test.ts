import type { HomeNextShift, HomeSummary } from '../../../engine/homeSummary';
import type { Shift } from '../../../engine/types';
import { formatDayDate, formatShortDate, homeView, nextShiftWhen, payDayCountdown } from '../homeView';

function shift(start: string, end: string): Shift {
  return {
    id: 's1',
    jobId: 'job-1',
    date: start.slice(0, 10),
    start,
    end,
    unpaidBreakMinutes: 0,
    source: 'manual',
    status: 'planned',
    overtimeFlag: false,
  };
}

const nextBase: HomeNextShift = {
  shift: shift('2026-11-02T19:00:00.000Z', '2026-11-03T07:00:00.000Z'),
  inProgress: false,
  totalGrossPence: 15075,
};

const summary: HomeSummary = {
  today: '2026-11-02',
  period: { start: '2026-11-01', end: '2026-11-07' },
  projectedPence: 51240,
  earnedSoFarPence: 12345,
  paidHoursSoFar: 7.5,
  nextShift: nextBase,
  nextPayDay: {
    date: '2026-11-06',
    daysAway: 4,
    period: { start: '2026-10-25', end: '2026-10-31' },
    expectedPence: 48000,
  },
};

describe('date formatting', () => {
  it('formats short and day dates', () => {
    expect(formatShortDate('2026-11-01')).toBe('1 Nov');
    expect(formatDayDate('2026-11-03')).toBe('Tue 3 Nov');
    expect(formatDayDate('2026-11-06')).toBe('Fri 6 Nov');
  });
});

describe('nextShiftWhen', () => {
  const today = '2026-11-02';

  it('says Tonight for an evening start today (GMT)', () => {
    const next = { ...nextBase, shift: shift('2026-11-02T19:00:00.000Z', '2026-11-03T07:00:00.000Z') };
    expect(nextShiftWhen(next, today)).toBe('Tonight 19:00–07:00');
  });

  it('says Today for a daytime start today', () => {
    const next = { ...nextBase, shift: shift('2026-11-02T09:00:00.000Z', '2026-11-02T17:00:00.000Z') };
    expect(nextShiftWhen(next, today)).toBe('Today 09:00–17:00');
  });

  it('says Tomorrow for a start tomorrow', () => {
    const next = { ...nextBase, shift: shift('2026-11-03T08:00:00.000Z', '2026-11-03T16:00:00.000Z') };
    expect(nextShiftWhen(next, today)).toBe('Tomorrow 08:00–16:00');
  });

  it('names the day for a later start', () => {
    const next = { ...nextBase, shift: shift('2026-11-05T08:00:00.000Z', '2026-11-05T16:00:00.000Z') };
    expect(nextShiftWhen(next, today)).toBe('Thu 5 Nov 08:00–16:00');
  });

  it('says On now with the end time for a shift in progress', () => {
    const next = {
      ...nextBase,
      inProgress: true,
      shift: shift('2026-11-01T19:00:00.000Z', '2026-11-02T07:00:00.000Z'),
    };
    expect(nextShiftWhen(next, today)).toBe('On now, ends 07:00');
  });

  it('shows London wall-clock times in BST', () => {
    // 18:00Z on 15 Jun is 19:00 BST.
    const next = { ...nextBase, shift: shift('2026-06-15T18:00:00.000Z', '2026-06-16T06:00:00.000Z') };
    expect(nextShiftWhen(next, '2026-06-15')).toBe('Tonight 19:00–07:00');
  });

  it('handles a night shift across the BST to GMT change', () => {
    // Starts 19:00 BST on Sat 24 Oct 2026, clocks go back overnight, ends 07:00 GMT on 25 Oct.
    const next = { ...nextBase, shift: shift('2026-10-24T18:00:00.000Z', '2026-10-25T07:00:00.000Z') };
    expect(nextShiftWhen(next, '2026-10-24')).toBe('Tonight 19:00–07:00');
    expect(nextShiftWhen(next, '2026-10-23')).toBe('Tomorrow 19:00–07:00');
    expect(nextShiftWhen({ ...next, inProgress: true }, '2026-10-25')).toBe('On now, ends 07:00');
  });

  it('uses the London start date, not the UTC one, near midnight in BST', () => {
    // 23:30Z on 15 Jun is 00:30 BST on 16 Jun.
    const next = { ...nextBase, shift: shift('2026-06-15T23:30:00.000Z', '2026-06-16T07:30:00.000Z') };
    expect(nextShiftWhen(next, '2026-06-15')).toBe('Tomorrow 00:30–08:30');
  });
});

describe('payDayCountdown', () => {
  const payDay = summary.nextPayDay;

  it('says today, tomorrow, or the days and date', () => {
    expect(payDayCountdown({ ...payDay, daysAway: 0, date: '2026-11-02' })).toBe('Pay day today');
    expect(payDayCountdown({ ...payDay, daysAway: 1, date: '2026-11-03' })).toBe('Pay day tomorrow');
    expect(payDayCountdown({ ...payDay, daysAway: 4 })).toBe('Pay day in 4 days · Fri 6 Nov');
  });
});

describe('homeView', () => {
  it('formats the whole summary', () => {
    expect(homeView(summary)).toEqual({
      periodLine: '1 Nov – 7 Nov',
      projectedLine: 'Projected for this period £512.40',
      nextShift: { when: 'Tonight 19:00–07:00', pay: '£150.75' },
      payDay: { countdown: 'Pay day in 4 days · Fri 6 Nov', pay: '£480.00' },
    });
  });

  it('has no next shift when the summary has none', () => {
    expect(homeView({ ...summary, nextShift: null }).nextShift).toBeNull();
  });
});
