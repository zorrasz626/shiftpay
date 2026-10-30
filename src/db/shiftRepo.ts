/**
 * Shifts: typed CRUD mapping DB rows <-> engine types. DB null <-> optional
 * field absent. Start/end are truncated to whole minutes on save, because
 * segmentation assumes minute precision.
 */
import { and, asc, eq, gte, lte } from 'drizzle-orm';

import type { IsoInstant, LocalDate, Shift } from '../engine/types';
import type { AppDb } from './jobRepo';
import { shifts } from './schema';

export type StoredShift = Shift & { patternId?: string; userModified: boolean };

type ShiftRow = typeof shifts.$inferSelect;

const MS_PER_MINUTE = 60_000;

/**
 * Drops seconds and milliseconds, returning the engine's instant form
 * (`YYYY-MM-DDTHH:mm:00.000Z`). UTC arithmetic only; throws on an invalid instant.
 */
export function truncateToMinute(instant: IsoInstant): IsoInstant {
  const ms = Date.parse(instant);
  if (Number.isNaN(ms)) throw new Error(`Invalid IsoInstant: ${instant}`);
  return new Date(Math.floor(ms / MS_PER_MINUTE) * MS_PER_MINUTE).toISOString();
}

function shiftToRow(s: StoredShift): ShiftRow {
  return {
    id: s.id,
    jobId: s.jobId,
    date: s.date,
    start: truncateToMinute(s.start),
    end: truncateToMinute(s.end),
    unpaidBreakMinutes: s.unpaidBreakMinutes,
    source: s.source,
    status: s.status,
    overtimeFlag: s.overtimeFlag,
    notes: s.notes ?? null,
    patternId: s.patternId ?? null,
    userModified: s.userModified,
  };
}

function rowToShift(row: ShiftRow): StoredShift {
  const { notes, patternId, ...rest } = row;
  const shift: StoredShift = { ...rest };
  if (notes !== null) shift.notes = notes;
  if (patternId !== null) shift.patternId = patternId;
  return shift;
}

/** Shifts with `date` in [from, to] inclusive, optionally for one job; by date, start, id. */
export async function listShifts(
  db: AppDb,
  from: LocalDate,
  to: LocalDate,
  jobId?: string,
): Promise<StoredShift[]> {
  const rows = await db
    .select()
    .from(shifts)
    .where(
      and(
        gte(shifts.date, from),
        lte(shifts.date, to),
        jobId === undefined ? undefined : eq(shifts.jobId, jobId),
      ),
    )
    .orderBy(asc(shifts.date), asc(shifts.start), asc(shifts.id));
  return rows.map(rowToShift);
}

export async function getShift(db: AppDb, id: string): Promise<StoredShift | undefined> {
  const rows = await db.select().from(shifts).where(eq(shifts.id, id));
  return rows.length ? rowToShift(rows[0]) : undefined;
}

export async function createShift(db: AppDb, s: StoredShift): Promise<void> {
  await db.insert(shifts).values(shiftToRow(s));
}

/** Full replace by id; throws if no such shift. */
export async function updateShift(db: AppDb, s: StoredShift): Promise<void> {
  const { id, ...values } = shiftToRow(s);
  const updated = await db
    .update(shifts)
    .set(values)
    .where(eq(shifts.id, id))
    .returning({ id: shifts.id });
  if (updated.length === 0) throw new Error(`Shift ${id} not found`);
}

export async function deleteShift(db: AppDb, id: string): Promise<void> {
  await db.delete(shifts).where(eq(shifts.id, id));
}
