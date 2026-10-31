import snapshot from '../../config/bankHolidays.json';
import { createBankHolidayLookup } from '../bankHolidays';
import { homeSummary } from '../homeSummary';
import type { BankHolidayData, IsoInstant, Job, LocalDate, PremiumRule, Shift, ShiftStatus } from '../types';

const bankHolidays = createBankHolidayLookup(snapshot as BankHolidayData);

/** Weekly, Monday-Sunday periods (5 Jan 2026 is a Monday), paid the Friday after (end + 5). */
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

const night: PremiumRule = {
  id: 'night',
  jobId: 'j1',
  name: 'Nights',
  priority: 0,
  stacking: 'highest_only',
  multiplier: 1.25,
  type: 'time_band',
  startTime: '22:00',
  endTime: '06:00',
};
const rules = [night];

function shift(
  id: string,
  date: LocalDate,
  start: IsoInstant,
  end: IsoInstant,
  status: ShiftStatus = 'planned',
  jobId = 'j1',
): Shift {
  return { id, jobId, date, start, end, unpaidBreakMinutes: 0, source: 'manual', status, overtimeFlag: false };
}

// Late Oct 2026 is after the BST -> GMT change (Sun 25 Oct), so London = UTC here.
// Base 1200p/h; night band 22:00-06:00 pays 1500p/h.
const prevSat = shift('prev', '2026-10-24', '2026-10-24T09:00:00.000Z', '2026-10-24T17:00:00.000Z'); // 8h base: 9600
const monDay = shift('mon', '2026-10-26', '2026-10-26T09:00:00.000Z', '2026-10-26T17:00:00.000Z'); // 9600
const tueNight = shift('tue', '2026-10-27', '2026-10-27T20:00:00.000Z', '2026-10-28T04:00:00.000Z'); // 2h base + 6h night: 2400 + 9000 = 11400
const wedDay = shift('wed', '2026-10-28', '2026-10-28T09:00:00.000Z', '2026-10-28T17:00:00.000Z'); // 9600
const thuCancelled = shift('thu', '2026-10-29', '2026-10-29T09:00:00.000Z', '2026-10-29T17:00:00.000Z', 'cancelled'); // 0
const friNight = shift('fri', '2026-10-30', '2026-10-30T22:00:00.000Z', '2026-10-31T06:00:00.000Z'); // 8h night: 12000
const otherJob = shift('other', '2026-10-28', '2026-10-28T15:00:00.000Z', '2026-10-28T20:00:00.000Z', 'planned', 'j2');
const all = [friNight, thuCancelled, wedDay, tueNight, monDay, prevSat, otherJob];

const summary = (now: IsoInstant, shifts: Shift[] = all, j: Job = job) =>
  homeSummary({ shifts, job: j, rules, bankHolidays, now });

describe('homeSummary: this period', () => {
  it('earned so far, projected, next shift and pay day for a seeded week', () => {
    // Wed 28 Oct 14:00: Mon and Tue have ended, Wed is in progress, Thu cancelled, Fri ahead.
    const s = summary('2026-10-28T14:00:00.000Z');
    expect(s.today).toBe('2026-10-28');
    expect(s.period).toEqual({ start: '2026-10-26', end: '2026-11-01' });
    expect(s.earnedSoFarPence).toBe(9600 + 11400);
    expect(s.paidHoursSoFar).toBe(16);
    expect(s.projectedPence).toBe(9600 + 11400 + 9600 + 0 + 12000);
    expect(s.nextShift).toEqual({ shift: wedDay, inProgress: true, totalGrossPence: 9600 });
    // The previous period (19-25 Oct) still pays on Fri 30 Oct.
    expect(s.nextPayDay).toEqual({
      date: '2026-10-30',
      daysAway: 2,
      period: { start: '2026-10-19', end: '2026-10-25' },
      expectedPence: 9600,
    });
  });

  it('a shift counts as earned from the instant it ends', () => {
    const s = summary('2026-10-28T17:00:00.000Z');
    expect(s.earnedSoFarPence).toBe(9600 + 11400 + 9600);
    expect(s.paidHoursSoFar).toBe(24);
    // Thu is cancelled, so Fri is next and not yet started.
    expect(s.nextShift).toEqual({ shift: friNight, inProgress: false, totalGrossPence: 12000 });
  });

  it('compares instants, not strings of different ISO formats', () => {
    // No milliseconds and an explicit offset: same instant as 17:00:00.000Z.
    expect(summary('2026-10-28T17:00:00+00:00').earnedSoFarPence).toBe(9600 + 11400 + 9600);
    expect(summary('2026-10-28T16:59:59Z').earnedSoFarPence).toBe(9600 + 11400);
  });

  it('no shifts: zeros and no next shift', () => {
    const s = summary('2026-10-28T14:00:00.000Z', []);
    expect(s.earnedSoFarPence).toBe(0);
    expect(s.paidHoursSoFar).toBe(0);
    expect(s.projectedPence).toBe(0);
    expect(s.nextShift).toBeNull();
    expect(s.nextPayDay.expectedPence).toBe(0);
  });
});

