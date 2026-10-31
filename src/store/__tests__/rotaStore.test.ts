/**
 * @jest-environment node
 */
import type { RotaPattern } from '../../engine/types';
import { type AppDb, createJob } from '../../db/jobRepo';
import {
  type StoredShiftTemplate,
  createRotaPattern,
  createShiftTemplate,
  getRotaPattern,
  getShiftTemplate,
} from '../../db/rotaRepo';
import { type StoredShift, createShift, getShift, listShifts } from '../../db/shiftRepo';
import { createTestDb } from '../../db/testDb';
import { materialiseShifts, materialiseWindow } from '../../services/materialise';
import { bootstrap } from '../bootstrap';
import { TemplateInUseError, useRotaStore } from '../rotaStore';
import { useShiftsStore } from '../shiftsStore';
import { TODAY, job, resetStores, shift } from '../testFixtures';

const day: StoredShiftTemplate = {
  id: 'tpl-d',
  jobId: 'job-1',
  name: 'Day',
  startTime: '08:00',
  endTime: '16:00',
  unpaidBreakMinutes: 30,
};

const late: StoredShiftTemplate = { ...day, id: 'tpl-l', name: 'Late', startTime: '14:00', endTime: '22:00' };

/** Day 0 = 2026-01-01; TODAY (2026-06-15) is an OFF day, 06-14 and 06-16 are shifts. */
const pattern: RotaPattern = {
  id: 'pat-1',
  jobId: 'job-1',
  cycleLengthDays: 2,
  startDate: '2026-01-01',
  days: [{ shiftTemplateId: 'tpl-d' }, 'OFF'],
};

async function allShifts(db: AppDb): Promise<StoredShift[]> {
  return listShifts(db, '2000-01-01', '2100-12-31');
}

async function pastShifts(db: AppDb): Promise<StoredShift[]> {
  return (await allShifts(db)).filter((s) => s.date < TODAY);
}

