/**
 * @jest-environment node
 */
import type { PremiumRule } from '../../engine/types';
import {
  type AppDb,
  type StoredJob,
  createJob,
  createPremiumRule,
  deleteJob,
  deletePremiumRule,
  getJob,
  getPremiumRule,
  listJobs,
  listPremiumRules,
  updateJob,
  updatePremiumRule,
} from '../jobRepo';
import {
  createShiftTemplate,
  createRotaPattern,
  listRotaPatterns,
  listShiftTemplates,
} from '../rotaRepo';
import * as schema from '../schema';
import { createTestDb } from '../testDb';

const job: StoredJob = {
  id: 'job-b',
  name: 'Warehouse',
  baseRatePence: 1250,
  payFrequency: 'four_weekly',
  payPeriodAnchorDate: '2026-04-06',
  payDayOffsetDays: 5,
  periodCutoffDay: 31,
  contractedHoursPerWeek: 37.5,
  bankHolidayRegion: 'scotland',
  overtimePremiumMode: 'stack',
  holidayYearStart: '2026-04-01',
  holidayEntitlementHours: 210.25,
  holidayMode: 'accrual',
  colour: '#3366ff',
};

const { colour: _c, ...plainJob } = job;
const jobNoColour: StoredJob = { ...plainJob, id: 'job-a', name: 'Bar' };

const common = { jobId: 'job-b', stacking: 'highest_only', priority: 0 } as const;

const rules: PremiumRule[] = [
  {
    ...common,
    id: 'r-tb',
    name: 'Nights',
    type: 'time_band',
    multiplier: 1.333,
    startTime: '22:00',
    endTime: '06:00',
  },
  {
    ...common,
    id: 'r-dow',
    name: 'Weekend',
    type: 'day_of_week',
    flatAddPencePerHour: 125.5,
    daysOfWeek: [0, 6],
  },
  {
    ...common,
    id: 'r-bh',
    name: 'Bank hols',
    type: 'bank_holiday',
    multiplier: 2,
    stacking: 'stack',
  },
  {
    ...common,
    id: 'r-od',
    name: 'Daily OT',
    type: 'overtime_daily',
    multiplier: 1.5,
    thresholdHours: 9.5,
  },
  {
    ...common,
    id: 'r-ow',
    name: 'Weekly OT',
    type: 'overtime_weekly',
    multiplier: 1.5,
    thresholdHours: 39.5,
  },
  {
    ...common,
    id: 'r-ow-sun',
    name: 'Weekly OT (Sun)',
    type: 'overtime_weekly',
    multiplier: 1.25,
    thresholdHours: 40,
    weekStartsOn: 0,
  },
  {
    ...common,
    id: 'r-op',
    name: 'Period OT',
    type: 'overtime_period',
    multiplier: 1.5,
    thresholdHours: 150,
  },
];

describe('jobRepo: jobs', () => {
  let db: AppDb;

  beforeEach(() => {
    db = createTestDb();
  });

  it('round-trips a job with and without colour', async () => {
    await createJob(db, job);
    await createJob(db, jobNoColour);
    expect(await getJob(db, 'job-b')).toEqual(job);
    const plain = await getJob(db, 'job-a');
    expect(plain).toEqual(jobNoColour);
    expect(plain).not.toHaveProperty('colour');
  });

  it('lists jobs by name', async () => {
    await createJob(db, job);
    await createJob(db, jobNoColour);
    expect((await listJobs(db)).map((j) => j.id)).toEqual(['job-a', 'job-b']);
  });

  it('returns undefined for a missing job', async () => {
    expect(await getJob(db, 'nope')).toBeUndefined();
  });

  it('updates by full replace and throws for a missing id', async () => {
    await createJob(db, job);
    const { colour: _x, ...rest } = job;
    const updated: StoredJob = { ...rest, name: 'Depot', baseRatePence: 1300 };
    await updateJob(db, updated);
    const got = await getJob(db, 'job-b');
    expect(got).toEqual(updated);
    expect(got).not.toHaveProperty('colour');
    await expect(updateJob(db, { ...updated, id: 'nope' })).rejects.toThrow(/nope/);
  });

  it('deletes a job and cascades to its rules, templates and patterns', async () => {
    await createJob(db, job);
    await createPremiumRule(db, rules[0]);
    await createShiftTemplate(db, {
      id: 'tpl-1',
      jobId: 'job-b',
      name: 'Night',
      startTime: '22:00',
      endTime: '06:00',
      unpaidBreakMinutes: 30,
    });
    await createRotaPattern(db, {
      id: 'pat-1',
      jobId: 'job-b',
      cycleLengthDays: 2,
      startDate: '2026-01-05',
      days: [{ shiftTemplateId: 'tpl-1' }, 'OFF'],
    });
    await deleteJob(db, 'job-b');
    expect(await getJob(db, 'job-b')).toBeUndefined();
    expect(await listPremiumRules(db, 'job-b')).toEqual([]);
    expect(await listShiftTemplates(db, 'job-b')).toEqual([]);
    expect(await listRotaPatterns(db, 'job-b')).toEqual([]);
  });
});

