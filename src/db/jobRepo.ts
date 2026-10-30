/**
 * Jobs and premium rules: typed CRUD mapping DB rows <-> engine types.
 * The db is a parameter so the same code runs on expo-sqlite (app) and
 * better-sqlite3 (Jest). DB null <-> optional field absent.
 */
import { asc, desc, eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type { Job, PremiumRate, PremiumRule } from '../engine/types';
import * as schema from './schema';

export type AppDb = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

const { jobs, premiumRules } = schema;

export type StoredJob = Job & { colour?: string };

type JobRow = typeof jobs.$inferSelect;
type RuleRow = typeof premiumRules.$inferSelect;

// ---- jobs -------------------------------------------------------------------

function jobToRow(job: StoredJob): JobRow {
  return {
    id: job.id,
    name: job.name,
    baseRatePence: job.baseRatePence,
    payFrequency: job.payFrequency,
    payPeriodAnchorDate: job.payPeriodAnchorDate,
    payDayOffsetDays: job.payDayOffsetDays,
    periodCutoffDay: job.periodCutoffDay,
    contractedHoursPerWeek: job.contractedHoursPerWeek,
    bankHolidayRegion: job.bankHolidayRegion,
    overtimePremiumMode: job.overtimePremiumMode,
    holidayYearStart: job.holidayYearStart,
    holidayEntitlementHours: job.holidayEntitlementHours,
    holidayMode: job.holidayMode,
    colour: job.colour ?? null,
  };
}

function rowToJob(row: JobRow): StoredJob {
  const { colour, ...rest } = row;
  return colour === null ? rest : { ...rest, colour };
}

export async function listJobs(db: AppDb): Promise<StoredJob[]> {
  const rows = await db.select().from(jobs).orderBy(asc(jobs.name), asc(jobs.id));
  return rows.map(rowToJob);
}

export async function getJob(db: AppDb, id: string): Promise<StoredJob | undefined> {
  const rows = await db.select().from(jobs).where(eq(jobs.id, id));
  return rows.length ? rowToJob(rows[0]) : undefined;
}

export async function createJob(db: AppDb, job: StoredJob): Promise<void> {
  await db.insert(jobs).values(jobToRow(job));
}

/** Full replace by id; throws if no such job. */
export async function updateJob(db: AppDb, job: StoredJob): Promise<void> {
  const { id, ...values } = jobToRow(job);
  const updated = await db
    .update(jobs)
    .set(values)
    .where(eq(jobs.id, id))
    .returning({ id: jobs.id });
  if (updated.length === 0) throw new Error(`Job ${id} not found`);
}

/** Deletes the job; its rules, templates, patterns, shifts and payslips cascade. */
export async function deleteJob(db: AppDb, id: string): Promise<void> {
  await db.delete(jobs).where(eq(jobs.id, id));
}

// ---- premium rules ----------------------------------------------------------

function ruleToRow(rule: PremiumRule): RuleRow {
  return {
    id: rule.id,
    jobId: rule.jobId,
    name: rule.name,
    type: rule.type,
    multiplier: rule.multiplier ?? null,
    flatAddPencePerHour: rule.flatAddPencePerHour ?? null,
    startTime: rule.type === 'time_band' ? rule.startTime : null,
    endTime: rule.type === 'time_band' ? rule.endTime : null,
    daysOfWeek: rule.type === 'day_of_week' ? rule.daysOfWeek : null,
    thresholdHours:
      rule.type === 'overtime_daily' ||
      rule.type === 'overtime_weekly' ||
      rule.type === 'overtime_period'
        ? rule.thresholdHours
        : null,
    weekStartsOn: rule.type === 'overtime_weekly' ? (rule.weekStartsOn ?? null) : null,
    stacking: rule.stacking,
    priority: rule.priority,
  };
}

function corrupt(row: RuleRow, missing: string): never {
  throw new Error(`Premium rule ${row.id} (${row.type}) is corrupt: missing ${missing}`);
}

function rowToRule(row: RuleRow): PremiumRule {
  let rate: PremiumRate;
  if (row.multiplier !== null) rate = { multiplier: row.multiplier };
  else if (row.flatAddPencePerHour !== null)
    rate = { flatAddPencePerHour: row.flatAddPencePerHour };
  else corrupt(row, 'multiplier or flat_add_pence_per_hour');

  const base = {
    id: row.id,
    jobId: row.jobId,
    name: row.name,
    stacking: row.stacking,
    priority: row.priority,
    ...rate,
  };

  const threshold = (): number =>
    row.thresholdHours !== null ? row.thresholdHours : corrupt(row, 'threshold_hours');

  switch (row.type) {
    case 'time_band':
      return {
        ...base,
        type: 'time_band',
        startTime: row.startTime ?? corrupt(row, 'start_time'),
        endTime: row.endTime ?? corrupt(row, 'end_time'),
      };
    case 'day_of_week':
      if (!Array.isArray(row.daysOfWeek)) corrupt(row, 'days_of_week');
      return { ...base, type: 'day_of_week', daysOfWeek: row.daysOfWeek };
    case 'bank_holiday':
      return { ...base, type: 'bank_holiday' };
    case 'overtime_daily':
      return { ...base, type: 'overtime_daily', thresholdHours: threshold() };
    case 'overtime_weekly':
      return row.weekStartsOn === null
        ? { ...base, type: 'overtime_weekly', thresholdHours: threshold() }
        : {
            ...base,
            type: 'overtime_weekly',
            thresholdHours: threshold(),
            weekStartsOn: row.weekStartsOn,
          };
    case 'overtime_period':
      return { ...base, type: 'overtime_period', thresholdHours: threshold() };
    default:
      return corrupt(row, 'a known type');
  }
}

/** Rules for a job, priority descending, then id. */
export async function listPremiumRules(db: AppDb, jobId: string): Promise<PremiumRule[]> {
  const rows = await db
    .select()
    .from(premiumRules)
    .where(eq(premiumRules.jobId, jobId))
    .orderBy(desc(premiumRules.priority), asc(premiumRules.id));
  return rows.map(rowToRule);
}

export async function getPremiumRule(db: AppDb, id: string): Promise<PremiumRule | undefined> {
  const rows = await db.select().from(premiumRules).where(eq(premiumRules.id, id));
  return rows.length ? rowToRule(rows[0]) : undefined;
}

export async function createPremiumRule(db: AppDb, rule: PremiumRule): Promise<void> {
  await db.insert(premiumRules).values(ruleToRow(rule));
}

/** Full replace by id (the type may change); throws if no such rule. */
export async function updatePremiumRule(db: AppDb, rule: PremiumRule): Promise<void> {
  const { id, ...values } = ruleToRow(rule);
  const updated = await db
    .update(premiumRules)
    .set(values)
    .where(eq(premiumRules.id, id))
    .returning({ id: premiumRules.id });
  if (updated.length === 0) throw new Error(`Premium rule ${id} not found`);
}

export async function deletePremiumRule(db: AppDb, id: string): Promise<void> {
  await db.delete(premiumRules).where(eq(premiumRules.id, id));
}
