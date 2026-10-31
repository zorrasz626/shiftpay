/**
 * @jest-environment node
 */
import { addLocalDays } from '../../engine/time';
import type { RotaPattern, Shift } from '../../engine/types';
import { type AppDb, type StoredJob, createJob } from '../../db/jobRepo';
import {
  type StoredShiftTemplate,
  createRotaPattern,
  createShiftTemplate,
  deleteRotaPattern,
  updateRotaPattern,
  updateShiftTemplate,
} from '../../db/rotaRepo';
import { type StoredShift, createShift, getShift, listShifts, updateShift } from '../../db/shiftRepo';
import { createTestDb } from '../../db/testDb';
import { materialiseShifts, materialiseWindow, planMaterialisation } from '../materialise';

const TODAY = '2026-06-15';

describe('materialiseWindow', () => {
  it('spans today −90 to today +120 days, inclusive', () => {
    expect(materialiseWindow(TODAY)).toEqual({ start: '2026-03-17', end: '2026-10-13' });
  });
});

// ---- planner ---------------------------------------------------------------

function gen(date: string, overrides: Partial<Shift> = {}): Shift {
  return {
    id: `pat-1:${date}`,
    jobId: 'job-1',
    date,
    start: `${date}T08:00:00.000Z`,
    end: `${date}T16:00:00.000Z`,
    unpaidBreakMinutes: 30,
    source: 'pattern',
    status: 'planned',
    overtimeFlag: false,
    ...overrides,
  };
}

function stored(date: string, overrides: Partial<StoredShift> = {}): StoredShift {
  return { ...gen(date), patternId: 'pat-1', userModified: false, ...overrides };
}

const KNOWN = new Set(['pat-1']);