describe('jobRepo: premium rules', () => {
  let db: AppDb;

  beforeEach(async () => {
    db = createTestDb();
    await createJob(db, job);
  });

  it('round-trips one rule of each type', async () => {
    for (const r of rules) await createPremiumRule(db, r);
    for (const r of rules) {
      const got = await getPremiumRule(db, r.id);
      expect(got).toEqual(r);
      expect(Object.values(got as object)).not.toContain(undefined);
      expect(Object.values(got as object)).not.toContain(null);
    }
    const weekly = await getPremiumRule(db, 'r-ow');
    expect(weekly).not.toHaveProperty('weekStartsOn');
    expect(await getPremiumRule(db, 'r-ow-sun')).toHaveProperty('weekStartsOn', 0);
    expect(await getPremiumRule(db, 'r-tb')).toHaveProperty('multiplier', 1.333);
    expect(await getPremiumRule(db, 'r-dow')).not.toHaveProperty('multiplier');
  });

  it('lists by priority desc, then id', async () => {
    await createPremiumRule(db, { ...rules[2], id: 'b', priority: 1 });
    await createPremiumRule(db, { ...rules[2], id: 'a', priority: 1 });
    await createPremiumRule(db, { ...rules[2], id: 'c', priority: 5 });
    await createPremiumRule(db, { ...rules[2], id: 'd', priority: 0 });
    expect((await listPremiumRules(db, 'job-b')).map((r) => r.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('returns undefined for a missing rule', async () => {
    expect(await getPremiumRule(db, 'nope')).toBeUndefined();
  });

  it('updates by full replace (incl. type change) and throws for a missing id', async () => {
    await createPremiumRule(db, rules[0]);
    const replaced: PremiumRule = {
      ...common,
      id: 'r-tb',
      name: 'Now weekly',
      type: 'overtime_weekly',
      flatAddPencePerHour: 50,
      thresholdHours: 40,
    };
    await updatePremiumRule(db, replaced);
    expect(await getPremiumRule(db, 'r-tb')).toEqual(replaced);
    await expect(updatePremiumRule(db, { ...replaced, id: 'nope' })).rejects.toThrow(/nope/);
  });

  it('deletes a rule', async () => {
    await createPremiumRule(db, rules[0]);
    await deletePremiumRule(db, 'r-tb');
    expect(await getPremiumRule(db, 'r-tb')).toBeUndefined();
  });

  it('throws naming the id for a corrupt rule row', async () => {
    db.insert(schema.premiumRules)
      .values({
        id: 'bad-tb',
        jobId: 'job-b',
        name: 'Broken',
        type: 'time_band',
        multiplier: 1.5,
        endTime: '06:00',
      })
      .run();
    await expect(getPremiumRule(db, 'bad-tb')).rejects.toThrow(/bad-tb/);
    await expect(listPremiumRules(db, 'job-b')).rejects.toThrow(/bad-tb/);
  });

  it('throws for corrupt day_of_week and overtime rows', async () => {
    db.insert(schema.premiumRules)
      .values({
        id: 'bad-dow',
        jobId: 'job-b',
        name: 'Broken',
        type: 'day_of_week',
        multiplier: 1.5,
      })
      .run();
    db.insert(schema.premiumRules)
      .values({
        id: 'bad-ot',
        jobId: 'job-b',
        name: 'Broken',
        type: 'overtime_period',
        multiplier: 1.5,
      })
      .run();
    await expect(getPremiumRule(db, 'bad-dow')).rejects.toThrow(/bad-dow/);
    await expect(getPremiumRule(db, 'bad-ot')).rejects.toThrow(/bad-ot/);
  });
});
