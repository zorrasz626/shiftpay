/**
 * @jest-environment node
 */
/**
 * Performance on two years of history (PLAN 7.4). Budgets are generous so
 * they hold on a slow CI box; each one is many times the time measured locally.
 */
import type Database from 'better-sqlite3';

import snapshot from '../../config/bankHolidays.json';
import { createBankHolidayLookup } from '../../engine/bankHolidays';
import { calendarMonth } from '../../engine/calendarMonth';
import { holidaySummary, holidayYearRange } from '../../engine/holiday';
import { homeSummary } from '../../engine/homeSummary';
import { periodContaining } from '../../engine/payPeriods';
import { payPeriodList, periodDetail } from '../../engine/periodList';
import { monthlyStats } from '../../engine/stats';
import { addLocalDays, localToInstant } from '../../engine/time';
import type { BankHolidayData } from '../../engine/types';
import { materialiseShifts, materialiseWindow } from '../../services/materialise';
import { exportBackup } from '../backup';
import type { AppDb } from '../jobRepo';
import { listShifts } from '../shiftRepo';
import { createTestDb } from '../testDb';
import { buildTwoYears, seedTwoYears } from '../twoYearsFixture';

const TODAY = '2026-11-01';
const NOW = localToInstant(TODAY, '12:00');
const bankHolidays = createBankHolidayLookup(snapshot as BankHolidayData);
const fixture = buildTwoYears(TODAY);
const [main] = fixture.jobs;
const mainShifts = fixture.shifts.filter((s) => s.jobId === main.id);
const window = materialiseWindow(TODAY);
const windowShifts = fixture.shifts.filter((s) => s.date >= window.start && s.date <= window.end);

/** Measured timings, logged once at the end (hidden by `jest --silent`). */
const measured: Record<string, string> = {};
afterAll(() => console.log(`two-year timings (ms): ${JSON.stringify(measured)}`));

/** Best of `runs` timings in ms (after one warm-up run), recorded under `label`. */
async function timeMs(label: string, fn: () => unknown, runs = 3): Promise<number> {
  await fn();
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn();
    best = Math.min(best, performance.now() - t0);
  }
  measured[label] = best.toFixed(1);
  return best;
}

function clientOf(db: AppDb): Database.Database {
  return (db as unknown as { $client: Database.Database }).$client;
}

describe('two-year fixture', () => {
  it('has about two years of shifts, overtime, cancellations, holidays and 24 payslips', () => {
    const history = fixture.shifts.filter((s) => s.date < TODAY);
    expect(history.length).toBeGreaterThanOrEqual(700);
    const overtime = fixture.shifts.filter((s) => s.overtimeFlag).length;
    expect(overtime / mainShifts.length).toBeGreaterThan(0.08);
    expect(overtime / mainShifts.length).toBeLessThan(0.15);
    expect(fixture.shifts.some((s) => s.status === 'cancelled')).toBe(true);
    expect(fixture.shifts.some((s) => s.status === 'sick')).toBe(true);
    expect(fixture.shifts.filter((s) => s.status === 'holiday').length).toBeGreaterThanOrEqual(16);
    expect(fixture.payslips).toHaveLength(24);
    expect(new Set(fixture.shifts.map((s) => s.id)).size).toBe(fixture.shifts.length);
  });
});

describe('shift queries on two years of data', () => {
  let db: AppDb;

  beforeAll(async () => {
    db = createTestDb();
    await seedTwoYears(db, fixture);
  });

  /** SQL and params of the statement `listShifts` runs. */
  async function capture(jobId?: string): Promise<{ sql: string; plan: string }> {
    const client = clientOf(db);
    const prepare = client.prepare.bind(client);
    const seen: string[] = [];
    const spy = jest.spyOn(client, 'prepare').mockImplementation((sql: string) => {
      seen.push(sql);
      return prepare(sql);
    });
    await listShifts(db, '2026-06-01', '2026-06-30', jobId);
    spy.mockRestore();
    const sql = seen.find((s) => s.includes('from "shifts"')) as string;
    const params =
      jobId === undefined ? ['2026-06-01', '2026-06-30'] : ['2026-06-01', '2026-06-30', jobId];
    const rows = client.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[];
    return { sql, plan: rows.map((r) => r.detail).join('\n') };
  }

  it('one month across all jobs uses the date index', async () => {
    const { plan } = await capture();
    expect(plan).toMatch(/SEARCH shifts USING INDEX shifts_date_idx \(date>\? AND date<\?\)/);
    expect(plan).not.toMatch(/SCAN shifts/);
  });

  it('one month for one job uses the job/date index', async () => {
    const { plan } = await capture(main.id);
    expect(plan).toMatch(
      /SEARCH shifts USING INDEX shifts_job_id_date_idx \(job_id=\? AND date>\? AND date<\?\)/,
    );
  });

  it('one month < 50 ms; the store window < 100 ms; a holiday year < 100 ms', async () => {
    const month = await timeMs('month', () => listShifts(db, '2026-06-01', '2026-06-30'));
    const store = await timeMs('store window', () => listShifts(db, window.start, window.end));
    const year = holidayYearRange(main, TODAY);
    const holidayYear = await timeMs('holiday year query', () =>
      listShifts(db, year.start, year.end, main.id),
    );
    expect(month).toBeLessThan(50);
    expect(store).toBeLessThan(100);
    expect(holidayYear).toBeLessThan(100);
  });

  it('materialising over two years of history < 500 ms and leaves the history alone', async () => {
    const before = (await listShifts(db, '2000-01-01', '2100-01-01')).length;
    const ms = await timeMs('materialise', () => materialiseShifts(db, TODAY));
    expect(ms).toBeLessThan(500);
    expect((await listShifts(db, '2000-01-01', '2100-01-01')).length).toBe(before);
  });

  it('backup export of two years < 500 ms', async () => {
    let rows = 0;
    const ms = await timeMs('backup export', async () => {
      rows = (await exportBackup(db, NOW)).tables.shifts.length;
    });
    expect(rows).toBe(fixture.shifts.length);
    expect(ms).toBeLessThan(500);
  });
});