describe('planMaterialisation', () => {
  it('inserts missing generated shifts, past and future, as unmodified pattern rows', () => {
    const plan = planMaterialisation([], [gen('2026-04-01'), gen('2026-07-01')], KNOWN, TODAY);
    expect(plan.insert).toEqual([stored('2026-04-01'), stored('2026-07-01')]);
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it('a seeded pattern gets no past inserts, but today and future ones', () => {
    // pat-1 is stored through the window end, so a newly-on past day is not back-filled.
    const existing = [stored('2026-05-01'), stored('2026-10-13')];
    const generated = [gen('2026-05-01'), gen('2026-05-02'), gen('2026-06-14'), gen(TODAY), gen('2026-07-01'), gen('2026-10-13')];
    const plan = planMaterialisation(existing, generated, KNOWN, TODAY);
    expect(plan).toEqual({ insert: [stored(TODAY), stored('2026-07-01')], update: [], remove: [] });
    // Re-running once those are stored is a no-op.
    const rerun = planMaterialisation([...existing, ...plan.insert], generated, KNOWN, TODAY);
    expect(rerun).toEqual({ insert: [], update: [], remove: [] });
  });

  it('back-fills past dates after the pattern latest stored date (a long gap), not on or before it', () => {
    const existing = [stored('2026-04-01'), stored('2026-06-10')];
    const generated = [gen('2026-04-02'), gen('2026-06-09'), gen('2026-06-11'), gen('2026-06-14'), gen(TODAY)];
    const plan = planMaterialisation(existing, generated, KNOWN, TODAY);
    expect(plan.insert).toEqual([stored('2026-06-11'), stored('2026-06-14'), stored(TODAY)]);
  });

  it('counts a pattern as seeded by any of its rows, userModified or outside the window', () => {
    const generated = [gen('2026-05-02')];
    const modified = stored('2026-07-01', { userModified: true });
    const beyond = stored('2026-12-01');
    expect(planMaterialisation([modified], generated, KNOWN, TODAY).insert).toEqual([]);
    expect(planMaterialisation([beyond], generated, KNOWN, TODAY).insert).toEqual([]);
    // Another pattern's rows do not seed pat-1.
    const other = stored('2026-05-01', { id: 'pat-2:2026-05-01', patternId: 'pat-2' });
    expect(planMaterialisation([other], generated, KNOWN, TODAY).insert).toEqual([stored('2026-05-02')]);
  });

  it('derives patternId from the generated id (pattern ids may contain colons)', () => {
    const plan = planMaterialisation([], [gen('2026-07-01', { id: 'a:b:2026-07-01' })], KNOWN, TODAY);
    expect(plan.insert[0].patternId).toBe('a:b');
  });

  it('truncates generated start/end to whole minutes', () => {
    const g = gen('2026-07-01', { start: '2026-07-01T08:00:42.123Z', end: '2026-07-01T16:00:59.999Z' });
    const [ins] = planMaterialisation([], [g], KNOWN, TODAY).insert;
    expect(ins.start).toBe('2026-07-01T08:00:00.000Z');
    expect(ins.end).toBe('2026-07-01T16:00:00.000Z');
  });

  it('ignores generated shifts outside the window', () => {
    const plan = planMaterialisation([], [gen('2026-03-16'), gen('2026-10-14')], KNOWN, TODAY);
    expect(plan.insert).toEqual([]);
  });

  it('does not insert over any stored id, even a manual or out-of-window row', () => {
    const moved = stored('2026-10-20', { id: 'pat-1:2026-10-13', userModified: true });
    const manual = stored('2026-07-01', { patternId: undefined, source: 'manual' });
    delete manual.patternId;
    const plan = planMaterialisation([moved, manual], [gen('2026-10-13'), gen('2026-07-01')], KNOWN, TODAY);
    expect(plan).toEqual({ insert: [], update: [], remove: [] });
  });

  it('writes nothing when stored values match', () => {
    const plan = planMaterialisation([stored('2026-07-01')], [gen('2026-07-01')], KNOWN, TODAY);
    expect(plan).toEqual({ insert: [], update: [], remove: [] });
  });

  it.each<[string, Partial<Shift>]>([
    ['start', { start: '2026-07-01T09:00:00.000Z' }],
    ['end', { end: '2026-07-01T17:00:00.000Z' }],
    ['jobId', { jobId: 'job-2' }],
    ['unpaidBreakMinutes', { unpaidBreakMinutes: 0 }],
    ['overtimeFlag', { overtimeFlag: true }],
  ])('updates a future unmodified shift whose %s changed, keeping status and notes', (_f, change) => {
    const s = stored('2026-07-01', { status: 'cancelled', notes: 'n' });
    const plan = planMaterialisation([s], [gen('2026-07-01', change)], KNOWN, TODAY);
    expect(plan.update).toEqual([{ ...s, ...change }]);
    expect(plan.insert).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it('updates a stored row whose date differs from its generated one', () => {
    const s = stored('2026-07-02', { id: 'pat-1:2026-07-01' });
    const plan = planMaterialisation([s], [gen('2026-07-01')], KNOWN, TODAY);
    expect(plan.update).toEqual([stored('2026-07-01')]);
  });

  it('updates today (today counts as future)', () => {
    const plan = planMaterialisation([stored(TODAY)], [gen(TODAY, { unpaidBreakMinutes: 0 })], KNOWN, TODAY);
    expect(plan.update).toHaveLength(1);
  });

  it('never updates or removes a userModified shift', () => {
    const changed = stored('2026-07-01', { userModified: true });
    const orphan = stored('2026-07-02', { userModified: true, patternId: 'gone' });
    const plan = planMaterialisation([changed, orphan], [gen('2026-07-01', { unpaidBreakMinutes: 0 })], KNOWN, TODAY);
    expect(plan).toEqual({ insert: [], update: [], remove: [] });
  });

  it('leaves past unmodified shifts as they are', () => {
    const changed = stored('2026-06-14');
    const orphan = stored('2026-04-01', { patternId: 'gone', id: 'gone:2026-04-01' });
    const plan = planMaterialisation([changed, orphan], [gen('2026-06-14', { unpaidBreakMinutes: 0 })], KNOWN, TODAY);
    expect(plan).toEqual({ insert: [], update: [], remove: [] });
  });

  it('removes future unmodified shifts no longer generated by a known pattern', () => {
    const plan = planMaterialisation([stored('2026-07-01')], [], KNOWN, TODAY);
    expect(plan.remove).toEqual(['pat-1:2026-07-01']);
  });

  it('removes future unmodified shifts of a deleted pattern', () => {
    const s = stored('2026-07-01', { patternId: 'gone', id: 'gone:2026-07-01' });
    expect(planMaterialisation([s], [], KNOWN, TODAY).remove).toEqual(['gone:2026-07-01']);
    // Even if a stray generated shift still carries its id.
    const stray = gen('2026-07-01', { id: 'gone:2026-07-01' });
    expect(planMaterialisation([s], [stray], KNOWN, TODAY).remove).toEqual(['gone:2026-07-01']);
  });

  it('never touches manual shifts or pattern shifts outside the window', () => {
    const manual = stored('2026-07-01', { id: 'm-1', source: 'manual' });
    delete manual.patternId;
    const beyond = stored('2026-10-14');
    const before = stored('2026-03-16');
    const plan = planMaterialisation([manual, beyond, before], [], KNOWN, TODAY);
    expect(plan).toEqual({ insert: [], update: [], remove: [] });
  });
});

// ---- database --------------------------------------------------------------

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
  holidayEntitlementHours: 210,
  holidayMode: 'fixed',
};

const day: StoredShiftTemplate = {
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
  days: [{ shiftTemplateId: 'tpl-d' }, { shiftTemplateId: 'tpl-d' }],
};

const WINDOW_DAYS = 211;
const PAST = '2026-05-01';
const FUTURE = '2026-07-01';

async function allShifts(db: AppDb): Promise<StoredShift[]> {
  return listShifts(db, '2000-01-01', '2100-12-31');
}

describe('materialiseShifts', () => {
  let db: AppDb;

  beforeEach(async () => {
    db = createTestDb();
    await createJob(db, job);
    await createShiftTemplate(db, day);
    await createRotaPattern(db, pattern);
  });

  it('backfills the whole window and is idempotent on rerun', async () => {
    expect(await materialiseShifts(db, TODAY)).toEqual({ inserted: WINDOW_DAYS, updated: 0, removed: 0 });
    const rows = await allShifts(db);
    expect(rows).toHaveLength(WINDOW_DAYS);
    expect(rows[0]).toEqual({
      id: 'pat-1:2026-03-17',
      jobId: 'job-1',
      date: '2026-03-17',
      start: '2026-03-17T08:00:00.000Z',
      end: '2026-03-17T16:00:00.000Z',
      unpaidBreakMinutes: 30,
      source: 'pattern',
      status: 'planned',
      overtimeFlag: false,
      patternId: 'pat-1',
      userModified: false,
    });
    expect(rows[WINDOW_DAYS - 1].date).toBe('2026-10-13');

    expect(await materialiseShifts(db, TODAY)).toEqual({ inserted: 0, updated: 0, removed: 0 });
    expect(await allShifts(db)).toEqual(rows);
  });

  it('never touches manual shifts', async () => {
    const manual: StoredShift = {
      id: 'm-1',
      jobId: 'job-1',
      date: FUTURE,
      start: '2026-07-01T18:00:00.000Z',
      end: '2026-07-01T20:00:00.000Z',
      unpaidBreakMinutes: 0,
      source: 'manual',
      status: 'planned',
      overtimeFlag: true,
      userModified: false,
    };
    await createShift(db, manual);
    await materialiseShifts(db, TODAY);
    await deleteRotaPattern(db, 'pat-1');
    await materialiseShifts(db, TODAY);
    expect(await getShift(db, 'm-1')).toEqual(manual);
  });

  it('template edit updates future unmodified shifts only', async () => {
    await materialiseShifts(db, TODAY);
    const modified = { ...(await getShift(db, `pat-1:${FUTURE}`))!, notes: 'swap', userModified: true };
    await updateShift(db, modified);
    const past = await getShift(db, `pat-1:${PAST}`);
    const noted = { ...(await getShift(db, 'pat-1:2026-07-02'))!, notes: 'bring keys' };
    await updateShift(db, noted);

    // 08:00 BST = 07:00Z; after the edit 09:00 BST = 08:00Z.
    await updateShiftTemplate(db, { ...day, startTime: '09:00' });
    const res = await materialiseShifts(db, TODAY);
    expect(res).toEqual({ inserted: 0, updated: 120, removed: 0 });

    expect(await getShift(db, `pat-1:${PAST}`)).toEqual(past);
    expect(await getShift(db, `pat-1:${FUTURE}`)).toEqual(modified);
    expect((await getShift(db, `pat-1:${TODAY}`))!.start).toBe(`${TODAY}T08:00:00.000Z`);
    expect(await getShift(db, 'pat-1:2026-07-02')).toEqual({
      ...noted,
      start: '2026-07-02T08:00:00.000Z',
      end: '2026-07-02T15:00:00.000Z',
    });
    expect((await allShifts(db)).length).toBe(WINDOW_DAYS);
  });

  it('removed cycle days delete only future unmodified shifts', async () => {
    await materialiseShifts(db, TODAY);
    // Odd day offsets from 2026-01-01 are cycle day 1: 2026-07-01, 2026-07-03, 2026-05-02.
    const kept = { ...(await getShift(db, 'pat-1:2026-07-01'))!, status: 'worked' as const, userModified: true };
    await updateShift(db, kept);

    await updateRotaPattern(db, { ...pattern, days: [{ shiftTemplateId: 'tpl-d' }, 'OFF'] });
    const res = await materialiseShifts(db, TODAY);
    // Future = TODAY..2026-10-13 = 121 days; cycle day 1 falls on 61 of them, one is user-modified.
    expect(res).toEqual({ inserted: 0, updated: 0, removed: 60 });

    expect(await getShift(db, 'pat-1:2026-07-01')).toEqual(kept);
    expect(await getShift(db, 'pat-1:2026-07-03')).toBeUndefined();
    expect(await getShift(db, 'pat-1:2026-07-02')).toBeDefined();
    expect(await getShift(db, 'pat-1:2026-05-02')).toBeDefined(); // past cycle day 1 kept
  });

  it('pattern deletion removes future unmodified shifts and keeps past and user-modified ones', async () => {
    await materialiseShifts(db, TODAY);
    const modified = { ...(await getShift(db, `pat-1:${FUTURE}`))!, unpaidBreakMinutes: 0, userModified: true };
    await updateShift(db, modified);

    await deleteRotaPattern(db, 'pat-1');
    expect(await materialiseShifts(db, TODAY)).toEqual({ inserted: 0, updated: 0, removed: 120 });

    const rows = await allShifts(db);
    expect(rows).toHaveLength(WINDOW_DAYS - 120);
    expect(rows.filter((r) => r.date >= TODAY)).toEqual([modified]);
  });

  it('rolling the window by 7 days inserts only the 7 new far-end days', async () => {
    await materialiseShifts(db, TODAY);
    const before = await allShifts(db);
    const later = addLocalDays(TODAY, 7);

    expect(await materialiseShifts(db, later)).toEqual({ inserted: 7, updated: 0, removed: 0 });
    const after = await allShifts(db);
    expect(after.slice(0, WINDOW_DAYS)).toEqual(before);
    expect(after.slice(WINDOW_DAYS).map((r) => r.date)).toEqual([
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
      '2026-10-19',
      '2026-10-20',
    ]);
  });
});
