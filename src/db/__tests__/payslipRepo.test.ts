/**
 * @jest-environment node
 */
import { sql } from 'drizzle-orm';

import type { Payslip } from '../../engine/types';
import { type AppDb, type StoredJob, createJob } from '../jobRepo';
import {
  createPayslip,
  deletePayslip,
  getPayslip,
  listPayslips,
  updatePayslip,
} from '../payslipRepo';
import { createTestDb } from '../testDb';

const job: StoredJob = {
  id: 'job-1',
  name: 'Warehouse',
  baseRatePence: 1250,
  payFrequency: 'monthly',
  payPeriodAnchorDate: '2026-04-01',
  payDayOffsetDays: 5,
  periodCutoffDay: 31,
  contractedHoursPerWeek: 37.5,
  bankHolidayRegion: 'england-and-wales',
  overtimePremiumMode: 'highest',
  holidayYearStart: '2026-04-01',
  holidayEntitlementHours: 210,
  holidayMode: 'fixed',
};

const full: Payslip = {
  id: 'p-full',
  jobId: 'job-1',
  periodStart: '2026-04-01',
  periodEnd: '2026-04-30',
  grossPaidPence: 215_037,
  hoursPaid: 162.5,
  lines: [
    { label: 'Basic', hours: 150, amountPence: 187_500 },
    { label: 'Nights', hours: 12.5, amountPence: 20_837 },
    { label: 'Bonus', amountPence: 6_700 },
  ],
  taxPence: 25_000,
  niPence: 9_000,
  pensionPence: 6_450,
  netPence: 174_587,
};

const minimal: Payslip = {
  id: 'p-min',
  jobId: 'job-1',
  periodStart: '2026-03-01',
  periodEnd: '2026-03-31',
  grossPaidPence: 100_000,
  taxPence: 0,
  niPence: 0,
  pensionPence: 0,
};

function countLines(db: AppDb): number {
  return db.get<{ n: number }>(sql`select count(*) as n from payslip_lines`).n;
}

function countPayslips(db: AppDb): number {
  return db.get<{ n: number }>(sql`select count(*) as n from payslips`).n;
}

describe('payslipRepo', () => {
  let db: AppDb;

  beforeEach(async () => {
    db = createTestDb();
    await createJob(db, job);
  });

  it('round-trips with lines and every optional field', async () => {
    await createPayslip(db, full);
    const got = await getPayslip(db, 'p-full');
    expect(got).toEqual(full);
    expect(got?.lines?.[2]).not.toHaveProperty('hours');
  });

  it('round-trips without lines or optional fields', async () => {
    await createPayslip(db, minimal);
    await createPayslip(db, { ...minimal, id: 'p-empty', lines: [] });
    const got = await getPayslip(db, 'p-min');
    expect(got).toEqual(minimal);
    for (const key of ['lines', 'hoursPaid', 'netPence']) expect(got).not.toHaveProperty(key);
    expect(await getPayslip(db, 'p-empty')).not.toHaveProperty('lines');
  });

  it('lists a job with lines, newest periodEnd first', async () => {
    await createPayslip(db, minimal);
    await createPayslip(db, full);
    await createPayslip(db, { ...minimal, id: 'p-old', periodEnd: '2026-02-28' });
    const list = await listPayslips(db, 'job-1');
    expect(list.map((p) => p.id)).toEqual(['p-full', 'p-min', 'p-old']);
    expect(list[0]).toEqual(full);
    expect(list[1]).toEqual(minimal);
    expect(await listPayslips(db, 'other')).toEqual([]);
  });

  it('returns undefined for a missing payslip', async () => {
    expect(await getPayslip(db, 'nope')).toBeUndefined();
  });

  it('update replaces fields and lines, and throws for a missing id', async () => {
    await createPayslip(db, full);
    const updated: Payslip = {
      ...minimal,
      id: 'p-full',
      lines: [{ label: 'Holiday', hours: 7.5, amountPence: 9_375 }],
    };
    await updatePayslip(db, updated);
    expect(await getPayslip(db, 'p-full')).toEqual(updated);
    expect(countLines(db)).toBe(1);

    const { lines: _l, ...noLines } = updated;
    await updatePayslip(db, noLines);
    expect(await getPayslip(db, 'p-full')).toEqual(noLines);
    expect(countLines(db)).toBe(0);

    await expect(updatePayslip(db, { ...updated, id: 'nope' })).rejects.toThrow(/nope/);
    expect(countLines(db)).toBe(0);
  });

  it('delete cascades lines', async () => {
    await createPayslip(db, full);
    await deletePayslip(db, 'p-full');
    expect(await getPayslip(db, 'p-full')).toBeUndefined();
    expect(countLines(db)).toBe(0);
  });

  it('a failing line insert leaves no payslip row', async () => {
    const bad = {
      ...full,
      lines: [{ label: 'Basic', amountPence: null as unknown as number }],
    };
    await expect(createPayslip(db, bad)).rejects.toThrow();
    expect(countPayslips(db)).toBe(0);
    expect(countLines(db)).toBe(0);
  });

  it('a failing update keeps the old payslip and lines', async () => {
    await createPayslip(db, full);
    const bad = {
      ...minimal,
      id: 'p-full',
      lines: [{ label: 'Basic', amountPence: null as unknown as number }],
    };
    await expect(updatePayslip(db, bad)).rejects.toThrow();
    expect(await getPayslip(db, 'p-full')).toEqual(full);
  });
});