describe('screen derivations on two years of data', () => {
  const rules = fixture.rules;

  it('Stats: 12 months < 200 ms, 24 months < 400 ms', async () => {
    const twelve = await timeMs('stats 12 months', () =>
      monthlyStats({
        shifts: mainShifts,
        job: main,
        rules,
        bankHolidays,
        from: '2025-11',
        to: '2026-10',
        now: NOW,
      }),
    );
    const all = await timeMs('stats 24 months', () =>
      monthlyStats({
        shifts: mainShifts,
        job: main,
        rules,
        bankHolidays,
        from: '2024-11',
        to: '2026-10',
        now: NOW,
      }),
    );
    const stats = monthlyStats({
      shifts: mainShifts,
      job: main,
      rules,
      bankHolidays,
      from: '2024-11',
      to: '2026-10',
      now: NOW,
    });
    expect(stats.months).toHaveLength(24);
    expect(stats.hasData).toBe(true);
    // Measured ~50 / ~100 ms alone, ~200 ms under parallel suites; the
    // regression this guards against took 1181 / 2320 ms.
    expect(twelve).toBeLessThan(500);
    expect(all).toBeLessThan(1000);
  });

  it('Calendar: every month of the window < 100 ms in total', async () => {
    const months: { year: number; month: number }[] = [];
    for (
      let d = `${window.start.slice(0, 7)}-01`;
      d <= window.end;
      d = addLocalDays(d, 32).slice(0, 8) + '01'
    ) {
      months.push({ year: Number(d.slice(0, 4)), month: Number(d.slice(5, 7)) });
    }
    const ms = await timeMs('calendar all months', () =>
      months.map((m) =>
        calendarMonth({
          ...m,
          shifts: windowShifts,
          bankHolidays,
          region: main.bankHolidayRegion,
          today: TODAY,
        }),
      ),
    );
    expect(months.length).toBeGreaterThanOrEqual(7);
    expect(ms).toBeLessThan(100);
  });

  it('Home, Pay and period detail on the store window < 100 ms each', async () => {
    const shifts = windowShifts.filter((s) => s.jobId === main.id);
    const home = await timeMs('home', () =>
      homeSummary({ shifts, job: main, rules, bankHolidays, now: NOW }),
    );
    let rows = 0;
    const pay = await timeMs('pay list', () => {
      rows = payPeriodList({
        shifts,
        job: main,
        rules,
        bankHolidays,
        range: window,
        today: TODAY,
      }).length;
    });
    const period = periodContaining(TODAY, main);
    let detailRows = 0;
    const detail = await timeMs('period detail', () => {
      detailRows = periodDetail({ shifts, job: main, rules, bankHolidays, period }).shifts.length;
    });
    // Lists stay short enough to render without virtualisation.
    expect(rows).toBeLessThan(100);
    expect(detailRows).toBeLessThan(100);
    expect(home).toBeLessThan(100);
    expect(pay).toBeLessThan(100);
    expect(detail).toBeLessThan(100);
  });

  it('Holiday: a full holiday year < 100 ms', async () => {
    const year = holidayYearRange(main, TODAY);
    const shifts = mainShifts.filter((s) => s.date >= year.start && s.date <= year.end);
    const ms = await timeMs('holiday summary', () => holidaySummary(main, shifts, TODAY));
    expect(ms).toBeLessThan(100);
  });
});
