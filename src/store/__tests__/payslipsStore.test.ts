/**
 * @jest-environment node
 */
import type { Payslip } from '../../engine/types';
import { type AppDb, createJob } from '../../db/jobRepo';
import { getPayslip } from '../../db/payslipRepo';
import { payslipLines } from '../../db/schema';
import { createTestDb } from '../../db/testDb';
import { payslipForPeriod, usePayslipsStore } from '../payslipsStore';
import { job, resetStores } from '../testFixtures';

const june: Payslip = {
  id: 'p-june',
  jobId: 'job-1',
  periodStart: '2026-06-01',
  periodEnd: '2026-06-07',
  grossPaidPence: 46875,
  hoursPaid: 37.5,
  lines: [
    { label: 'Basic', hours: 30, amountPence: 37500 },
    { label: 'Night premium', amountPence: 9375 },
  ],
  taxPence: 5000,
  niPence: 2000,
  pensionPence: 1000,
  netPence: 38875,
};

const may: Payslip = {
  id: 'p-may',
  jobId: 'job-1',
  periodStart: '2026-05-25',
  periodEnd: '2026-05-31',
  grossPaidPence: 40000,
  taxPence: 4000,
  niPence: 1500,
  pensionPence: 800,
};

const bar: Payslip = {
  id: 'p-bar',
  jobId: 'job-2',
  periodStart: '2026-06-01',
  periodEnd: '2026-06-30',
  grossPaidPence: 120000,
  lines: [{ label: 'Basic', amountPence: 120000 }],
  taxPence: 10000,
  niPence: 6000,
  pensionPence: 3000,
};

describe('usePayslipsStore', () => {
  let db: AppDb;

  beforeEach(async () => {
    db = createTestDb();
    resetStores();
    await createJob(db, job);
    await createJob(db, { ...job, id: 'job-2', name: 'Bar' });
  });

  it('starts empty and not loaded', () => {
    expect(usePayslipsStore.getState()).toMatchObject({ payslips: [], loaded: false });
  });

  it('load reads the payslips (with lines) of every job and sets loaded', async () => {
    await usePayslipsStore.getState().load(db);
    expect(usePayslipsStore.getState()).toMatchObject({ payslips: [], loaded: true });

    const { savePayslip } = usePayslipsStore.getState();
    await savePayslip(db, may);
    await savePayslip(db, bar);
    await savePayslip(db, june);
    resetStores();
    expect(usePayslipsStore.getState().loaded).toBe(false);
    await usePayslipsStore.getState().load(db);
    expect(usePayslipsStore.getState().loaded).toBe(true);
    expect(usePayslipsStore.getState().payslips).toEqual([bar, june, may]); // listJobs orders by name: Bar, then Warehouse
  });

  it('savePayslip creates, then replaces in full by id (lines removed)', async () => {
    const { savePayslip } = usePayslipsStore.getState();
    await savePayslip(db, june);
    expect(usePayslipsStore.getState().payslips).toEqual([june]);

    const edited: Payslip = {
      id: june.id,
      jobId: 'job-1',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-07',
      grossPaidPence: 50000,
      taxPence: 5000,
      niPence: 2000,
      pensionPence: 1000,
      netPence: 42000,
    };
    await savePayslip(db, edited);
    expect(usePayslipsStore.getState().payslips).toEqual([edited]);
    expect(await getPayslip(db, june.id)).toEqual(edited);
    expect(await db.select().from(payslipLines)).toEqual([]);
  });

  it('a second save for the same job and periodStart updates the existing payslip', async () => {
    const { savePayslip } = usePayslipsStore.getState();
    await savePayslip(db, june);
    await savePayslip(db, bar);

    const again: Payslip = {
      ...june,
      id: 'p-new',
      grossPaidPence: 47000,
      lines: [{ label: 'Basic', hours: 37.5, amountPence: 47000 }],
    };
    await savePayslip(db, again);
    const { payslips } = usePayslipsStore.getState();
    expect(payslips).toEqual([bar, { ...again, id: june.id }]);
    expect(await getPayslip(db, 'p-new')).toBeUndefined();
  });

  it('removePayslip deletes the payslip and its lines, then reloads', async () => {
    const { savePayslip, removePayslip } = usePayslipsStore.getState();
    await savePayslip(db, june);
    await savePayslip(db, bar);
    await removePayslip(db, june.id);
    expect(usePayslipsStore.getState().payslips).toEqual([bar]);
    expect(await getPayslip(db, june.id)).toBeUndefined();
    const lines = await db.select().from(payslipLines);
    expect(lines.map((l) => l.payslipId)).toEqual([bar.id]);
  });
});

describe('payslipForPeriod', () => {
  const list = [june, may, bar];

  it('finds the payslip for the job and periodStart', () => {
    expect(payslipForPeriod(list, 'job-1', '2026-06-01')).toBe(june);
    expect(payslipForPeriod(list, 'job-2', '2026-06-01')).toBe(bar);
  });

  it('returns undefined when there is none', () => {
    expect(payslipForPeriod(list, 'job-2', '2026-05-25')).toBeUndefined();
    expect(payslipForPeriod([], 'job-1', '2026-06-01')).toBeUndefined();
  });
});
