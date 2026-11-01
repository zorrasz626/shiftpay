/**
 * @jest-environment node
 */
import { getTableColumns, is } from 'drizzle-orm';
import { type SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { ZodTypeAny } from 'zod';

import {
  BACKUP_TABLE_ORDER,
  type Backup,
  type BackupTableName,
  MIN_IMPORT_SCHEMA_VERSION,
  SCHEMA_VERSION,
  exportBackup,
} from '../backup';
import { BACKUP_ROW_SCHEMAS, importBackup, parseBackup } from '../backupImport';
import { type AppDb, type StoredJob, createJob, createPremiumRule } from '../jobRepo';
import { createPayslip } from '../payslipRepo';
import { createRotaPattern, createShiftTemplate } from '../rotaRepo';
import * as schema from '../schema';
import { BANK_HOLIDAYS_CHECKED_KEY } from '../../services/bankHolidayRefresh';
import { BANK_HOLIDAYS_CACHE_KEY } from '../../store/bankHolidaysStore';
import { getSetting, setSetting } from '../settingsRepo';
import { createShift } from '../shiftRepo';
import { createTestDb } from '../testDb';

const EXPORTED_AT = '2026-06-01T09:30:00.000Z';

const tablesByName: Record<BackupTableName, SQLiteTable> = schema;
const rowSchemas: Record<BackupTableName, { shape: Record<string, ZodTypeAny> }> =
  BACKUP_ROW_SCHEMAS;

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

/** One or more rows in every table. */
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
    name: 'Overtime',
    type: 'overtime_weekly',
    multiplier: 1.5,
    thresholdHours: 40,
    weekStartsOn: 1,
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
}

/** Different contents for the import target. */
async function seedOther(db: AppDb): Promise<void> {
  await createJob(db, { ...job, id: 'job-z', name: 'Other', baseRatePence: 999 });
  await createShift(db, {
    id: 's-other',
    jobId: 'job-z',
    date: '2026-02-01',
    start: '2026-02-01T08:00:00.000Z',
    end: '2026-02-01T12:00:00.000Z',
    unpaidBreakMinutes: 0,
    source: 'manual',
    status: 'planned',
    overtimeFlag: false,
    userModified: false,
  });
  await setSetting(db, 'activeJobId', 'job-z');
  await setSetting(db, 'onboarded', true);
}

/** A seeded backup as it comes back from a file (plain JSON). */
async function seededFile(): Promise<Backup> {
  const db = createTestDb();
  await seed(db);
  return JSON.parse(JSON.stringify(await exportBackup(db, EXPORTED_AT))) as Backup;
}

/** Deep copy of a backup with loose typing for corrupting it. */
type Loose = Record<string, unknown> & { tables: Record<string, Record<string, unknown>[]> };
function mutable(backup: Backup): Loose {
  return JSON.parse(JSON.stringify(backup)) as Loose;
}

function reasonOf(input: unknown): string {
  const result = parseBackup(input);
  return result.ok ? 'ok' : result.reason;
}

