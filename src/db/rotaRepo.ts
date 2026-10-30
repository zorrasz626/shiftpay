/**
 * Shift templates and rota patterns: typed CRUD mapping DB rows <-> engine types.
 * DB null <-> optional field absent.
 */
import { asc, eq } from 'drizzle-orm';

import type { RotaPattern, ShiftTemplate } from '../engine/types';
import type { AppDb } from './jobRepo';
import { rotaPatterns, shiftTemplates } from './schema';

export type StoredShiftTemplate = ShiftTemplate & { colour?: string };

type TemplateRow = typeof shiftTemplates.$inferSelect;
type PatternRow = typeof rotaPatterns.$inferSelect;

// ---- shift templates --------------------------------------------------------

function templateToRow(t: StoredShiftTemplate): TemplateRow {
  return {
    id: t.id,
    jobId: t.jobId,
    name: t.name,
    startTime: t.startTime,
    endTime: t.endTime,
    unpaidBreakMinutes: t.unpaidBreakMinutes,
    colour: t.colour ?? null,
  };
}

function rowToTemplate(row: TemplateRow): StoredShiftTemplate {
  const { colour, ...rest } = row;
  return colour === null ? rest : { ...rest, colour };
}

/** Templates for a job, by name. */
export async function listShiftTemplates(db: AppDb, jobId: string): Promise<StoredShiftTemplate[]> {
  const rows = await db
    .select()
    .from(shiftTemplates)
    .where(eq(shiftTemplates.jobId, jobId))
    .orderBy(asc(shiftTemplates.name), asc(shiftTemplates.id));
  return rows.map(rowToTemplate);
}

export async function getShiftTemplate(
  db: AppDb,
  id: string,
): Promise<StoredShiftTemplate | undefined> {
  const rows = await db.select().from(shiftTemplates).where(eq(shiftTemplates.id, id));
  return rows.length ? rowToTemplate(rows[0]) : undefined;
}

export async function createShiftTemplate(db: AppDb, t: StoredShiftTemplate): Promise<void> {
  await db.insert(shiftTemplates).values(templateToRow(t));
}

/** Full replace by id; throws if no such template. */
export async function updateShiftTemplate(db: AppDb, t: StoredShiftTemplate): Promise<void> {
  const { id, ...values } = templateToRow(t);
  const updated = await db
    .update(shiftTemplates)
    .set(values)
    .where(eq(shiftTemplates.id, id))
    .returning({ id: shiftTemplates.id });
  if (updated.length === 0) throw new Error(`Shift template ${id} not found`);
}

export async function deleteShiftTemplate(db: AppDb, id: string): Promise<void> {
  await db.delete(shiftTemplates).where(eq(shiftTemplates.id, id));
}

// ---- rota patterns ----------------------------------------------------------

function patternToRow(p: RotaPattern): PatternRow {
  if (p.days.length !== p.cycleLengthDays) {
    throw new Error(
      `Rota pattern ${p.id}: days has ${p.days.length} entries, cycle length is ${p.cycleLengthDays}`,
    );
  }
  return {
    id: p.id,
    jobId: p.jobId,
    cycleLengthDays: p.cycleLengthDays,
    startDate: p.startDate,
    days: p.days,
  };
}

function rowToPattern(row: PatternRow): RotaPattern {
  return {
    id: row.id,
    jobId: row.jobId,
    cycleLengthDays: row.cycleLengthDays,
    startDate: row.startDate,
    days: row.days,
  };
}

/** Patterns for a job, by id. */
export async function listRotaPatterns(db: AppDb, jobId: string): Promise<RotaPattern[]> {
  const rows = await db
    .select()
    .from(rotaPatterns)
    .where(eq(rotaPatterns.jobId, jobId))
    .orderBy(asc(rotaPatterns.id));
  return rows.map(rowToPattern);
}

export async function getRotaPattern(db: AppDb, id: string): Promise<RotaPattern | undefined> {
  const rows = await db.select().from(rotaPatterns).where(eq(rotaPatterns.id, id));
  return rows.length ? rowToPattern(rows[0]) : undefined;
}

/** Throws if days.length !== cycleLengthDays. */
export async function createRotaPattern(db: AppDb, p: RotaPattern): Promise<void> {
  await db.insert(rotaPatterns).values(patternToRow(p));
}

/** Full replace by id; throws if no such pattern or days.length !== cycleLengthDays. */
export async function updateRotaPattern(db: AppDb, p: RotaPattern): Promise<void> {
  const { id, ...values } = patternToRow(p);
  const updated = await db
    .update(rotaPatterns)
    .set(values)
    .where(eq(rotaPatterns.id, id))
    .returning({ id: rotaPatterns.id });
  if (updated.length === 0) throw new Error(`Rota pattern ${id} not found`);
}

export async function deleteRotaPattern(db: AppDb, id: string): Promise<void> {
  await db.delete(rotaPatterns).where(eq(rotaPatterns.id, id));
}
