/**
 * Shift materialisation: writes rota-pattern shifts into the `shifts` table
 * over a rolling window (today −90 to today +120 days, inclusive).
 *
 * Idempotent: the generated id (`${pattern.id}:${date}`) is the key. Rows the
 * user has edited (`userModified`) are never touched; past pattern rows are
 * left as history; future unmodified pattern rows follow the current pattern.
 * A pattern back-fills past dates only up to its first materialisation (no
 * stored rows yet) or after its latest stored date (a gap longer than the
 * window's future reach); a pattern edit never adds past shifts.
 * Manual shifts and anything outside the window are never touched.
 * "today" is always passed in.
 */
import { and, eq, gte, isNotNull, lte, or } from 'drizzle-orm';

import { generateShifts } from '../engine/rota';
import type { DateRange } from '../engine/shiftPay';
import { addLocalDays } from '../engine/time';
import type { LocalDate, Shift } from '../engine/types';
import { type AppDb, listJobs } from '../db/jobRepo';
import { listRotaPatterns, listShiftTemplates } from '../db/rotaRepo';
import { shifts } from '../db/schema';
import { type StoredShift, truncateToMinute } from '../db/shiftRepo';

const WINDOW_PAST_DAYS = 90;
const WINDOW_FUTURE_DAYS = 120;
/** Length of the `:YYYY-MM-DD` suffix of a generated shift id. */
const ID_DATE_SUFFIX_LENGTH = 11;

export interface MaterialisationPlan {
  insert: StoredShift[];
  update: StoredShift[];
  remove: string[];
}

export interface MaterialisationResult {
  inserted: number;
  updated: number;
  removed: number;
}

/** Inclusive materialisation window: today −90 days to today +120 days. */
export function materialiseWindow(today: LocalDate): DateRange {
  return {
    start: addLocalDays(today, -WINDOW_PAST_DAYS),
    end: addLocalDays(today, WINDOW_FUTURE_DAYS),
  };
}

function inWindow(date: LocalDate, window: DateRange): boolean {
  return date >= window.start && date <= window.end;
}

function sameGeneratedValues(stored: StoredShift, gen: StoredShift): boolean {
  return (
    stored.date === gen.date &&
    stored.jobId === gen.jobId &&
    stored.start === gen.start &&
    stored.end === gen.end &&
    stored.unpaidBreakMinutes === gen.unpaidBreakMinutes &&
    stored.overtimeFlag === gen.overtimeFlag
  );
}

/** Generated shift -> stored form: pattern id taken from the generated id, minute precision. */
function toStored(s: Shift): StoredShift {
  return {
    ...s,
    start: truncateToMinute(s.start),
    end: truncateToMinute(s.end),
    patternId: s.id.slice(0, s.id.length - ID_DATE_SUFFIX_LENGTH),
    userModified: false,
  };
}

/**
 * Pure planner. `existing` are stored shifts (any may be passed; only pattern
 * shifts inside the window are candidates, but every id counts against
 * inserts, and every pattern row counts towards its pattern's latest stored date).
 * `generated` are the pattern shifts for the window; `knownPatternIds` are the
 * patterns that still exist.
 */
