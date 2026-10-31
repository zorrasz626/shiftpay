import snapshot from '../../config/bankHolidays.json';
import { createBankHolidayLookup } from '../bankHolidays';
import { sumPence } from '../money';
import { periodContaining } from '../payPeriods';
import { calculateShifts } from '../shiftPay';
import { shiftDetail } from '../shiftDetail';
import type { ShiftDetail } from '../shiftDetail';
import type {
  BankHolidayData,
  IsoInstant,
  Job,
  LocalDate,
  OvertimePremiumMode,
  PremiumRule,
  Shift,
  ShiftStatus,
} from '../types';

const bankHolidays = createBankHolidayLookup(snapshot as BankHolidayData);

/** Weekly, Monday-Sunday periods (5 Jan 2026 is a Monday). Base 1200p/h. */
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
/** Bank holidays, +600p/h. */
const bankHoliday: PremiumRule = {
  ...common,
  id: 'bh',
  name: 'Bank holiday',
  stacking: 'highest_only',
  multiplier: 1.5,
  type: 'bank_holiday',
};
/** Beyond 8h a shift, +100p/h (less than Sunday's +200). */
const dailyOt: PremiumRule = {
  ...common,
  id: 'ot-daily',
  name: 'Overtime',
  stacking: 'highest_only',
  flatAddPencePerHour: 100,
  type: 'overtime_daily',
  thresholdHours: 8,
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
/** Another job's rule: never applied or listed. */
const otherJobRule: PremiumRule = { ...sunday, id: 'other-sunday', jobId: 'j2', name: 'Other' };

function shift(
  id: string,
  date: LocalDate,
  start: IsoInstant,
  end: IsoInstant,
  extra: { status?: ShiftStatus; overtimeFlag?: boolean; jobId?: string } = {},
): Shift {
  return {
    id,
    jobId: extra.jobId ?? 'j1',
    date,
    start,
    end,
    unpaidBreakMinutes: 0,
    source: 'manual',
    status: extra.status ?? 'planned',
    overtimeFlag: extra.overtimeFlag ?? false,
  };
}

/** The detail, checked against the engine: lines sum to the total, which equals calculateShifts. */
function detail(
  target: Shift,
  rules: PremiumRule[],
  shifts: Shift[] = [target],
  j: Job = job,
): ShiftDetail {
  const d = shiftDetail({ shift: target, shifts, job: j, rules, bankHolidays });
  expect(sumPence(d.lines.map((l) => l.pence))).toBe(d.totalGrossPence);
  expect(Number.isInteger(d.totalGrossPence)).toBe(true);
  const engine = calculateShifts(
    shifts,
    j,
    rules,
    bankHolidays,
    periodContaining(target.date, j),
  ).find((b) => b.shiftId === target.id);
  expect(d.totalGrossPence).toBe(engine?.totalGrossPence);
  expect(sumPence(d.slices.map((s) => s.totalPence))).toBe(d.totalGrossPence);
  return d;
}

const lines = (d: ShiftDetail) =>
  d.lines.map(({ label, kind, hours, pence }) => [label, kind, hours, pence]);
const sliceRows = (d: ShiftDetail) =>
  d.slices.map((s) => [s.localStart, s.localEnd, s.paidMinutes, s.labels]);

// Late Oct / Nov 2026 is after the BST -> GMT change (Sun 25 Oct), so London = UTC.
const tueDay = shift('tue', '2026-10-27', '2026-10-27T09:00:00.000Z', '2026-10-27T17:00:00.000Z');
const sunLong = shift(
  'sun-long',
  '2026-11-01',
  '2026-11-01T08:00:00.000Z',
  '2026-11-01T18:00:00.000Z',
);
const sunShort = shift(
  'sun-short',
  '2026-11-01',
  '2026-11-01T09:00:00.000Z',
  '2026-11-01T13:00:00.000Z',
  {
    overtimeFlag: true,
  },
);
const sunNight = shift(
  'sun-night',
  '2026-11-01',
  '2026-11-01T20:00:00.000Z',
  '2026-11-02T04:00:00.000Z',
);

describe('shiftDetail', () => {
  it('day shift: base only', () => {
    const d = detail(tueDay, [night, sunday, bankHoliday, otherJobRule]);
    expect(d.totalGrossPence).toBe(9600);
    expect(d.paidHours).toBe(8);
    expect(lines(d)).toEqual([['Base', 'base', 8, 9600]]);
    expect(d.lines[0].key).toBe('base');
    expect(d.slices).toEqual([
      {
        start: '2026-10-27T09:00:00.000Z',
        end: '2026-10-27T17:00:00.000Z',
        localStart: '09:00',
        localEnd: '17:00',
        paidMinutes: 480,
        labels: [],
        totalPence: 9600,
      },
    ]);
  });

  it('Sunday night across midnight: base + night + Sunday', () => {
    const d = detail(sunNight, [night, sunday, otherJobRule]);
    // Base 8h 9600; night 22:00-04:00 6h x 300 = 1800; Sunday 20:00-24:00 4h x 200 = 800.
    expect(lines(d)).toEqual([
      ['Base', 'base', 8, 9600],
      ['Night', 'premium', 6, 1800],
      ['Sunday', 'premium', 4, 800],
    ]);
    expect(d.lines.map((l) => l.key)).toEqual(['base', 'premium:night', 'premium:sunday']);
    expect(d.totalGrossPence).toBe(12200);
    expect(sliceRows(d)).toEqual([
      ['20:00', '22:00', 120, ['Sunday']],
      ['22:00', '00:00', 120, ['Night', 'Sunday']],
      ['00:00', '04:00', 240, ['Night']],
    ]);
  });

  it('bank holiday', () => {
    const xmas = shift(
      'xmas',
      '2026-12-25',
      '2026-12-25T09:00:00.000Z',
      '2026-12-25T17:00:00.000Z',
    );
    const d = detail(xmas, [night, sunday, bankHoliday]);
    expect(lines(d)).toEqual([
      ['Base', 'base', 8, 9600],
      ['Bank holiday', 'premium', 8, 4800],
    ]);
    expect(d.totalGrossPence).toBe(14400);
  });

  // Sun 08:00-18:00 (10h): the last 2h are daily OT (+100) on top of Sunday (+200).
  it.each([
    [
      'replace',
      [
        ['Base', 'base', 10, 12000],
        ['Sunday', 'premium', 8, 1600],
        ['Overtime', 'overtime', 2, 200],
      ],
      [['Sunday'], ['Overtime']],
      13800,
    ],
    [
      'highest',
      [
        ['Base', 'base', 10, 12000],
        ['Sunday', 'premium', 10, 2000],
      ],
      [['Sunday'], ['Sunday']],
      14000,
    ],
    [
      'stack',
      [
        ['Base', 'base', 10, 12000],
        ['Sunday', 'premium', 10, 2000],
        ['Overtime', 'overtime', 2, 200],
      ],
      [['Sunday'], ['Sunday', 'Overtime']],
      14200,
    ],
  ] as const)('daily OT in %s mode', (mode, expected, labels, total) => {
    const d = detail(sunLong, [sunday, dailyOt], [sunLong], withMode(mode));
    expect(lines(d)).toEqual(expected);
    expect(d.slices.map((s) => s.labels)).toEqual(labels);
    expect(d.slices.map((s) => [s.localStart, s.localEnd])).toEqual([
      ['08:00', '16:00'],
      ['16:00', '18:00'],
    ]);
    expect(d.totalGrossPence).toBe(total);
  });

  // Sun 09:00-13:00 (4h) flagged as OT: every paid minute is OT (+100) vs Sunday (+200).
  it.each([
    [
      'replace',
      [
        ['Base', 'base', 4, 4800],
        ['Overtime', 'overtime', 4, 400],
      ],
      5200,
    ],
    [
      'highest',
      [
        ['Base', 'base', 4, 4800],
        ['Sunday', 'premium', 4, 800],
      ],
      5600,
    ],
    [
      'stack',
      [
        ['Base', 'base', 4, 4800],
        ['Sunday', 'premium', 4, 800],
        ['Overtime', 'overtime', 4, 400],
      ],
      6000,
    ],
  ] as const)('flagged OT in %s mode', (mode, expected, total) => {
    const d = detail(sunShort, [sunday, dailyOt], [sunShort], withMode(mode));
    expect(lines(d)).toEqual(expected);
    expect(d.totalGrossPence).toBe(total);
  });

  it('weekly OT from the other shifts in the week', () => {
    const prevSun = shift(
      'prev-sun',
      '2026-10-25',
      '2026-10-25T09:00:00.000Z',
      '2026-10-25T17:00:00.000Z',
    );
    const mon = shift('mon', '2026-10-26', '2026-10-26T09:00:00.000Z', '2026-10-26T17:00:00.000Z');
    const wed = shift('wed', '2026-10-28', '2026-10-28T09:00:00.000Z', '2026-10-28T17:00:00.000Z');
    const thuCancelled = shift(
      'thu',
      '2026-10-29',
      '2026-10-29T09:00:00.000Z',
      '2026-10-29T17:00:00.000Z',
      {
        status: 'cancelled',
      },
    );
    const all = [prevSun, mon, tueDay, wed, thuCancelled];
    const rules = [weeklyOt];

    // Mon + Tue = 16h reach the threshold; all of Wednesday is OT (+600/h).
    const w = detail(wed, rules, all);
    expect(lines(w)).toEqual([
      ['Base', 'base', 8, 9600],
      ['Weekly overtime', 'overtime', 8, 4800],
    ]);
    expect(w.lines[1].key).toBe('overtime:ot-weekly');
    expect(w.slices.map((s) => s.labels)).toEqual([['Weekly overtime']]);
    expect(lines(detail(tueDay, rules, all))).toEqual([['Base', 'base', 8, 9600]]);
    // Without the rest of the week there is no OT.
    expect(lines(detail(wed, rules, [wed]))).toEqual([['Base', 'base', 8, 9600]]);
  });

  it.each(['sick', 'holiday'] as const)('%s: base only, even when flagged as OT', (status) => {
    const s = { ...sunNight, status, overtimeFlag: true };
    const d = detail(s, [night, sunday, dailyOt], [s], withMode('stack'));
    expect(lines(d)).toEqual([['Base', 'base', 8, 9600]]);
    expect(d.slices.every((x) => x.labels.length === 0)).toBe(true);
  });

  it('cancelled: no lines, no slices, 0', () => {
    const s = { ...sunNight, status: 'cancelled' as const };
    const d = detail(s, [night, sunday, dailyOt]);
    expect(d).toEqual({ totalGrossPence: 0, paidHours: 0, lines: [], slices: [] });
  });

  it('night into 25 Oct 2026 (clocks go back): 13h paid', () => {
    // Sat 24 Oct 20:00 BST -> Sun 25 Oct 08:00 GMT.
    const s = shift('dst', '2026-10-24', '2026-10-24T19:00:00.000Z', '2026-10-25T08:00:00.000Z');
    const d = detail(s, [night, sunday]);
    expect(d.paidHours).toBe(13);
    // Night 22:00-06:00 = 9h real time (01:00-02:00 happens twice); Sunday 00:00-08:00 = 9h.
    expect(lines(d)).toEqual([
      ['Base', 'base', 13, 15600],
      ['Night', 'premium', 9, 2700],
      ['Sunday', 'premium', 9, 1800],
    ]);
    expect(d.totalGrossPence).toBe(20100);
    expect(d.slices[0].localStart).toBe('20:00');
    expect(d.slices[d.slices.length - 1].localEnd).toBe('08:00');
    expect(d.slices.reduce((acc, x) => acc + x.paidMinutes, 0)).toBe(780);
  });

  it('prices a shift missing from `shifts` as if it were included', () => {
    const d = detail(tueDay, [night], [tueDay]);
    const missing = shiftDetail({ shift: tueDay, shifts: [], job, rules: [night], bankHolidays });
    expect(missing).toEqual(d);
  });

  it("throws for another job's shift", () => {
    const other = { ...tueDay, jobId: 'j2' };
    expect(() =>
      shiftDetail({ shift: other, shifts: [other], job, rules: [], bankHolidays }),
    ).toThrow(/not for job j1/);
  });
});
