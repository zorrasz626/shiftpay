import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import {
  BACKUP_APP,
  BACKUP_FORMAT_VERSION,
  BACKUP_TABLE_ORDER,
  type Backup,
  MIN_IMPORT_SCHEMA_VERSION,
  SCHEMA_VERSION,
  exportBackup,
} from '../../db/backup';
import { type AppDb, createJob } from '../../db/jobRepo';
import { createRotaPattern, createShiftTemplate } from '../../db/rotaRepo';
import { setSetting } from '../../db/settingsRepo';
import { createShift } from '../../db/shiftRepo';
import { createTestDb } from '../../db/testDb';
import { useJobsStore } from '../../store/jobsStore';
import { useRotaStore } from '../../store/rotaStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useShiftsStore } from '../../store/shiftsStore';
import { job, resetStores, shift } from '../../store/testFixtures';
import {
  type BackupPicker,
  expoBackupPicker,
  formatBackupDate,
  restoreBackup,
} from '../backupRestore';

const mockText = jest.fn(async (_uri: string) => '');
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((uri: string) => ({ text: () => mockText(uri) })),
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
const mockGetDocument = DocumentPicker.getDocumentAsync as jest.MockedFunction<
  typeof DocumentPicker.getDocumentAsync
>;

const NOW = '2026-06-15T10:00:00.000Z';
const EXPORTED_AT = '2026-06-01T23:30:00.000Z'; // 00:30 BST on 2 Jun.

const picking = (text: string | null): BackupPicker => ({ pickText: jest.fn(async () => text) });

/** The backup file's data: a job with a rota, a manual shift and a setting. */
async function sourceBackup(): Promise<Backup> {
  const src = createTestDb();
  await createJob(src, job);
  await createShiftTemplate(src, {
    id: 'tpl-d',
    jobId: job.id,
    name: 'Day',
    startTime: '08:00',
    endTime: '16:00',
    unpaidBreakMinutes: 30,
  });
  await createRotaPattern(src, {
    id: 'pat-1',
    jobId: job.id,
    cycleLengthDays: 2,
    startDate: '2026-06-01',
    days: [{ shiftTemplateId: 'tpl-d' }, 'OFF'],
  });
  await createShift(src, shift('2026-06-20', { notes: 'cover' }));
  await setSetting(src, 'reminders', { enabled: true });
  return exportBackup(src, EXPORTED_AT);
}

/** The device's current data, which a restore replaces. */
async function targetDb(): Promise<AppDb> {
  const db = createTestDb();
  await createJob(db, { ...job, id: 'job-old', name: 'Old job' });
  await setSetting(db, 'old', 1);
  return db;
}

const tablesOf = async (db: AppDb) => (await exportBackup(db, NOW)).tables;

beforeEach(() => {
  jest.clearAllMocks();
  resetStores();
});

describe('expoBackupPicker', () => {
  it('accepts any file type, copies it to the cache and reads its text', async () => {
    mockGetDocument.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///cache/b.json', name: 'b.json', lastModified: 0 }],
    });
    mockText.mockResolvedValueOnce('{"app":"shiftpay"}');
    await expect(expoBackupPicker.pickText()).resolves.toBe('{"app":"shiftpay"}');
    expect(mockGetDocument).toHaveBeenCalledWith({ type: '*/*', copyToCacheDirectory: true });
    expect(File).toHaveBeenCalledWith('file:///cache/b.json');
  });

  it('returns null when the user cancels or nothing comes back', async () => {
    mockGetDocument.mockResolvedValueOnce({ canceled: true, assets: null });
    await expect(expoBackupPicker.pickText()).resolves.toBeNull();
    mockGetDocument.mockResolvedValueOnce({ canceled: false, assets: [] });
    await expect(expoBackupPicker.pickText()).resolves.toBeNull();
    expect(mockText).not.toHaveBeenCalled();
  });
});

describe('formatBackupDate', () => {
  it('shows the London date', () => {
    expect(formatBackupDate(EXPORTED_AT)).toBe('2 Jun 2026');
    expect(formatBackupDate('2026-11-01T09:30:00.000Z')).toBe('1 Nov 2026');
  });
});

