/**
 * @jest-environment node
 */
import type { RotaPattern } from '../../engine/types';
import { type AppDb, type StoredJob, createJob } from '../jobRepo';
import {
  type StoredShiftTemplate,
  createRotaPattern,
  createShiftTemplate,
  deleteRotaPattern,
  deleteShiftTemplate,
  getRotaPattern,
  getShiftTemplate,
  listRotaPatterns,
  listShiftTemplates,
  updateRotaPattern,
  updateShiftTemplate,
} from '../rotaRepo';
import { createTestDb } from '../testDb';

const job: StoredJob = {
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
  holidayEntitlementHours: 210.25,
  holidayMode: 'fixed',
};

const night: StoredShiftTemplate = {
  id: 'tpl-n',
  jobId: 'job-1',
  name: 'Night',
  startTime: '22:00',
  endTime: '06:00',
  unpaidBreakMinutes: 30,
  colour: '#112233',
};

const early: StoredShiftTemplate = {
  id: 'tpl-e',
  jobId: 'job-1',
  name: 'Early',
  startTime: '06:00',
  endTime: '14:00',
  unpaidBreakMinutes: 0,
};

const pattern: RotaPattern = {
  id: 'pat-2',
  jobId: 'job-1',
  cycleLengthDays: 3,
  startDate: '2026-01-05',
  days: [{ shiftTemplateId: 'tpl-n' }, 'OFF', { shiftTemplateId: 'tpl-e' }],
};

describe('rotaRepo: shift templates', () => {
  let db: AppDb;

  beforeEach(async () => {
    db = createTestDb();
    await createJob(db, job);
  });

  it('round-trips with and without colour', async () => {
    await createShiftTemplate(db, night);
    await createShiftTemplate(db, early);
    expect(await getShiftTemplate(db, 'tpl-n')).toEqual(night);
    const plain = await getShiftTemplate(db, 'tpl-e');
    expect(plain).toEqual(early);
    expect(plain).not.toHaveProperty('colour');
  });

  it('lists by job, by name', async () => {
    await createShiftTemplate(db, night);
    await createShiftTemplate(db, early);
    await createJob(db, { ...job, id: 'job-2' });
    await createShiftTemplate(db, { ...early, id: 'other', jobId: 'job-2', name: 'A' });
    expect((await listShiftTemplates(db, 'job-1')).map((t) => t.id)).toEqual(['tpl-e', 'tpl-n']);
  });

  it('returns undefined for a missing template', async () => {
    expect(await getShiftTemplate(db, 'nope')).toBeUndefined();
  });

  it('updates by full replace and throws for a missing id', async () => {
    await createShiftTemplate(db, night);
    const { colour: _c, ...rest } = night;
    const updated: StoredShiftTemplate = {
      ...rest,
      name: 'Late',
      startTime: '14:00',
      endTime: '22:00',
    };
    await updateShiftTemplate(db, updated);
    const got = await getShiftTemplate(db, 'tpl-n');
    expect(got).toEqual(updated);
    expect(got).not.toHaveProperty('colour');
    await expect(updateShiftTemplate(db, { ...updated, id: 'nope' })).rejects.toThrow(/nope/);
  });

  it('deletes a template', async () => {
    await createShiftTemplate(db, night);
    await deleteShiftTemplate(db, 'tpl-n');
    expect(await getShiftTemplate(db, 'tpl-n')).toBeUndefined();
  });
});

describe('rotaRepo: rota patterns', () => {
  let db: AppDb;

  beforeEach(async () => {
    db = createTestDb();
    await createJob(db, job);
  });

  it('round-trips a pattern', async () => {
    await createRotaPattern(db, pattern);
    expect(await getRotaPattern(db, 'pat-2')).toEqual(pattern);
  });

  it('lists by job, by id', async () => {
    await createRotaPattern(db, pattern);
    await createRotaPattern(db, { ...pattern, id: 'pat-1' });
    await createJob(db, { ...job, id: 'job-2' });
    await createRotaPattern(db, { ...pattern, id: 'pat-0', jobId: 'job-2' });
    expect((await listRotaPatterns(db, 'job-1')).map((p) => p.id)).toEqual(['pat-1', 'pat-2']);
  });

  it('returns undefined for a missing pattern', async () => {
    expect(await getRotaPattern(db, 'nope')).toBeUndefined();
  });

  it('updates by full replace and throws for a missing id', async () => {
    await createRotaPattern(db, pattern);
    const updated: RotaPattern = {
      ...pattern,
      cycleLengthDays: 2,
      startDate: '2026-02-02',
      days: ['OFF', 'OFF'],
    };
    await updateRotaPattern(db, updated);
    expect(await getRotaPattern(db, 'pat-2')).toEqual(updated);
    await expect(updateRotaPattern(db, { ...updated, id: 'nope' })).rejects.toThrow(/nope/);
  });

  it('deletes a pattern', async () => {
    await createRotaPattern(db, pattern);
    await deleteRotaPattern(db, 'pat-2');
    expect(await getRotaPattern(db, 'pat-2')).toBeUndefined();
  });

  it('rejects a pattern whose days length differs from the cycle length', async () => {
    await expect(createRotaPattern(db, { ...pattern, cycleLengthDays: 4 })).rejects.toThrow();
    expect(await getRotaPattern(db, 'pat-2')).toBeUndefined();
    await createRotaPattern(db, pattern);
    await expect(updateRotaPattern(db, { ...pattern, days: ['OFF'] })).rejects.toThrow();
    expect(await getRotaPattern(db, 'pat-2')).toEqual(pattern);
  });
});
