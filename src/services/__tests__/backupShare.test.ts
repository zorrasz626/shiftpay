import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { backupFileName, exportBackup } from '../../db/backup';
import { createJob } from '../../db/jobRepo';
import { setSetting } from '../../db/settingsRepo';
import { createTestDb } from '../../db/testDb';
import { job } from '../../store/testFixtures';
import {
  BACKUP_DIALOG_TITLE,
  BACKUP_MIME_TYPE,
  type BackupSharer,
  exportBackupToShare,
} from '../backupShare';

const mockWrite = jest.fn(async (_contents: string) => {});
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  File: jest.fn().mockImplementation((dir: { uri: string }, name: string) => ({
    uri: `${dir.uri}${name}`,
    write: (contents: string) => mockWrite(contents),
  })),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => {}),
}));

const mockedSharing = Sharing as jest.Mocked<typeof Sharing>;
const NOW = '2026-06-01T23:30:00.000Z'; // 00:30 BST on 2 Jun: the file is dated 2 Jun.

beforeEach(() => {
  jest.clearAllMocks();
});

describe('exportBackupToShare', () => {
  it('writes the pretty JSON snapshot to the dated cache file, then shares that file', async () => {
    const db = createTestDb();
    await createJob(db, job);
    await setSetting(db, 'example', { on: true });

    const result = await exportBackupToShare(db, NOW);

    const expectedJson = JSON.stringify(await exportBackup(db, NOW), null, 2);
    const uri = `file:///cache/${backupFileName(NOW)}`;
    expect(backupFileName(NOW)).toBe('shiftpay-backup-2026-06-02.json');
    expect(File).toHaveBeenCalledWith({ uri: 'file:///cache/' }, backupFileName(NOW));
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite).toHaveBeenCalledWith(expectedJson);
    expect(expectedJson).toContain('\n  "app": "shiftpay"');
    expect(mockedSharing.shareAsync).toHaveBeenCalledWith(uri, {
      mimeType: BACKUP_MIME_TYPE,
      dialogTitle: BACKUP_DIALOG_TITLE,
    });
    expect(BACKUP_MIME_TYPE).toBe('application/json');
    expect(BACKUP_DIALOG_TITLE).toBe('Save your ShiftPay backup');
    expect(mockWrite.mock.invocationCallOrder[0]).toBeLessThan(
      mockedSharing.shareAsync.mock.invocationCallOrder[0],
    );
    expect(result).toEqual({ status: 'shared', uri });
  });

  it('returns unavailable and writes nothing when the share sheet cannot open', async () => {
    mockedSharing.isAvailableAsync.mockResolvedValueOnce(false);
    await expect(exportBackupToShare(createTestDb(), NOW)).resolves.toEqual({
      status: 'unavailable',
    });
    expect(mockWrite).not.toHaveBeenCalled();
    expect(mockedSharing.shareAsync).not.toHaveBeenCalled();
  });

  it('rejects when writing fails, without sharing', async () => {
    mockWrite.mockRejectedValueOnce(new Error('disk full'));
    await expect(exportBackupToShare(createTestDb(), NOW)).rejects.toThrow('disk full');
    expect(mockedSharing.shareAsync).not.toHaveBeenCalled();
  });

  it('works with any sharer', async () => {
    const sharer: BackupSharer = {
      isAvailable: jest.fn(async () => true),
      writeFile: jest.fn(async (name: string) => `mem://${name}`),
      share: jest.fn(async () => {}),
    };
    const db = createTestDb();
    await expect(exportBackupToShare(db, NOW, sharer)).resolves.toEqual({
      status: 'shared',
      uri: 'mem://shiftpay-backup-2026-06-02.json',
    });
    expect(sharer.writeFile).toHaveBeenCalledWith(
      'shiftpay-backup-2026-06-02.json',
      JSON.stringify(await exportBackup(db, NOW), null, 2),
    );
    expect(sharer.share).toHaveBeenCalledWith('mem://shiftpay-backup-2026-06-02.json');
  });
});
