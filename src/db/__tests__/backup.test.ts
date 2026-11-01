/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

import { getTableColumns, getTableName, is, sql } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';

import {
  BACKUP_TABLE_ORDER,
  type Backup,
  type BackupTableName,
  type BackupTables,
  SCHEMA_VERSION,
  backupFileName,
  exportBackup,
} from '../backup';
import { type AppDb, type StoredJob, createJob, createPremiumRule } from '../jobRepo';
import { createPayslip } from '../payslipRepo';
import { createRotaPattern, createShiftTemplate } from '../rotaRepo';
import * as schema from '../schema';
import { setSetting } from '../settingsRepo';
import { createShift } from '../shiftRepo';
import { createTestDb } from '../testDb';

const EXPORTED_AT = '2026-06-01T09:30:00.000Z';

/** The schema's tables by export name (avoids computed access on the namespace). */
const tablesByName: Record<BackupTableName, SQLiteTable> = schema;

const job: StoredJob = {
  id: 'job-b',
  name: 'Warehouse',
  baseRatePence: 1250,
  payFrequency: 'monthly',
  payPeriodAnchorDate: '2026-04-01',
  payDayOffsetDays: 5,
  periodCutoffDay: 31,
  contractedHoursPerWeek: 37.5,
  bankHolidayRegion: 'scotland',
  overtimePremiumMode: 'stack',
  holidayYearStart: '2026-04-01',
  holidayEntitlementHours: 210.25,
  holidayMode: 'accrual',
  colour: '#123456',
};

/** One or more rows in every table, inserted out of primary-key order. */
async function seed(db: AppDb): Promise<void> {
  await createJob(db, job);
  await createJob(db, { ...job, id: 'job-a', name: 'Bar', colour: undefined });
  await createPremiumRule(db, {
    id: 'r-2',
    jobId: 'job-b',
    name: 'Weekend',
    type: 'day_of_week',
    flatAddPencePerHour: 125.5,
    daysOfWeek: [0, 6],
    stacking: 'stack',
    priority: 2,
  });
  await createPremiumRule(db, {
    id: 'r-1',
    jobId: 'job-b',
    name: 'Nights',
    type: 'time_band',
    multiplier: 1.333,
    startTime: '22:00',
    endTime: '06:00',
    stacking: 'highest_only',
    priority: 0,
  });
  await createShiftTemplate(db, {
    id: 'tpl-n',
    jobId: 'job-b',
    name: 'Night',
    startTime: '22:00',
    endTime: '06:00',
    unpaidBreakMinutes: 30,
    colour: '#112233',
  });
  await createRotaPattern(db, {
    id: 'pat-1',
    jobId: 'job-b',
    cycleLengthDays: 2,
    startDate: '2026-01-05',
    days: [{ shiftTemplateId: 'tpl-n' }, 'OFF'],
  });
  await createShift(db, {
    id: 's-rota',
    jobId: 'job-b',
    date: '2026-03-28',
    start: '2026-03-28T22:00:00.000Z',
    end: '2026-03-29T06:00:00.000Z',
    unpaidBreakMinutes: 30,
    source: 'pattern',
    status: 'worked',
    overtimeFlag: true,
    notes: 'Covered for Sam',
    patternId: 'pat-1',
    userModified: true,
  });
  await createShift(db, {
    id: 's-manual',
    jobId: 'job-a',
    date: '2026-03-30',
    start: '2026-03-30T08:00:00.000Z',
    end: '2026-03-30T16:00:00.000Z',
    unpaidBreakMinutes: 0,
    source: 'manual',
    status: 'planned',
    overtimeFlag: false,
    userModified: false,
  });
  await createPayslip(db, {
    id: 'p-1',
    jobId: 'job-b',
    periodStart: '2026-04-01',
    periodEnd: '2026-04-30',
    grossPaidPence: 215_037,
    hoursPaid: 162.5,
    lines: [
      { label: 'Basic', hours: 150, amountPence: 187_500 },
      { label: 'Bonus', amountPence: 6_700 },
    ],
    taxPence: 25_000,
    niPence: 9_000,
    pensionPence: 6_450,
    netPence: 174_587,
  });
  await setSetting(db, 'reminders', { enabled: true, minutesBefore: 60 });
  await setSetting(db, 'activeJobId', 'job-b');
  await setSetting(db, 'onboarded', true);
}

/** Test-only import: inserts exported rows in FK order (5.4 owns the real one). */
function insertAll(db: AppDb, tables: BackupTables): void {
  for (const name of BACKUP_TABLE_ORDER) {
    const rows = tables[name];
    if (rows.length === 0) continue;
    const table = tablesByName[name];
    db.insert(table)
      .values(rows as (typeof table)['$inferInsert'][])
      .run();
  }
}

