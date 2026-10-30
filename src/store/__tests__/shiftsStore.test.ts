/**
 * @jest-environment node
 */
import { type AppDb, createJob } from '../../db/jobRepo';
import { type StoredShift, createShift, getShift } from '../../db/shiftRepo';
import { createTestDb } from '../../db/testDb';
import { type ManualShiftInput, useShiftsStore } from '../shiftsStore';
import { job, resetStores, shift } from '../testFixtures';

const RANGE = { start: '2026-06-01', end: '2026-06-30' };

function manualInput(date: string): ManualShiftInput {
  const s: Partial<StoredShift> = shift(date);
  delete s.source;
  delete s.userModified;
  return s as ManualShiftInput;
}

describe('useShiftsStore', () => {
  let db: AppDb;

  beforeEach(async () => {
    db = createTestDb();
    resetStores();
    await createJob(db, job);
  });

  it('starts empty with no range', () => {
    expect(useShiftsStore.getState()).toMatchObject({ shifts: [], range: null, loaded: false });
  });

  it('load keeps only shifts inside the range', async () => {
    await createShift(db, shift('2026-05-31'));
    await createShift(db, shift('2026-06-01'));
    await createShift(db, shift('2026-06-30'));
    await createShift(db, shift('2026-07-01'));
    await useShiftsStore.getState().load(db, RANGE);
    const state = useShiftsStore.getState();
    expect(state.loaded).toBe(true);
    expect(state.range).toEqual(RANGE);
    expect(state.shifts.map((s) => s.id)).toEqual(['s-2026-06-01', 's-2026-06-30']);
  });

  it('addManualShift stores a manual shift and reloads the range', async () => {
    await useShiftsStore.getState().load(db, RANGE);
    await useShiftsStore.getState().addManualShift(db, manualInput('2026-06-10'));
    const stored = await getShift(db, 's-2026-06-10');
    expect(stored).toMatchObject({ source: 'manual', userModified: false });
    expect(useShiftsStore.getState().shifts).toEqual([stored]);
  });

  it('writes before any load do not populate state', async () => {
    await useShiftsStore.getState().addManualShift(db, manualInput('2026-06-10'));
    expect(useShiftsStore.getState()).toMatchObject({ shifts: [], loaded: false });
    expect(await getShift(db, 's-2026-06-10')).toBeDefined();
  });

  it('editShift persists the whole shift with userModified: true', async () => {
    const pat = shift('2026-06-12', { id: 'pat-1:2026-06-12', source: 'pattern' });
    await createShift(db, pat);
    await useShiftsStore.getState().load(db, RANGE);
    const edited = { ...pat, end: '2026-06-12T18:00:00.000Z', notes: 'stayed late' };
    await useShiftsStore.getState().editShift(db, edited);
    const expected = { ...edited, userModified: true };
    expect(await getShift(db, pat.id)).toEqual(expected);
    expect(useShiftsStore.getState().shifts).toEqual([expected]);
  });

  it('setStatus persists the status with userModified: true', async () => {
    await createShift(db, shift('2026-06-12', { id: 'p:2026-06-12', source: 'pattern' }));
    await useShiftsStore.getState().load(db, RANGE);
    await useShiftsStore.getState().setStatus(db, 'p:2026-06-12', 'worked');
    expect(await getShift(db, 'p:2026-06-12')).toMatchObject({ status: 'worked', userModified: true });
    expect(useShiftsStore.getState().shifts[0]).toMatchObject({ status: 'worked', userModified: true });
  });

  it('cancelShift sets status cancelled with userModified: true', async () => {
    await createShift(db, shift('2026-06-12'));
    await useShiftsStore.getState().cancelShift(db, 's-2026-06-12');
    expect(await getShift(db, 's-2026-06-12')).toMatchObject({ status: 'cancelled', userModified: true });
  });

  it('setStatus rejects an unknown id', async () => {
    await expect(useShiftsStore.getState().setStatus(db, 'nope', 'worked')).rejects.toThrow(
      'Shift nope not found',
    );
  });

  it('removeManualShift deletes a manual shift and reloads', async () => {
    await createShift(db, shift('2026-06-12'));
    await useShiftsStore.getState().load(db, RANGE);
    await useShiftsStore.getState().removeManualShift(db, 's-2026-06-12');
    expect(await getShift(db, 's-2026-06-12')).toBeUndefined();
    expect(useShiftsStore.getState().shifts).toEqual([]);
  });

  it('removeManualShift refuses a pattern shift and leaves it stored', async () => {
    await createShift(db, shift('2026-06-12', { id: 'p:2026-06-12', source: 'pattern' }));
    await expect(useShiftsStore.getState().removeManualShift(db, 'p:2026-06-12')).rejects.toThrow(
      /pattern shift/,
    );
    expect(await getShift(db, 'p:2026-06-12')).toBeDefined();
  });

  it('removeManualShift rejects an unknown id', async () => {
    await expect(useShiftsStore.getState().removeManualShift(db, 'nope')).rejects.toThrow(
      'Shift nope not found',
    );
  });
});