describe('BACKUP_ROW_SCHEMAS', () => {
  it('covers every schema table', () => {
    const schemaTables = Object.entries(schema)
      .filter(([, v]) => is(v, SQLiteTable))
      .map(([k]) => k)
      .sort();
    expect(Object.keys(BACKUP_ROW_SCHEMAS).sort()).toEqual(schemaTables);
  });

  it('matches every column: name, nullability, type and enum values', () => {
    for (const name of BACKUP_TABLE_ORDER) {
      const columns: Record<string, SQLiteColumn> = getTableColumns(tablesByName[name]);
      const shape = rowSchemas[name].shape;
      expect([name, Object.keys(shape).sort()]).toEqual([name, Object.keys(columns).sort()]);
      for (const [key, column] of Object.entries(columns)) {
        const field = shape[key];
        const accepts = (v: unknown) => field.safeParse(v).success;
        const label = `${name}.${key}`;
        expect([label, accepts(null)]).toEqual([label, !column.notNull]);
        if (column.enumValues) {
          for (const v of column.enumValues)
            expect([label, v, accepts(v)]).toEqual([label, v, true]);
          expect([label, accepts('not-an-enum-value')]).toEqual([label, false]);
        }
        switch (column.columnType) {
          case 'SQLiteInteger':
            expect([label, accepts(1), accepts(1.5), accepts('1')]).toEqual([
              label,
              true,
              false,
              false,
            ]);
            break;
          case 'SQLiteReal':
            expect([label, accepts(1.5), accepts('1.5')]).toEqual([label, true, false]);
            break;
          case 'SQLiteBoolean':
            expect([label, accepts(true), accepts(1)]).toEqual([label, true, false]);
            break;
          case 'SQLiteText':
            expect([label, accepts(1)]).toEqual([label, false]);
            if (!column.enumValues) expect([label, accepts('x')]).toEqual([label, true]);
            break;
          case 'SQLiteTextJson':
            expect([label, accepts([])]).toEqual([label, true]);
            break;
          default:
            throw new Error(`Unhandled column type ${column.columnType} in ${label}`);
        }
      }
    }
  });
});