function totalChanges(db: AppDb): number {
  return db.get<{ n: number }>(sql`select total_changes() as n`).n;
}

describe('exportBackup', () => {
  let db: AppDb;

  beforeEach(async () => {
    db = createTestDb();
    await seed(db);
  });

  it('wraps the tables in a versioned envelope', async () => {
    const backup = await exportBackup(db, EXPORTED_AT);
    expect(backup).toMatchObject({
      app: 'shiftpay',
      formatVersion: 1,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: EXPORTED_AT,
    });
  });

  it('schemaVersion matches the migrations journal', () => {
    const journal = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../drizzle/meta/_journal.json'), 'utf8'),
    ) as { entries: unknown[] };
    expect(SCHEMA_VERSION).toBe(journal.entries.length);
  });

  it('exports every schema table, each in BACKUP_TABLE_ORDER', async () => {
    const schemaTables = Object.entries(schema)
      .filter(([, v]) => is(v, SQLiteTable))
      .map(([k]) => k)
      .sort();
    const backup = await exportBackup(db, EXPORTED_AT);
    expect(Object.keys(backup.tables).sort()).toEqual(schemaTables);
    expect([...BACKUP_TABLE_ORDER].sort()).toEqual(schemaTables);
  });

  it('exports every column of every table', async () => {
    const backup = await exportBackup(db, EXPORTED_AT);
    for (const name of BACKUP_TABLE_ORDER) {
      const columns = Object.keys(getTableColumns(tablesByName[name])).sort();
      const rows = backup.tables[name];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect([name, Object.keys(row).sort()]).toEqual([name, columns]);
      }
    }
  });

  it('keeps stored types and sorts rows by primary key', async () => {
    const { tables } = await exportBackup(db, EXPORTED_AT);
    expect(tables.jobs.map((r) => r.id)).toEqual(['job-a', 'job-b']);
    expect(tables.premiumRules.map((r) => r.id)).toEqual(['r-1', 'r-2']);
    expect(tables.shifts.map((r) => r.id)).toEqual(['s-manual', 's-rota']);
    expect(tables.settings.map((r) => r.key)).toEqual(['activeJobId', 'onboarded', 'reminders']);
    expect(tables.jobs[1].baseRatePence).toBe(1250);
    expect(tables.jobs[0].colour).toBeNull();
    expect(tables.payslips[0]).toMatchObject({ grossPaidPence: 215_037, netPence: 174_587 });
    expect(tables.payslipLines.map((l) => l.amountPence).sort((a, b) => a - b)).toEqual([
      6_700, 187_500,
    ]);
    expect(tables.settings[0].value).toBe('"job-b"');
    expect(tables.settings[2].value).toBe('{"enabled":true,"minutesBefore":60}');
  });

  it('is read-only', async () => {
    const before = totalChanges(db);
    await exportBackup(db, EXPORTED_AT);
    expect(totalChanges(db)).toBe(before);
  });

  it('round-trips through JSON into a fresh database', async () => {
    const first = await exportBackup(db, EXPORTED_AT);
    const parsed = JSON.parse(JSON.stringify(first)) as Backup;
    expect(parsed).toEqual(first);
    const fresh = createTestDb();
    insertAll(fresh, parsed.tables);
    expect(await exportBackup(fresh, EXPORTED_AT)).toEqual(first);
  });

  it('exports empty arrays for an empty database', async () => {
    const backup = await exportBackup(createTestDb(), EXPORTED_AT);
    for (const name of BACKUP_TABLE_ORDER) expect(backup.tables[name]).toEqual([]);
  });
});

describe('backupFileName', () => {
  it('uses the London date, around midnight in BST', () => {
    // 23:30 UTC on 1 June is 00:30 BST on 2 June.
    expect(backupFileName('2026-06-01T23:30:00.000Z')).toBe('shiftpay-backup-2026-06-02.json');
    expect(backupFileName('2026-06-01T22:59:00.000Z')).toBe('shiftpay-backup-2026-06-01.json');
    expect(backupFileName('2026-06-01T23:00:00.000Z')).toBe('shiftpay-backup-2026-06-02.json');
  });

  it('uses the London date in GMT', () => {
    expect(backupFileName('2026-01-15T23:59:00.000Z')).toBe('shiftpay-backup-2026-01-15.json');
    expect(backupFileName('2026-01-16T00:00:00.000Z')).toBe('shiftpay-backup-2026-01-16.json');
  });
});
