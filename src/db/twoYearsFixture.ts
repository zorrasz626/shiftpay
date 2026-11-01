/**
 * Large fixture for the performance tests (PLAN 7.4): two years of history
 * up to `today` plus the materialised future window (+120 days). Two jobs on
 * opposite halves of a 4-on/4-off rota, so about 730 shifts in total; ~10%
 * extra overtime shifts, some cancelled and sick days, two holiday blocks a
 * year and 24 monthly payslips for the main job. Generic names only.
 * Never import this from app code.
 */
import { generateShifts } from '../engine/rota';
import { addLocalDays, localToInstant } from '../engine/time';
import type { LocalDate, Payslip, PremiumRule, RotaPattern } from '../engine/types';
import { type AppDb, type StoredJob, createJob, createPremiumRule } from './jobRepo';
import { createPayslip } from './payslipRepo';
import { type StoredShiftTemplate, createRotaPattern, createShiftTemplate } from './rotaRepo';
import { type StoredShift, createShift, truncateToMinute } from './shiftRepo';

export interface TwoYearsFixture {
  today: LocalDate;
  jobs: StoredJob[];
  rules: PremiumRule[];
  templates: StoredShiftTemplate[];
  patterns: RotaPattern[];
  shifts: StoredShift[];
  payslips: Payslip[];
}

const HISTORY_DAYS = 730;
const FUTURE_DAYS = 120;

const baseJob = {
  payPeriodAnchorDate: '2024-01-01',
  payDayOffsetDays: 0,
  periodCutoffDay: 31,
  bankHolidayRegion: 'england-and-wales',
  overtimePremiumMode: 'highest',
  holidayYearStart: '2026-01-01',
  holidayMode: 'fixed',
} as const;

