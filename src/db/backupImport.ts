/**
 * Backup import (PLAN 5.4, data layer): validate a parsed backup file with zod
 * and replace every table with its contents in one transaction. Rows must match
 * the stored types exactly (money is integer pence, never converted); anything
 * else is rejected before the database is touched.
 */
import { getTableColumns } from 'drizzle-orm';
import { type SQLiteColumn, type SQLiteTable, getTableConfig } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';

import {
  BACKUP_APP,
  BACKUP_FORMAT_VERSION,
  BACKUP_TABLE_ORDER,
  type Backup,
  type BackupTableName,
  type BackupTables,
  MIN_IMPORT_SCHEMA_VERSION,
  SCHEMA_VERSION,
} from './backup';
import type { RotaDay } from '../engine/types';
import { BANK_HOLIDAYS_CHECKED_KEY } from '../services/bankHolidayRefresh';
import type { AppDb } from './jobRepo';
import * as schema from './schema';

export type BackupRejectReason =
  'not-shiftpay' | 'newer-format' | 'newer-schema' | 'older-schema' | 'invalid';

export type ParseBackupResult =
  { ok: true; backup: Backup } | { ok: false; reason: BackupRejectReason };

const text = z.string();
const int = z.number().int();
const real = z.number().finite();
const dayOfWeek = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);
const rotaDay = z.union([z.object({ shiftTemplateId: text }).strict(), z.literal('OFF')]);

/** One strict zod object per table, column for column with `schema.ts`. */
export const BACKUP_ROW_SCHEMAS = {
  jobs: z
    .object({
      id: text,
      name: text,
      baseRatePence: int,
      payFrequency: z.enum(['weekly', 'fortnightly', 'four_weekly', 'monthly']),
      payPeriodAnchorDate: text,
      payDayOffsetDays: int,
      periodCutoffDay: int,
      contractedHoursPerWeek: real,
      bankHolidayRegion: z.enum(['england-and-wales', 'scotland', 'northern-ireland']),
      overtimePremiumMode: z.enum(['replace', 'highest', 'stack']),
      holidayYearStart: text,
      holidayEntitlementHours: real,
      holidayMode: z.enum(['fixed', 'accrual']),
      colour: text.nullable(),
    })
    .strict(),
  premiumRules: z
    .object({
      id: text,
      jobId: text,
      name: text,
      type: z.enum([
        'time_band',
        'day_of_week',
        'bank_holiday',
        'overtime_daily',
        'overtime_weekly',
        'overtime_period',
      ]),
      multiplier: real.nullable(),
      flatAddPencePerHour: real.nullable(),
      startTime: text.nullable(),
      endTime: text.nullable(),
      daysOfWeek: z.array(dayOfWeek).nullable(),
      thresholdHours: real.nullable(),
      weekStartsOn: dayOfWeek.nullable(),
      stacking: z.enum(['stack', 'highest_only']),
      priority: int,
    })
    .strict(),
  shiftTemplates: z
    .object({
      id: text,
      jobId: text,
      name: text,
      startTime: text,
      endTime: text,
      unpaidBreakMinutes: int,
      colour: text.nullable(),
    })
    .strict(),
  rotaPatterns: z
    .object({
      id: text,
      jobId: text,
      cycleLengthDays: int,
      startDate: text,
      days: z.array(rotaDay),
    })
    .strict(),
  shifts: z
    .object({
      id: text,
      jobId: text,
      date: text,
      start: text,
      end: text,
      unpaidBreakMinutes: int,
      source: z.enum(['pattern', 'manual']),
      status: z.enum(['planned', 'worked', 'sick', 'holiday', 'cancelled']),
      overtimeFlag: z.boolean(),
      notes: text.nullable(),
      patternId: text.nullable(),
      userModified: z.boolean(),
    })
    .strict(),
  payslips: z
    .object({
      id: text,
      jobId: text,
      periodStart: text,
      periodEnd: text,
      grossPaidPence: int,
      hoursPaid: real.nullable(),
      taxPence: int,
      niPence: int,
      pensionPence: int,
      netPence: int.nullable(),
    })
    .strict(),
  payslipLines: z
    .object({
      id: text,
      payslipId: text,
      position: int,
      label: text,
      hours: real.nullable(),
      amountPence: int,
    })
    .strict(),
  settings: z.object({ key: text, value: text }).strict(),
} as const;