describe('parseBackup', () => {
  let file: Backup;

  beforeAll(async () => {
    file = await seededFile();
  });

  it('accepts an exported file unchanged', () => {
    const result = parseBackup(file);
    expect(result).toEqual({ ok: true, backup: file });
  });

  it('rejects non-objects and null', () => {
    for (const input of [null, undefined, 'shiftpay', 42, [], [file]]) {
      expect(reasonOf(input)).toBe('invalid');
    }
  });

  it('rejects files from another app', () => {
    expect(reasonOf({ ...file, app: 'other' })).toBe('not-shiftpay');
    const { app: _app, ...noApp } = file;
    expect(reasonOf(noApp)).toBe('not-shiftpay');
    expect(reasonOf({})).toBe('not-shiftpay');
  });

  it('rejects newer formats before looking at the tables', () => {
    expect(reasonOf({ app: 'shiftpay', formatVersion: 2, tables: 'whatever' })).toBe(
      'newer-format',
    );
    expect(reasonOf({ ...file, formatVersion: 0 })).toBe('invalid');
    expect(reasonOf({ ...file, formatVersion: '1' })).toBe('invalid');
  });

  it('rejects newer and older schema versions', () => {
    expect(reasonOf({ ...file, schemaVersion: SCHEMA_VERSION + 1 })).toBe('newer-schema');
    expect(reasonOf({ ...file, schemaVersion: MIN_IMPORT_SCHEMA_VERSION - 1 })).toBe('older-schema');
    expect(reasonOf({ ...file, schemaVersion: String(SCHEMA_VERSION) })).toBe('invalid');
  });

  it('rejects a bad envelope', () => {
    expect(reasonOf({ ...file, exportedAt: 'yesterday' })).toBe('invalid');
    expect(reasonOf({ ...file, extra: true })).toBe('invalid');
    const { tables: _tables, ...noTables } = file;
    expect(reasonOf(noTables)).toBe('invalid');
  });

  it('rejects a missing or unknown table', () => {
    const missing = mutable(file);
    delete missing.tables.settings;
    expect(reasonOf(missing)).toBe('invalid');
    const extra = mutable(file);
    extra.tables.employers = [];
    expect(reasonOf(extra)).toBe('invalid');
  });

  it('rejects extra and missing columns', () => {
    const extra = mutable(file);
    extra.tables.jobs[0].employer = 'ACME';
    expect(reasonOf(extra)).toBe('invalid');
    const missing = mutable(file);
    delete missing.tables.shifts[0].userModified;
    expect(reasonOf(missing)).toBe('invalid');
  });

  it('rejects money that is not integer pence', () => {
    for (const bad of [1250.5, '1250', null]) {
      const b = mutable(file);
      b.tables.jobs[0].baseRatePence = bad;
      expect(reasonOf(b)).toBe('invalid');
    }
    const line = mutable(file);
    line.tables.payslipLines[0].amountPence = 6700.01;
    expect(reasonOf(line)).toBe('invalid');
  });

  it('rejects wrong types in other columns', () => {
    const cases: [BackupTableName, string, unknown][] = [
      ['shifts', 'overtimeFlag', 1],
      ['premiumRules', 'daysOfWeek', [7]],
      ['premiumRules', 'weekStartsOn', 1.5],
      ['rotaPatterns', 'days', [{ shiftTemplateId: 'tpl-n', extra: 1 }]],
      ['rotaPatterns', 'days', ['ON']],
      ['rotaPatterns', 'days', '[]'],
      ['jobs', 'name', null],
    ];
    for (const [table, column, value] of cases) {
      const b = mutable(file);
      b.tables[table][0][column] = value;
      expect([table, column, reasonOf(b)]).toEqual([table, column, 'invalid']);
    }
  });

  it('rejects bad enum values', () => {
    const b = mutable(file);
    b.tables.shifts[0].status = 'absent';
    expect(reasonOf(b)).toBe('invalid');
    const region = mutable(file);
    region.tables.jobs[0].bankHolidayRegion = 'wales';
    expect(reasonOf(region)).toBe('invalid');
  });

  it('rejects orphan foreign keys', () => {
    const shift = mutable(file);
    shift.tables.shifts[0].jobId = 'job-missing';
    expect(reasonOf(shift)).toBe('invalid');
    const line = mutable(file);
    line.tables.payslipLines[0].payslipId = 'p-missing';
    expect(reasonOf(line)).toBe('invalid');
    const noJobs = mutable(file);
    noJobs.tables.jobs = [];
    expect(reasonOf(noJobs)).toBe('invalid');
  });

  it('rejects a rota pattern with a cycle shorter than 1', () => {
    const b = mutable(file);
    b.tables.rotaPatterns[0].cycleLengthDays = 0;
    b.tables.rotaPatterns[0].days = [];
    expect(reasonOf(b)).toBe('invalid');
  });

  it('rejects a rota pattern whose days do not match its cycle length', () => {
    const b = mutable(file);
    b.tables.rotaPatterns[0].cycleLengthDays = 3;
    expect(reasonOf(b)).toBe('invalid');
  });

  it('rejects a rota pattern day with a missing shift template', () => {
    const b = mutable(file);
    b.tables.rotaPatterns[0].days = [{ shiftTemplateId: 'tpl-missing' }, 'OFF'];
    expect(reasonOf(b)).toBe('invalid');
  });

  it("rejects a rota pattern day using another job's shift template", () => {
    const b = mutable(file);
    b.tables.rotaPatterns[0].jobId = 'job-a';
    expect(reasonOf(b)).toBe('invalid');
  });

  it('rejects duplicate primary keys', () => {
    const jobs = mutable(file);
    jobs.tables.jobs[1].id = jobs.tables.jobs[0].id;
    expect(reasonOf(jobs)).toBe('invalid');
    const settings = mutable(file);
    settings.tables.settings.push({ ...settings.tables.settings[0] });
    expect(reasonOf(settings)).toBe('invalid');
  });

  it('rejects a premium rule with both or neither rate', () => {
    const both = mutable(file);
    both.tables.premiumRules[0].multiplier = 1.5;
    both.tables.premiumRules[0].flatAddPencePerHour = 100;
    expect(reasonOf(both)).toBe('invalid');
    const neither = mutable(file);
    neither.tables.premiumRules[0].multiplier = null;
    neither.tables.premiumRules[0].flatAddPencePerHour = null;
    expect(reasonOf(neither)).toBe('invalid');
  });

  it('rejects a setting value that is not JSON', () => {
    const b = mutable(file);
    b.tables.settings[0].value = 'job-b';
    expect(reasonOf(b)).toBe('invalid');
  });
});

