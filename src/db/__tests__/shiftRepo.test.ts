/**
 * @jest-environment node
 */
import { type AppDb, type StoredJob, createJob, deleteJob } from '../jobRepo';
import { createPayslip, getPayslip, listPayslips } from '../payslipRepo';
import {
  type StoredShift,
  createShift,
  deleteShift,
  getShift,
  listShifts,
  truncateToMinute,
  updateShift,
} from '../shiftRepo';
import { createTestDb } from '../testDb';

const baseJob: StoredJob = {
  id: 'job-1',
  name: 'Warehouse',
  baseRatePence: 1250,
  payFrequency: 'weekly',
  payPeriodAnchorDate: '2026-04-06',
  payDayOffsetDays: 5,
  periodCutoffDay: 31,
  contractedHoursPerWeek: 37.5,
  bankHolidayRegion: 'england-and-wales',
  overtimePremiumMode: 'highest',
  holidayYearStart: '2026-04-01',
  holidayEntitlementHours: 210,
  holidayMode: 'fixed',
};

const full: StoredShift = {
  id: 's-full',
  jobId: 'job-1',
  date: '2026-03-28',
  start: '2026-03-28T22:00:00.000Z',
  end: '2026-03-29T06:00:00.000Z',
  unpaidBreakMinutes: 30,
  source: 'pattern',
  status: 'worked',
  overtimeFlag: true,
  notes: 'Covered for Sam',
  patternId: 'pat-1',
  userModified: true,
};

const plain: StoredShift = {
  id: 's-plain',
  jobId: 'job-1',
  date: '2026-03-30',
  start: '2026-03-30T08:00:00.000Z',
  end: '2026-03-30T16:00:00.000Z',
  unpaidBreakMinutes: 0,
  source: 'manual',
  status: 'planned',
  overtimeFlag: false,
  userModified: false,
};

describe('truncateToMinute', () => {
  it('drops seconds and milliseconds in UTC', () => {
    expect(truncateToMinute('2026-03-29T00:59:59.999Z')).toBe('2026-03-29T00:59:00.000Z');
    expect(truncateToMinute('2026-10-25T01:30:15Z')).toBe('2026-10-25T01:30:00.000Z');
    expect(truncateToMinute('2026-01-01T00:00:00.000Z')).toBe('2026-01-01T00:00:00.000Z');
  });

  it('normalises an offset instant to UTC', () => {
    expect(truncateToMinute('2026-06-01T09:15:42+01:00')).toBe('2026-06-01T08:15:00.000Z');
  });

  it('throws for an invalid instant', () => {
    expect(() => truncateToMinute('not a date')).toThrow(/not a date/);
  });
});

describe('shiftRepo', () => {
  let db: AppDb;

  beforeEach(async () => {
    db = createTestDb();
    await createJob(db, baseJob);
    await createJob(db, { ...baseJob, id: 'job-2', name: 'Bar' });
  });

  it('round-trips every field, with and without optional ones', async () => {
    await createShift(db, full);
    await createShift(db, plain);
    expect(await getShift(db, 's-full')).toEqual(full);
    const got = await getShift(db, 's-plain');
    expect(got).toEqual(plain);
    expect(got).not.toHaveProperty('notes');
    expect(got).not.toHaveProperty('patternId');
  });

  it('truncates start and end to the minute on create and update', async () => {
    await createShift(db, {
      ...plain,
      start: '2026-03-30T08:00:59.999Z',
      end: '2026-03-30T16:00:30.000Z',
    });
    let got = await getShift(db, 's-plain');
    expect(got?.start).toBe('2026-03-30T08:00:00.000Z');
    expect(got?.end).toBe('2026-03-30T16:00:00.000Z');

    await updateShift(db, {
      ...plain,
      start: '2026-03-30T09:15:12.345Z',
      end: '2026-03-30T17:45:01Z',
    });
    got = await getShift(db, 's-plain');
    expect(got?.start).toBe('2026-03-30T09:15:00.000Z');
    expect(got?.end).toBe('2026-03-30T17:45:00.000Z');
  });

  it('lists by inclusive date range and optional job, ordered by date then start', async () => {
    const mk = (id: string, jobId: string, date: string, hour: string): StoredShift => ({
      ...plain,
      id,
      jobId,
      date,
      start: `${date}T${hour}:00:00.000Z`,
      end: `${date}T23:00:00.000Z`,
    });
    await createShift(db, mk('late', 'job-1', '2026-03-02', '14'));
    await createShift(db, mk('early', 'job-1', '2026-03-02', '06'));
    await createShift(db, mk('first', 'job-2', '2026-03-01', '10'));
    await createShift(db, mk('last', 'job-1', '2026-03-03', '10'));
    await createShift(db, mk('before', 'job-1', '2026-02-28', '10'));
    await createShift(db, mk('after', 'job-1', '2026-03-04', '10'));

    const ids = async (jobId?: string) =>
      (await listShifts(db, '2026-03-01', '2026-03-03', jobId)).map((s) => s.id);
    expect(await ids()).toEqual(['first', 'early', 'late', 'last']);
    expect(await ids('job-1')).toEqual(['early', 'late', 'last']);
    expect(await ids('job-2')).toEqual(['first']);
  });

  it('returns undefined for a missing shift', async () => {
    expect(await getShift(db, 'nope')).toBeUndefined();
  });

  it('updates by full replace and throws for a missing id', async () => {
    await createShift(db, full);
    const { notes: _n, patternId: _p, ...rest } = full;
    const updated: StoredShift = { ...rest, status: 'sick', userModified: false };
    await updateShift(db, updated);
    const got = await getShift(db, 's-full');
    expect(got).toEqual(updated);
    expect(got).not.toHaveProperty('notes');
    await expect(updateShift(db, { ...updated, id: 'nope' })).rejects.toThrow(/nope/);
  });

  it('deletes a shift', async () => {
    await createShift(db, full);
    await deleteShift(db, 's-full');
    expect(await getShift(db, 's-full')).toBeUndefined();
  });

  it('deleting a job cascades its shifts and payslips', async () => {
    await createShift(db, full);
    await createShift(db, { ...plain, jobId: 'job-2' });
    await createPayslip(db, {
      id: 'p-1',
      jobId: 'job-1',
      periodStart: '2026-03-23',
      periodEnd: '2026-03-29',
      grossPaidPence: 50000,
      taxPence: 0,
      niPence: 0,
      pensionPence: 0,
      lines: [{ label: 'Basic', amountPence: 50000 }],
    });
    await deleteJob(db, 'job-1');
    expect(await getShift(db, 's-full')).toBeUndefined();
    expect(await getPayslip(db, 'p-1')).toBeUndefined();
    expect(await listPayslips(db, 'job-1')).toEqual([]);
    expect((await listShifts(db, '2026-01-01', '2026-12-31')).map((s) => s.id)).toEqual([
      's-plain',
    ]);
  });
});