/** The schema's tables by export name (avoids computed access on the namespace). */
const tablesByName: Record<BackupTableName, SQLiteTable> = schema;

/** Property key of a table column object. */
function columnKey(table: SQLiteTable, column: SQLiteColumn): string {
  const entry = Object.entries(getTableColumns(table)).find(([, c]) => c === column);
  /* istanbul ignore next -- a column always belongs to its table */
  if (!entry) throw new Error(`Column ${column.name} not found`);
  return entry[0];
}

function primaryKeyOf(table: SQLiteTable): string {
  const entry = Object.entries(getTableColumns(table)).find(([, c]) => c.primary);
  /* istanbul ignore next -- every table has a primary key */
  if (!entry) throw new Error('Table without primary key');
  return entry[0];
}

interface ForeignKey {
  table: BackupTableName;
  column: string;
  parent: BackupTableName;
  parentColumn: string;
}

/** Every single-column foreign key in the schema, read from Drizzle's metadata. */
function foreignKeys(): ForeignKey[] {
  return BACKUP_TABLE_ORDER.flatMap((name) => {
    const table = tablesByName[name];
    return getTableConfig(table).foreignKeys.map((fk): ForeignKey => {
      const ref = fk.reference();
      const parent = BACKUP_TABLE_ORDER.find((n) => tablesByName[n] === ref.foreignTable);
      /* istanbul ignore next -- every FK points at a schema table */
      if (!parent || ref.columns.length !== 1) throw new Error('Unsupported foreign key');
      return {
        table: name,
        column: columnKey(table, ref.columns[0]),
        parent,
        parentColumn: columnKey(ref.foreignTable, ref.foreignColumns[0]),
      };
    });
  });
}

const PRIMARY_KEYS = Object.fromEntries(
  BACKUP_TABLE_ORDER.map((name) => [name, primaryKeyOf(tablesByName[name])]),
) as Record<BackupTableName, string>;
const FOREIGN_KEYS = foreignKeys();

type LooseTables = Record<BackupTableName, Record<string, unknown>[]>;

/** Cross-row checks zod objects can't express: unique PKs, FKs, CHECKs, JSON settings. */
function checkTables(tables: LooseTables, ctx: z.RefinementCtx): void {
  const issue = (message: string, path: (string | number)[]) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });

  for (const name of BACKUP_TABLE_ORDER) {
    const pk = PRIMARY_KEYS[name];
    const seen = new Set<unknown>();
    tables[name].forEach((row, i) => {
      if (seen.has(row[pk])) issue(`Duplicate ${pk}`, [name, i, pk]);
      seen.add(row[pk]);
    });
  }

  for (const fk of FOREIGN_KEYS) {
    const parentKeys = new Set(tables[fk.parent].map((row) => row[fk.parentColumn]));
    tables[fk.table].forEach((row, i) => {
      if (!parentKeys.has(row[fk.column]))
        issue(`Missing ${fk.parent} row`, [fk.table, i, fk.column]);
    });
  }

  // Rota patterns must be generatable (`generateShifts` throws otherwise):
  // cycle >= 1, one day per cycle day, templates exist on the pattern's job.
  const templateJobs = new Map(tables.shiftTemplates.map((t) => [t.id, t.jobId]));
  tables.rotaPatterns.forEach((row, i) => {
    const days = row.days as RotaDay[];
    const cycle = row.cycleLengthDays as number;
    if (cycle < 1)
      issue('cycleLengthDays must be at least 1', ['rotaPatterns', i, 'cycleLengthDays']);
    if (days.length !== cycle)
      issue('days must match cycleLengthDays', ['rotaPatterns', i, 'days']);
    days.forEach((day, d) => {
      if (day === 'OFF') return;
      if (!templateJobs.has(day.shiftTemplateId)) {
        issue('Missing shiftTemplates row', ['rotaPatterns', i, 'days', d]);
      } else if (templateJobs.get(day.shiftTemplateId) !== row.jobId) {
        issue('Template belongs to another job', ['rotaPatterns', i, 'days', d]);
      }
    });
  });

  // premium_rules_rate_check: exactly one of multiplier / flatAddPencePerHour.
  tables.premiumRules.forEach((row, i) => {
    if ((row.multiplier === null) === (row.flatAddPencePerHour === null)) {
      issue('Exactly one of multiplier / flatAddPencePerHour', ['premiumRules', i]);
    }
  });

  tables.settings.forEach((row, i) => {
    try {
      JSON.parse(row.value as string);
    } catch {
      issue('Setting value is not JSON', ['settings', i, 'value']);
    }
  });
}

