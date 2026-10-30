/**
 * @jest-environment node
 */
import type { RotaPattern } from '../../engine/types';
import { type AppDb, createJob } from '../../db/jobRepo';
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
