/**
 * @jest-environment node
 */
import type { PremiumRule, RotaPattern } from '../../engine/types';
import { type AppDb, createJob, createPremiumRule } from '../../db/jobRepo';
import {
  type StoredShiftTemplate,
  createRotaPattern,
  createShiftTemplate,
  deleteShiftTemplate,
} from '../../db/rotaRepo';
import { createShift } from '../../db/shiftRepo';
import { createTestDb } from '../../db/testDb';
import { materialiseWindow } from '../../services/materialise';
import { bootstrap } from '../bootstrap';
import { useJobsStore } from '../jobsStore';
import { useRulesStore } from '../rulesStore';
import { useSettingsStore } from '../settingsStore';
import { useShiftsStore } from '../shiftsStore';
import { TODAY, job, resetStores, shift } from '../testFixtures';

const template: StoredShiftTemplate = {
  id: 'tpl-d',
  jobId: 'job-1',
  name: 'Day',
  startTime: '08:00',
  endTime: '16:00',
  unpaidBreakMinutes: 30,
};

const pattern: RotaPattern = {
  id: 'pat-1',
  jobId: 'job-1',
  cycleLengthDays: 2,
  startDate: '2026-01-01',
  days: [{ shiftTemplateId: 'tpl-d' }, 'OFF'],
};

describe('bootstrap', () => {
  let db: AppDb;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    db = createTestDb();
    resetStores();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('on an empty DB resolves with no error and loads every store empty', async () => {
    await expect(bootstrap(db, TODAY)).resolves.toEqual({});
    expect(useJobsStore.getState()).toMatchObject({ jobs: [], loaded: true });
    expect(useRulesStore.getState()).toMatchObject({ rules: [], loaded: true });
    expect(useSettingsStore.getState()).toMatchObject({ values: {}, loaded: true });
    expect(useShiftsStore.getState()).toMatchObject({
      shifts: [],
      loaded: true,
      range: materialiseWindow(TODAY),
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('materialises pattern shifts, then loads them for the window', async () => {
    await createJob(db, job);
    await createShiftTemplate(db, template);
    await createRotaPattern(db, pattern);
    await expect(bootstrap(db, TODAY)).resolves.toEqual({});
    const { shifts } = useShiftsStore.getState();
    expect(shifts.length).toBeGreaterThan(0);
    expect(shifts.every((s) => s.source === 'pattern' && s.patternId === 'pat-1')).toBe(true);
    expect(useJobsStore.getState().jobs).toEqual([job]);
  });

  it('loads every stored premium rule', async () => {
    await createJob(db, job);
    await createJob(db, { ...job, id: 'job-2', name: 'Bar' });
    const rules: PremiumRule[] = [
      {
        id: 'r-1',
        jobId: 'job-1',
        name: 'BH',
        type: 'bank_holiday',
        multiplier: 2,
        stacking: 'stack',
        priority: 0,
      },
      {
        id: 'r-2',
        jobId: 'job-2',
        name: 'OT',
        type: 'overtime_daily',
        thresholdHours: 8,
        multiplier: 1.5,
        stacking: 'highest_only',
        priority: 0,
      },
    ];
    for (const r of rules) await createPremiumRule(db, r);
    await bootstrap(db, TODAY);
    expect(useRulesStore.getState().loaded).toBe(true);
    expect(useRulesStore.getState().rules).toHaveLength(rules.length);
    expect(useRulesStore.getState().rules).toEqual(expect.arrayContaining(rules));
  });

  it('with a pattern whose template was deleted returns materialiseError and still loads', async () => {
    await createJob(db, job);
    await createShiftTemplate(db, template);
    await createRotaPattern(db, pattern);
    await deleteShiftTemplate(db, template.id);
    await createShift(db, shift(TODAY));

    const result = await bootstrap(db, TODAY);
    expect(result.materialiseError).toBeInstanceOf(Error);
    expect(result.materialiseError?.message).toMatch(/tpl-d not found/);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(useJobsStore.getState()).toMatchObject({ jobs: [job], loaded: true });
    expect(useSettingsStore.getState().loaded).toBe(true);
    expect(useShiftsStore.getState().loaded).toBe(true);
    expect(useShiftsStore.getState().shifts.map((s) => s.id)).toEqual([`s-${TODAY}`]);
  });
});