const tablesSchema = z
  .object({
    jobs: z.array(BACKUP_ROW_SCHEMAS.jobs),
    premiumRules: z.array(BACKUP_ROW_SCHEMAS.premiumRules),
    shiftTemplates: z.array(BACKUP_ROW_SCHEMAS.shiftTemplates),
    rotaPatterns: z.array(BACKUP_ROW_SCHEMAS.rotaPatterns),
    shifts: z.array(BACKUP_ROW_SCHEMAS.shifts),
    payslips: z.array(BACKUP_ROW_SCHEMAS.payslips),
    payslipLines: z.array(BACKUP_ROW_SCHEMAS.payslipLines),
    settings: z.array(BACKUP_ROW_SCHEMAS.settings),
  } satisfies Record<BackupTableName, z.ZodTypeAny>)
  .strict()
  .superRefine((tables, ctx) => checkTables(tables, ctx));

const backupSchema = z
  .object({
    app: z.literal(BACKUP_APP),
    formatVersion: z.literal(BACKUP_FORMAT_VERSION),
    schemaVersion: z.number().int().min(MIN_IMPORT_SCHEMA_VERSION).max(SCHEMA_VERSION),
    exportedAt: z.string().datetime(),
    tables: tablesSchema,
  })
  .strict();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates a parsed backup file; never throws. */
export function parseBackup(input: unknown): ParseBackupResult {
  if (!isRecord(input)) return { ok: false, reason: 'invalid' };
  if (input.app !== BACKUP_APP) return { ok: false, reason: 'not-shiftpay' };
  const { formatVersion, schemaVersion } = input;
  if (typeof formatVersion === 'number' && formatVersion > BACKUP_FORMAT_VERSION) {
    return { ok: false, reason: 'newer-format' };
  }
  if (typeof schemaVersion === 'number' && formatVersion === BACKUP_FORMAT_VERSION) {
    if (schemaVersion > SCHEMA_VERSION) return { ok: false, reason: 'newer-schema' };
    if (schemaVersion < MIN_IMPORT_SCHEMA_VERSION) return { ok: false, reason: 'older-schema' };
  }
  const result = backupSchema.safeParse(input);
  if (!result.success) return { ok: false, reason: 'invalid' };
  const tables: BackupTables = result.data.tables;
  return { ok: true, backup: { ...result.data, tables } };
}

/** SQLite's lowest default host-parameter limit (999), with headroom. */
const MAX_VARIABLES_PER_INSERT = 900;

/**
 * Settings that describe the device that wrote them, not the user's data: never
 * imported. The bank-holiday check time is dropped (the device's own value is
 * cleared too) because the imported cache may be older than the device's, so
 * the next start-up should check gov.uk instead of waiting up to 7 days.
 */
const DEVICE_LOCAL_SETTINGS: ReadonlySet<string> = new Set([BANK_HOLIDAYS_CHECKED_KEY]);

function rowsToImport(backup: Backup, name: BackupTableName): Record<string, unknown>[] {
  if (name !== 'settings') return backup.tables[name];
  return backup.tables.settings.filter((row) => !DEVICE_LOCAL_SETTINGS.has(row.key));
}

/**
 * Replaces every table with the backup's rows in ONE transaction: delete
 * children first, insert parents first, in chunks. Any error rolls back.
 * Device-local settings (`DEVICE_LOCAL_SETTINGS`) are skipped.
 */
export async function importBackup(db: AppDb, backup: Backup): Promise<void> {
  db.transaction((tx) => {
    for (const name of [...BACKUP_TABLE_ORDER].reverse()) {
      tx.delete(tablesByName[name]).run();
    }
    for (const name of BACKUP_TABLE_ORDER) {
      const table = tablesByName[name];
      const rows = rowsToImport(backup, name) as (typeof table)['$inferInsert'][];
      const chunkSize = Math.max(
        1,
        Math.floor(MAX_VARIABLES_PER_INSERT / Object.keys(getTableColumns(table)).length),
      );
      for (let i = 0; i < rows.length; i += chunkSize) {
        tx.insert(table)
          .values(rows.slice(i, i + chunkSize))
          .run();
      }
    }
  });
}