describe('useRotaStore', () => {
  let db: AppDb;

  beforeEach(async () => {
    db = createTestDb();
    resetStores();
    await createJob(db, job);
    await createJob(db, { ...job, id: 'job-2', name: 'Bar' });
    await createShiftTemplate(db, day);
    await createShiftTemplate(db, { ...late, id: 'tpl-bar', jobId: 'job-2' });
    await createRotaPattern(db, pattern);
    await materialiseShifts(db, TODAY);
    await useShiftsStore.getState().load(db, materialiseWindow(TODAY));
  });

  it('starts empty and unloaded', () => {
    expect(useRotaStore.getState()).toMatchObject({ templates: [], patterns: [], loaded: false });
  });

  it('load reads every job’s templates and patterns', async () => {
    await useRotaStore.getState().load(db);
    // Grouped by job in listJobs order (by name: Bar, then Warehouse).
    expect(useRotaStore.getState()).toMatchObject({
      templates: [{ ...late, id: 'tpl-bar', jobId: 'job-2' }, day],
      patterns: [pattern],
      loaded: true,
    });
  });

  it('bootstrap loads the rota store', async () => {
    await bootstrap(db, TODAY);
    expect(useRotaStore.getState()).toMatchObject({ patterns: [pattern], loaded: true });
    expect(useRotaStore.getState().templates).toHaveLength(2);
  });

  it('saveTemplate creates a new template', async () => {
    await useRotaStore.getState().saveTemplate(db, late, TODAY);
    expect(await getShiftTemplate(db, 'tpl-l')).toEqual(late);
    expect(useRotaStore.getState().templates).toContainEqual(late);
  });

  it('a template edit moves future pattern shifts and leaves the past alone', async () => {
    const past = await pastShifts(db);
    expect(past.length).toBeGreaterThan(0);

    await useRotaStore.getState().saveTemplate(db, { ...day, startTime: '09:00', unpaidBreakMinutes: 0 }, TODAY);

    expect(await getShiftTemplate(db, 'tpl-d')).toMatchObject({ startTime: '09:00', unpaidBreakMinutes: 0 });
    expect(useRotaStore.getState().templates.find((t) => t.id === 'tpl-d')).toMatchObject({ startTime: '09:00' });
    // 09:00 BST is 08:00Z.
    expect(await getShift(db, 'pat-1:2026-06-16')).toMatchObject({
      start: '2026-06-16T08:00:00.000Z',
      unpaidBreakMinutes: 0,
      userModified: false,
    });
    expect(await getShift(db, 'pat-1:2026-06-14')).toMatchObject({ start: '2026-06-14T07:00:00.000Z' });
    expect(await pastShifts(db)).toEqual(past);
    // The shifts store follows without a manual reload.
    expect(useShiftsStore.getState().shifts.find((s) => s.id === 'pat-1:2026-06-16')).toMatchObject({
      start: '2026-06-16T08:00:00.000Z',
    });
  });

  it('a pattern edit regenerates future shifts only; userModified and manual shifts stay', async () => {
    await useShiftsStore.getState().setStatus(db, 'pat-1:2026-06-20', 'sick');
    const manual = shift('2026-06-17');
    await createShift(db, manual);
    const sick = await getShift(db, 'pat-1:2026-06-20');
    const past = await pastShifts(db);

    // New 3-day cycle from today: shift, shift, OFF.
    const edited: RotaPattern = {
      ...pattern,
      cycleLengthDays: 3,
      startDate: TODAY,
      days: [{ shiftTemplateId: 'tpl-d' }, { shiftTemplateId: 'tpl-d' }, 'OFF'],
    };
    await useRotaStore.getState().savePattern(db, edited, TODAY);

    expect(await getRotaPattern(db, 'pat-1')).toEqual(edited);
    expect(useRotaStore.getState().patterns).toEqual([edited]);

    const ids = (await allShifts(db)).filter((s) => s.date >= TODAY && s.source === 'pattern').map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['pat-1:2026-06-15', 'pat-1:2026-06-16', 'pat-1:2026-06-18']));
    expect(ids).not.toContain('pat-1:2026-06-17'); // OFF in the new cycle
    expect(ids).not.toContain('pat-1:2026-06-26'); // was a shift, now OFF: removed

    // 2026-06-20 is OFF in the new cycle, but the user marked it sick.
    expect(await getShift(db, 'pat-1:2026-06-20')).toEqual(sick);
    expect(await getShift(db, manual.id)).toEqual(manual);
    for (const s of past) expect(await getShift(db, s.id)).toEqual(s);

    const storeIds = useShiftsStore.getState().shifts.map((s) => s.id);
    expect(storeIds).toContain('pat-1:2026-06-15');
    expect(storeIds).not.toContain('pat-1:2026-06-26');
  });

  it.each<[string, RotaPattern]>([
    ['an OFF day turned on', { ...pattern, days: [{ shiftTemplateId: 'tpl-d' }, { shiftTemplateId: 'tpl-d' }] }],
    ['startDate moved by a day', { ...pattern, startDate: '2026-01-02' }],
  ])('a pattern edit (%s) adds no past shifts, nor does the next bootstrap', async (_c, edited) => {
    const past = await pastShifts(db);
    expect(past.length).toBeGreaterThan(0);

    await useRotaStore.getState().savePattern(db, edited, TODAY);
    expect(await pastShifts(db)).toEqual(past);
    // Today and future follow the edit: 06-15 (OFF before) is now a shift.
    expect(await getShift(db, 'pat-1:2026-06-15')).toMatchObject({ source: 'pattern' });

    await bootstrap(db, TODAY);
    expect(await pastShifts(db)).toEqual(past);
  });

  it('savePattern creates a new pattern and materialises it', async () => {
    const bar: RotaPattern = {
      id: 'pat-bar',
      jobId: 'job-2',
      cycleLengthDays: 1,
      startDate: TODAY,
      days: [{ shiftTemplateId: 'tpl-bar' }],
    };
    await useRotaStore.getState().savePattern(db, bar, TODAY);
    expect(await getRotaPattern(db, 'pat-bar')).toEqual(bar);
    expect(await getShift(db, 'pat-bar:2026-06-15')).toMatchObject({ jobId: 'job-2', source: 'pattern' });
    expect(useShiftsStore.getState().shifts.map((s) => s.id)).toContain('pat-bar:2026-06-15');
  });

  it('removeTemplate throws TemplateInUseError for a template a pattern uses and changes nothing', async () => {
    await useRotaStore.getState().load(db);
    const before = await allShifts(db);
    const state = useRotaStore.getState();

    const err = await useRotaStore
      .getState()
      .removeTemplate(db, 'tpl-d', TODAY)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TemplateInUseError);
    expect(err).toMatchObject({ templateId: 'tpl-d', patternIds: ['pat-1'] });

    expect(await getShiftTemplate(db, 'tpl-d')).toEqual(day);
    expect(await allShifts(db)).toEqual(before);
    expect(useRotaStore.getState().templates).toBe(state.templates);
  });

  it('removeTemplate deletes an unused template', async () => {
    await useRotaStore.getState().saveTemplate(db, late, TODAY);
    await useRotaStore.getState().removeTemplate(db, 'tpl-l', TODAY);
    expect(await getShiftTemplate(db, 'tpl-l')).toBeUndefined();
    expect(useRotaStore.getState().templates.map((t) => t.id)).toEqual(['tpl-bar', 'tpl-d']);
  });

  it('a materialisation error surfaces to the caller', async () => {
    const broken: RotaPattern = { ...pattern, days: [{ shiftTemplateId: 'missing' }, 'OFF'] };
    await expect(useRotaStore.getState().savePattern(db, broken, TODAY)).rejects.toThrow();
  });
});