export function planMaterialisation(
  existing: StoredShift[],
  generated: Shift[],
  knownPatternIds: Set<string>,
  today: LocalDate,
): MaterialisationPlan {
  const window = materialiseWindow(today);
  const existingById = new Map(existing.map((s) => [s.id, s]));
  const generatedById = new Map<string, StoredShift>();
  for (const g of generated) {
    if (inWindow(g.date, window)) generatedById.set(g.id, toStored(g));
  }

  // Latest stored date per pattern (rows anywhere, userModified included).
  // Past dates up to it were materialised before and are history.
  const seededThrough = new Map<string, LocalDate>();
  for (const s of existing) {
    if (s.patternId === undefined) continue;
    const max = seededThrough.get(s.patternId);
    if (max === undefined || s.date > max) seededThrough.set(s.patternId, s.date);
  }

  const plan: MaterialisationPlan = { insert: [], update: [], remove: [] };

  // Rule 1: generated id with no stored row -> insert. A past date only if
  // its pattern has no stored row on or after it: a new pattern, or a gap
  // after a long absence (Rule 5 keeps history as is).
  for (const gen of generatedById.values()) {
    if (existingById.has(gen.id)) continue;
    const through = seededThrough.get(gen.patternId as string);
    if (gen.date < today && through !== undefined && gen.date <= through) continue;
    plan.insert.push(gen);
  }

  for (const stored of existing) {
    // A 'pattern' row with no patternId lost its pattern (the FK set it to null).
    const isPatternRow = stored.patternId !== undefined || stored.source === 'pattern';
    if (!isPatternRow || !inWindow(stored.date, window)) continue;
    if (stored.userModified) continue; // Rule 2
    if (stored.date < today) continue; // Rule 5: history stays as is
    const gen = generatedById.get(stored.id);
    if (gen === undefined || stored.patternId === undefined || !knownPatternIds.has(stored.patternId)) {
      // Rule 4: cycle day no longer generated, or pattern deleted.
      plan.remove.push(stored.id);
    } else if (!sameGeneratedValues(stored, gen)) {
      // Rule 3: follow the current pattern; keep status/notes as stored.
      plan.update.push({
        ...stored,
        date: gen.date,
        jobId: gen.jobId,
        start: gen.start,
        end: gen.end,
        unpaidBreakMinutes: gen.unpaidBreakMinutes,
        overtimeFlag: gen.overtimeFlag,
      });
    }
  }
  return plan;
}

type ShiftRow = typeof shifts.$inferSelect;

function rowToStored(row: ShiftRow): StoredShift {
  const { notes, patternId, ...rest } = row;
  const shift: StoredShift = { ...rest };
  if (notes !== null) shift.notes = notes;
  if (patternId !== null) shift.patternId = patternId;
  return shift;
}

function storedToRow(s: StoredShift): ShiftRow {
  return {
    id: s.id,
    jobId: s.jobId,
    date: s.date,
    start: s.start,
    end: s.end,
    unpaidBreakMinutes: s.unpaidBreakMinutes,
    source: s.source,
    status: s.status,
    overtimeFlag: s.overtimeFlag,
    notes: s.notes ?? null,
    patternId: s.patternId ?? null,
    userModified: s.userModified,
  };
}

/**
 * Generates every job's rota-pattern shifts for the window around `today` and
 * applies the plan in one synchronous transaction. Stored shifts are read
 * inside the transaction so the plan and its writes are atomic.
 */
export async function materialiseShifts(db: AppDb, today: LocalDate): Promise<MaterialisationResult> {
  const window = materialiseWindow(today);
  const generated: Shift[] = [];
  const knownPatternIds = new Set<string>();
  for (const job of await listJobs(db)) {
    const templates = await listShiftTemplates(db, job.id);
    for (const pattern of await listRotaPatterns(db, job.id)) {
      knownPatternIds.add(pattern.id);
      generated.push(...generateShifts(pattern, templates, window));
    }
  }

  return db.transaction((tx) => {
    // Pattern shifts anywhere (a user-moved row keeps its generated id) plus
    // every shift in the window, so no insert can collide with a stored id.
    const existing = tx
      .select()
      .from(shifts)
      .where(
        or(isNotNull(shifts.patternId), and(gte(shifts.date, window.start), lte(shifts.date, window.end))),
      )
      .all()
      .map(rowToStored);
    const plan = planMaterialisation(existing, generated, knownPatternIds, today);

    for (const s of plan.insert) tx.insert(shifts).values(storedToRow(s)).run();
    for (const s of plan.update) {
      const { id, ...values } = storedToRow(s);
      tx.update(shifts).set(values).where(eq(shifts.id, id)).run();
    }
    for (const id of plan.remove) tx.delete(shifts).where(eq(shifts.id, id)).run();

    return { inserted: plan.insert.length, updated: plan.update.length, removed: plan.remove.length };
  });
}