describe('homeSummary: next shift', () => {
  it('skips cancelled, sick and holiday shifts and other jobs', () => {
    const shifts = [
      shift('sick', '2026-10-29', '2026-10-29T09:00:00.000Z', '2026-10-29T17:00:00.000Z', 'sick'),
      shift('hol', '2026-10-30', '2026-10-30T09:00:00.000Z', '2026-10-30T17:00:00.000Z', 'holiday'),
      shift('can', '2026-10-30', '2026-10-30T12:00:00.000Z', '2026-10-30T18:00:00.000Z', 'cancelled'),
      shift('j2', '2026-10-30', '2026-10-30T13:00:00.000Z', '2026-10-30T18:00:00.000Z', 'planned', 'j2'),
      friNight,
    ];
    const s = summary('2026-10-28T20:00:00.000Z', shifts);
    expect(s.nextShift?.shift.id).toBe('fri');
    // Sick/holiday pay base only; cancelled earns 0.
    expect(s.projectedPence).toBe(9600 + 9600 + 0 + 12000);
  });

  it('a worked shift still in progress can be next; none left means null', () => {
    const worked = shift('w', '2026-10-28', '2026-10-28T09:00:00.000Z', '2026-10-28T17:00:00.000Z', 'worked');
    expect(summary('2026-10-28T10:00:00.000Z', [worked]).nextShift).toEqual({
      shift: worked,
      inProgress: true,
      totalGrossPence: 9600,
    });
    expect(summary('2026-10-28T17:00:00.000Z', [worked]).nextShift).toBeNull();
  });

  it('a next shift in a later period is priced in its own period, with weekly OT from earlier shifts', () => {
    const weeklyOt: PremiumRule = {
      id: 'ot',
      jobId: 'j1',
      name: 'Weekly OT',
      priority: 0,
      stacking: 'highest_only',
      multiplier: 1.5,
      type: 'overtime_weekly',
      thresholdHours: 16,
    };
    const day = (id: string, date: LocalDate) => shift(id, date, `${date}T09:00:00.000Z`, `${date}T17:00:00.000Z`);
    const shifts = [day('m', '2026-11-02'), day('t', '2026-11-03'), day('w', '2026-11-04')];
    // Sun 1 Nov: the next shift is Mon 2 Nov (next period), straight time.
    const sunday = homeSummary({ shifts, job, rules: [weeklyOt], bankHolidays, now: '2026-11-01T12:00:00.000Z' });
    expect(sunday.nextShift).toEqual({ shift: shifts[0], inProgress: false, totalGrossPence: 9600 });
    expect(sunday.projectedPence).toBe(0);
    // Tue 3 Nov evening: Wed is all over the 16h weekly threshold: 8h x 1800.
    const tuesday = homeSummary({ shifts, job, rules: [weeklyOt], bankHolidays, now: '2026-11-03T18:00:00.000Z' });
    expect(tuesday.nextShift).toEqual({ shift: shifts[2], inProgress: false, totalGrossPence: 14400 });
  });
});