describe('restoreBackup', () => {
  it('replaces every table with the file, re-materialises the rota and reloads the stores', async () => {
    const backup = await sourceBackup();
    const db = await targetDb();
    const confirm = jest.fn(async () => true);

    const result = await restoreBackup(db, NOW, confirm, picking(JSON.stringify(backup)));

    expect(result).toBe('restored');
    expect(confirm).toHaveBeenCalledWith(backup);
    const after = await tablesOf(db);
    for (const name of BACKUP_TABLE_ORDER.filter((n) => n !== 'shifts')) {
      expect(after[name]).toEqual(backup.tables[name]);
    }
    expect(after.shifts).toEqual(expect.arrayContaining(backup.tables.shifts));
    expect(after.shifts.some((s) => s.source === 'pattern' && s.patternId === 'pat-1')).toBe(true);

    expect(useJobsStore.getState().jobs).toEqual([job]);
    expect(useRotaStore.getState().patterns.map((p) => p.id)).toEqual(['pat-1']);
    expect(useSettingsStore.getState().values).toEqual({ reminders: { enabled: true } });
    const stored = useShiftsStore.getState().shifts;
    expect(stored.some((s) => s.id === 's-2026-06-20' && s.notes === 'cover')).toBe(true);
    expect(stored.some((s) => s.source === 'pattern')).toBe(true);
  });

  it('stops quietly when the picker is cancelled', async () => {
    const db = await targetDb();
    const before = await tablesOf(db);
    const confirm = jest.fn(async () => true);
    await expect(restoreBackup(db, NOW, confirm, picking(null))).resolves.toBe('cancelled');
    expect(confirm).not.toHaveBeenCalled();
    expect(await tablesOf(db)).toEqual(before);
    expect(useJobsStore.getState().loaded).toBe(false);
  });

  it('leaves the DB untouched when the user cancels at the dialog', async () => {
    const backup = await sourceBackup();
    const db = await targetDb();
    const before = await tablesOf(db);
    const confirm = jest.fn(async () => false);
    await expect(
      restoreBackup(db, NOW, confirm, picking(JSON.stringify(backup))),
    ).resolves.toBe('cancelled');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(await tablesOf(db)).toEqual(before);
    expect(useJobsStore.getState().loaded).toBe(false);
  });

  const valid = (): Record<string, unknown> => ({
    app: BACKUP_APP,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: EXPORTED_AT,
  });

  it.each([
    ['not JSON', () => '{ nope', 'invalid'],
    ['not an object', () => '[1, 2]', 'invalid'],
    ['another app', () => JSON.stringify({ ...valid(), app: 'other' }), 'not-shiftpay'],
    [
      'a newer format',
      () => JSON.stringify({ ...valid(), formatVersion: BACKUP_FORMAT_VERSION + 1 }),
      'newer-format',
    ],
    [
      'a newer schema',
      () => JSON.stringify({ ...valid(), schemaVersion: SCHEMA_VERSION + 1 }),
      'newer-schema',
    ],
    [
      'an older schema',
      () => JSON.stringify({ ...valid(), schemaVersion: MIN_IMPORT_SCHEMA_VERSION - 1 }),
      'older-schema',
    ],
    ['missing tables', () => JSON.stringify(valid()), 'invalid'],
  ])('rejects %s without asking or touching the DB', async (_label, file, reason) => {
    const db = await targetDb();
    const before = await tablesOf(db);
    const confirm = jest.fn(async () => true);
    await expect(restoreBackup(db, NOW, confirm, picking(file()))).resolves.toBe(reason);
    expect(confirm).not.toHaveBeenCalled();
    expect(await tablesOf(db)).toEqual(before);
  });

  it('rejects when the file cannot be read', async () => {
    const picker: BackupPicker = { pickText: jest.fn(async () => Promise.reject(new Error('io'))) };
    await expect(restoreBackup(createTestDb(), NOW, async () => true, picker)).rejects.toThrow('io');
  });
});