/** Builds the fixture (pure: `today` is passed in). */
export function buildTwoYears(today: LocalDate): TwoYearsFixture {
  const from = addLocalDays(today, -HISTORY_DAYS);
  const to = addLocalDays(today, FUTURE_DAYS);

  const jobs: StoredJob[] = [
    {
      ...baseJob,
      id: 'job-main',
      name: 'Main job',
      baseRatePence: 1250,
      payFrequency: 'monthly',
      contractedHoursPerWeek: 42,
      holidayEntitlementHours: 224,
    },
    {
      ...baseJob,
      id: 'job-second',
      name: 'Second job',
      baseRatePence: 1100,
      payFrequency: 'weekly',
      contractedHoursPerWeek: 16,
      holidayEntitlementHours: 90,
    },
  ];

  const common = { jobId: 'job-main', stacking: 'highest_only', priority: 0 } as const;
  const rules: PremiumRule[] = [
    {
      ...common,
      id: 'r-night',
      name: 'Nights',
      type: 'time_band',
      startTime: '22:00',
      endTime: '06:00',
      multiplier: 1.25,
    },
    {
      ...common,
      id: 'r-weekend',
      name: 'Weekend',
      type: 'day_of_week',
      daysOfWeek: [0, 6],
      flatAddPencePerHour: 150,
    },
    {
      ...common,
      id: 'r-bank',
      name: 'Bank holiday',
      type: 'bank_holiday',
      multiplier: 2,
      priority: 1,
    },
    {
      ...common,
      id: 'r-ot',
      name: 'Overtime',
      type: 'overtime_weekly',
      thresholdHours: 48,
      multiplier: 1.5,
    },
  ];

  const templates: StoredShiftTemplate[] = [
    {
      id: 't-day',
      jobId: 'job-main',
      name: 'Day',
      startTime: '07:00',
      endTime: '19:00',
      unpaidBreakMinutes: 60,
    },
    {
      id: 't-night',
      jobId: 'job-main',
      name: 'Night',
      startTime: '19:00',
      endTime: '07:00',
      unpaidBreakMinutes: 60,
    },
    {
      id: 't-second',
      jobId: 'job-second',
      name: 'Late',
      startTime: '13:00',
      endTime: '21:00',
      unpaidBreakMinutes: 30,
    },
  ];

  const day = { shiftTemplateId: 't-day' } as const;
  const night = { shiftTemplateId: 't-night' } as const;
  const second = { shiftTemplateId: 't-second' } as const;
  const patterns: RotaPattern[] = [
    {
      id: 'p-main',
      jobId: 'job-main',
      cycleLengthDays: 16,
      startDate: from,
      days: [
        day,
        day,
        day,
        day,
        'OFF',
        'OFF',
        'OFF',
        'OFF',
        night,
        night,
        night,
        night,
        'OFF',
        'OFF',
        'OFF',
        'OFF',
      ],
    },
    {
      id: 'p-second',
      jobId: 'job-second',
      cycleLengthDays: 8,
      startDate: from,
      days: ['OFF', 'OFF', 'OFF', 'OFF', second, second, second, second],
    },
  ];

  const shifts: StoredShift[] = [];
  for (const pattern of patterns) {
    generateShifts(pattern, templates, { start: from, end: to }).forEach((g, i) => {
      const past = g.date < today;
      let status: StoredShift['status'] = past ? 'worked' : 'planned';
      // Two holiday blocks a year (four shifts each), plus cancelled/sick days.
      if (i % 90 < 4) status = 'holiday';
      else if (i % 23 === 7) status = 'cancelled';
      else if (past && i % 41 === 11) status = 'sick';
      shifts.push({
        ...g,
        start: truncateToMinute(g.start),
        end: truncateToMinute(g.end),
        status,
        patternId: pattern.id,
        userModified: status !== 'worked' && status !== 'planned',
      });
    });
  }

  // ~10% overtime: an extra 8h manual shift on the second rest day after
  // every other block of four main-job shifts.
  const mainShifts = shifts.filter((s) => s.jobId === 'job-main');
  for (let i = 3; i < mainShifts.length; i += 8) {
    const date = addLocalDays(mainShifts[i].date, 2);
    shifts.push({
      id: `ot-${date}`,
      jobId: 'job-main',
      date,
      start: localToInstant(date, '08:00'),
      end: localToInstant(date, '16:00'),
      unpaidBreakMinutes: 30,
      source: 'manual',
      status: date < today ? 'worked' : 'planned',
      overtimeFlag: true,
      notes: 'Extra shift',
      userModified: false,
    });
  }

  // 24 monthly payslips for the last 24 complete months.
  const payslips: Payslip[] = [];
  let monthStart: LocalDate = `${today.slice(0, 7)}-01`;
  for (let n = 0; n < 24; n++) {
    const end = addLocalDays(monthStart, -1);
    monthStart = `${end.slice(0, 7)}-01`;
    const gross = 230_000 + n * 1_000;
    payslips.push({
      id: `ps-${monthStart}`,
      jobId: 'job-main',
      periodStart: monthStart,
      periodEnd: end,
      grossPaidPence: gross,
      hoursPaid: 176,
      lines: [
        { label: 'Basic', hours: 168, amountPence: gross - 15_000 },
        { label: 'Night premium', amountPence: 15_000 },
      ],
      taxPence: 25_000,
      niPence: 9_000,
      pensionPence: 6_900,
      netPence: gross - 40_900,
    });
  }

  return { today, jobs, rules, templates, patterns, shifts, payslips };
}

/** Inserts the fixture through the repositories (an empty, migrated db). */
export async function seedTwoYears(db: AppDb, f: TwoYearsFixture): Promise<void> {
  for (const job of f.jobs) await createJob(db, job);
  for (const rule of f.rules) await createPremiumRule(db, rule);
  for (const t of f.templates) await createShiftTemplate(db, t);
  for (const p of f.patterns) await createRotaPattern(db, p);
  for (const s of f.shifts) await createShift(db, s);
  for (const p of f.payslips) await createPayslip(db, p);
}