describe('homeSummary: pay day', () => {
  it('weekly: the previous period while its pay date is still ahead, 0 days on pay day, then the current one', () => {
    // Tue 3 Nov: the 26 Oct - 1 Nov period still pays Fri 6 Nov.
    expect(summary('2026-11-03T08:00:00.000Z').nextPayDay).toEqual({
      date: '2026-11-06',
      daysAway: 3,
      period: { start: '2026-10-26', end: '2026-11-01' },
      expectedPence: 9600 + 11400 + 9600 + 12000,
    });
    expect(summary('2026-10-30T10:00:00.000Z').nextPayDay).toMatchObject({ date: '2026-10-30', daysAway: 0 });
    // Sat 31 Oct: the 30 Oct pay day has passed, so the current period's Fri 6 Nov.
    expect(summary('2026-10-31T10:00:00.000Z').nextPayDay).toEqual({
      date: '2026-11-06',
      daysAway: 6,
      period: { start: '2026-10-26', end: '2026-11-01' },
      expectedPence: 9600 + 11400 + 9600 + 12000,
    });
  });

  it('monthly: cut-off + offset', () => {
    // Periods end on the 20th; paid 8 days later.
    const monthly: Job = { ...job, payFrequency: 'monthly', periodCutoffDay: 20, payDayOffsetDays: 8 };
    const shifts = [shift('oct', '2026-10-15', '2026-10-15T09:00:00.000Z', '2026-10-15T17:00:00.000Z')];
    // Sun 25 Oct (current period 21 Oct - 20 Nov): 21 Sep - 20 Oct still pays 28 Oct.
    expect(summary('2026-10-25T12:00:00.000Z', shifts, monthly).nextPayDay).toEqual({
      date: '2026-10-28',
      daysAway: 3,
      period: { start: '2026-09-21', end: '2026-10-20' },
      expectedPence: 9600,
    });
    expect(summary('2026-10-28T23:59:00.000Z', shifts, monthly).nextPayDay).toMatchObject({ date: '2026-10-28', daysAway: 0 });
    expect(summary('2026-10-29T00:00:00.000Z', shifts, monthly).nextPayDay).toEqual({
      date: '2026-11-28',
      daysAway: 30,
      period: { start: '2026-10-21', end: '2026-11-20' },
      expectedPence: 0,
    });
  });

  it('monthly: cut-off 31 clamps to the month length', () => {
    const monthEnd: Job = { ...job, payFrequency: 'monthly', periodCutoffDay: 31, payDayOffsetDays: 0 };
    const s = summary('2026-02-27T12:00:00.000Z', [], monthEnd);
    expect(s.period).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(s.nextPayDay).toMatchObject({ date: '2026-02-28', daysAway: 1 });
  });
});

describe('homeSummary: BST change', () => {
  // Sat 24 Oct 22:00 BST (21:00Z) to Sun 25 Oct 01:30 GMT (01:30Z): 4.5 real hours, all in the night band.
  const overChange = shift('bst', '2026-10-24', '2026-10-24T21:00:00.000Z', '2026-10-25T01:30:00.000Z');

  it('not earned while in progress, even when the local clock already reads later than the end time', () => {
    // 01:45 BST (00:45Z) is before 01:30 GMT.
    const s = summary('2026-10-25T00:45:00.000Z', [overChange]);
    expect(s.today).toBe('2026-10-25');
    expect(s.period).toEqual({ start: '2026-10-19', end: '2026-10-25' });
    expect(s.earnedSoFarPence).toBe(0);
    expect(s.projectedPence).toBe(6750);
    expect(s.nextShift).toMatchObject({ inProgress: true, totalGrossPence: 6750 });
  });

  it('earned once the real end instant has passed', () => {
    const s = summary('2026-10-25T01:30:00.000Z', [overChange]);
    expect(s.earnedSoFarPence).toBe(6750);
    expect(s.paidHoursSoFar).toBe(4.5);
    expect(s.nextShift).toBeNull();
  });
});