describe('importBackup', () => {
  it('replaces different existing data with the backup', async () => {
    const source = createTestDb();
    await seed(source);
    const original = await exportBackup(source, EXPORTED_AT);
    const parsed = parseBackup(JSON.parse(JSON.stringify(original)));
    if (!parsed.ok) throw new Error(parsed.reason);

    const target = createTestDb();
    await seedOther(target);
    await importBackup(target, parsed.backup);
    const after = await exportBackup(target, '2026-07-01T00:00:00.000Z');
    expect({ ...after, exportedAt: EXPORTED_AT }).toEqual(original);
  });

  it('imports into an empty database', async () => {
    const file = await seededFile();
    const parsed = parseBackup(file);
    if (!parsed.ok) throw new Error(parsed.reason);
    const target = createTestDb();
    await importBackup(target, parsed.backup);
    expect(await exportBackup(target, EXPORTED_AT)).toEqual(file);
  });

  it('imports a v1 file, which has the same tables as the current schema', async () => {
    const file = await seededFile();
    const v1 = { ...file, schemaVersion: 1 };
    const parsed = parseBackup(v1);
    expect(parsed).toEqual({ ok: true, backup: v1 });
    if (!parsed.ok) throw new Error(parsed.reason);
    const target = createTestDb();
    await importBackup(target, parsed.backup);
    expect(await exportBackup(target, EXPORTED_AT)).toEqual(file);
  });

  it('imports an empty backup by clearing every table', async () => {
    const empty = await exportBackup(createTestDb(), EXPORTED_AT);
    const parsed = parseBackup(JSON.parse(JSON.stringify(empty)));
    if (!parsed.ok) throw new Error(parsed.reason);
    const target = createTestDb();
    await seed(target);
    await importBackup(target, parsed.backup);
    expect(await exportBackup(target, EXPORTED_AT)).toEqual(empty);
  });

  it('inserts large tables in chunks', async () => {
    const file = mutable(await seededFile());
    const template = file.tables.shifts[0];
    file.tables.shifts = Array.from({ length: 1000 }, (_, i) => ({
      ...template,
      id: `s-${String(i).padStart(4, '0')}`,
    }));
    const parsed = parseBackup(file);
    if (!parsed.ok) throw new Error(parsed.reason);
    const target = createTestDb();
    await importBackup(target, parsed.backup);
    const after = await exportBackup(target, EXPORTED_AT);
    expect(after.tables.shifts).toEqual(parsed.backup.tables.shifts);
  });

  it("drops the bank-holiday check time (backup's and device's) but imports the cached data", async () => {
    const source = createTestDb();
    await seed(source);
    const cache = { fetchedAt: '2026-05-01', regions: { scotland: ['2026-05-04'] } };
    await setSetting(source, BANK_HOLIDAYS_CACHE_KEY, cache);
    await setSetting(source, BANK_HOLIDAYS_CHECKED_KEY, '2026-05-01T09:00:00.000Z');
    const file = await exportBackup(source, EXPORTED_AT);
    expect(file.tables.settings.map((s) => s.key)).toContain(BANK_HOLIDAYS_CHECKED_KEY);
    const parsed = parseBackup(JSON.parse(JSON.stringify(file)));
    if (!parsed.ok) throw new Error(parsed.reason);

    const target = createTestDb();
    await seedOther(target);
    await setSetting(target, BANK_HOLIDAYS_CHECKED_KEY, '2026-06-30T09:00:00.000Z');
    await importBackup(target, parsed.backup);

    expect(await getSetting(target, BANK_HOLIDAYS_CHECKED_KEY)).toBeUndefined();
    expect(await getSetting(target, BANK_HOLIDAYS_CACHE_KEY)).toEqual(cache);
    expect(await getSetting(target, 'activeJobId')).toBe('job-b');
  });

  it('rolls back everything when a later table fails', async () => {
    const target = createTestDb();
    await seedOther(target);
    const before = await exportBackup(target, EXPORTED_AT);

    // Bypasses parseBackup: the orphan payslip line fails its FK after the
    // deletes and the earlier inserts have run.
    const bad = mutable(await seededFile());
    bad.tables.payslipLines[0].payslipId = 'p-missing';
    await expect(importBackup(target, bad as unknown as Backup)).rejects.toThrow();

    expect(await exportBackup(target, EXPORTED_AT)).toEqual(before);
  });
});
