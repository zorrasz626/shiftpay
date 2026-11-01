/**
 * Backup export (SPEC "Backup: export/import a JSON file"): a versioned,
 * JSON-safe snapshot of every table. Rows are the raw Drizzle rows of each
 * table (all columns, camelCase keys, stored types: money stays integer pence,
 * settings values stay their stored JSON text), sorted by primary key so the
 * output is deterministic. Read-only: one read transaction, no writes.
 */
import { asc } from 'drizzle-orm';

import { instantToLocal } from '../engine/time';
import type { IsoInstant } from '../engine/types';
import type { AppDb } from './jobRepo';
import * as schema from './schema';

export const BACKUP_APP = 'shiftpay';
export const BACKUP_FORMAT_VERSION = 1;
/** Number of applied Drizzle migrations (`drizzle/meta/_journal.json` entries); a test keeps it in sync. */
export const SCHEMA_VERSION = 2;
/** Oldest schema an import accepts: v1 -> v2 added only the index `shifts_date_idx`, same tables. */
export const MIN_IMPORT_SCHEMA_VERSION = 1;

/** Every table, parents before children (the order an import must insert in). */
export const BACKUP_TABLE_ORDER = [
  'jobs',
  'premiumRules',
  'shiftTemplates',
  'rotaPatterns',
  'shifts',
  'payslips',
  'payslipLines',
  'settings',
] as const;

export type BackupTableName = (typeof BACKUP_TABLE_ORDER)[number];

export type BackupTables = {
  [K in BackupTableName]: (typeof schema)[K]['$inferSelect'][];
};

export interface Backup {
  app: typeof BACKUP_APP;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  schemaVersion: number;
  exportedAt: IsoInstant;
  tables: BackupTables;
}

/** Snapshot of every table; `exportedAt` is passed in (no clock reads here). */
export async function exportBackup(db: AppDb, exportedAt: IsoInstant): Promise<Backup> {
  const {
    jobs,
    premiumRules,
    shiftTemplates,
    rotaPatterns,
    shifts,
    payslips,
    payslipLines,
    settings,
  } = schema;
  const tables = db.transaction(
    (tx): BackupTables => ({
      jobs: tx.select().from(jobs).orderBy(asc(jobs.id)).all(),
      premiumRules: tx.select().from(premiumRules).orderBy(asc(premiumRules.id)).all(),
      shiftTemplates: tx.select().from(shiftTemplates).orderBy(asc(shiftTemplates.id)).all(),
      rotaPatterns: tx.select().from(rotaPatterns).orderBy(asc(rotaPatterns.id)).all(),
      shifts: tx.select().from(shifts).orderBy(asc(shifts.id)).all(),
      payslips: tx.select().from(payslips).orderBy(asc(payslips.id)).all(),
      payslipLines: tx.select().from(payslipLines).orderBy(asc(payslipLines.id)).all(),
      settings: tx.select().from(settings).orderBy(asc(settings.key)).all(),
    }),
  );
  return {
    app: BACKUP_APP,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    tables,
  };
}

/** `shiftpay-backup-YYYY-MM-DD.json`, dated in Europe/London. */
export function backupFileName(exportedAt: IsoInstant): string {
  return `shiftpay-backup-${instantToLocal(exportedAt).date}.json`;
}
