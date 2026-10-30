/**
 * Shifts store: the shifts whose date falls in the loaded `range`. Actions
 * take the db as their first argument so the store never imports expo-sqlite.
 * Writes go through the repository, then the loaded range is reloaded.
 *
 * Pattern shifts are never deleted here (materialisation would regenerate
 * them): cancel them instead. Edits and status changes mark a shift
 * `userModified` so materialisation leaves it alone.
 */
import { create } from 'zustand';

import type { DateRange } from '../engine/shiftPay';
import type { Shift, ShiftStatus } from '../engine/types';
import type { AppDb } from '../db/jobRepo';
import { type StoredShift, createShift, deleteShift, getShift, listShifts, updateShift } from '../db/shiftRepo';

/** A new manual shift: everything except the fields the store sets itself. */
export type ManualShiftInput = Omit<Shift, 'source'>;

export interface ShiftsState {
  shifts: StoredShift[];
  /** Inclusive date range `shifts` covers; null until the first load. */
  range: DateRange | null;
  loaded: boolean;
  load: (db: AppDb, range: DateRange) => Promise<void>;
  addManualShift: (db: AppDb, shift: ManualShiftInput) => Promise<void>;
  /** Full replace of the shift (pass the whole object); marks it userModified. */
  editShift: (db: AppDb, shift: StoredShift) => Promise<void>;
  /** Sets the status; marks the shift userModified. Throws if no such shift. */
  setStatus: (db: AppDb, id: string, status: ShiftStatus) => Promise<void>;
  /** Same as setStatus(db, id, 'cancelled'). */
  cancelShift: (db: AppDb, id: string) => Promise<void>;
  /** Deletes a manual shift; throws for a pattern shift or an unknown id. */
  removeManualShift: (db: AppDb, id: string) => Promise<void>;
}

async function requireShift(db: AppDb, id: string): Promise<StoredShift> {
  const shift = await getShift(db, id);
  if (!shift) throw new Error(`Shift ${id} not found`);
  return shift;
}

export const useShiftsStore = create<ShiftsState>()((set, get) => {
  async function load(db: AppDb, range: DateRange): Promise<void> {
    const shifts = await listShifts(db, range.start, range.end);
    set({ shifts, range, loaded: true });
  }

  /** Reloads the current range; a no-op before the first load. */
  async function reload(db: AppDb): Promise<void> {
    const { range } = get();
    if (range) await load(db, range);
  }

  async function setStatus(db: AppDb, id: string, status: ShiftStatus): Promise<void> {
    const shift = await requireShift(db, id);
    await updateShift(db, { ...shift, status, userModified: true });
    await reload(db);
  }

  return {
    shifts: [],
    range: null,
    loaded: false,
    load,
    addManualShift: async (db, shift) => {
      await createShift(db, { ...shift, source: 'manual', userModified: false });
      await reload(db);
    },
    editShift: async (db, shift) => {
      await updateShift(db, { ...shift, userModified: true });
      await reload(db);
    },
    setStatus,
    cancelShift: (db, id) => setStatus(db, id, 'cancelled'),
    removeManualShift: async (db, id) => {
      const shift = await requireShift(db, id);
      if (shift.source !== 'manual') {
        throw new Error(`Shift ${id} is a ${shift.source} shift; cancel it instead of deleting`);
      }
      await deleteShift(db, id);
      await reload(db);
    },
  };
});
