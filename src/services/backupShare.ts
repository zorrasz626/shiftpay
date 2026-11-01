/**
 * Backup export to a file the user keeps (SPEC "the user owns the file"):
 * write the JSON snapshot to the cache directory, then open the share sheet so
 * the user can save or send it. `exportBackupToShare` talks only to the
 * `BackupSharer` interface so it can be tested with a fake; `expoBackupSharer`
 * is the one place that touches expo-file-system and expo-sharing.
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { backupFileName, exportBackup } from '../db/backup';
import type { AppDb } from '../db/jobRepo';
import type { IsoInstant } from '../engine/types';

export const BACKUP_MIME_TYPE = 'application/json';
export const BACKUP_DIALOG_TITLE = 'Save your ShiftPay backup';

export interface BackupSharer {
  /** True when this device can open a share sheet. */
  isAvailable(): Promise<boolean>;
  /** Writes `contents` to a cache file called `fileName` (replacing it) and returns its uri. */
  writeFile(fileName: string, contents: string): Promise<string>;
  /** Opens the share sheet for the file at `uri`. */
  share(uri: string): Promise<void>;
}

export type BackupExportResult =
  | { status: 'shared'; uri: string }
  /** The share sheet can't open on this device; nothing was written. */
  | { status: 'unavailable' };

export const expoBackupSharer: BackupSharer = {
  isAvailable() {
    return Sharing.isAvailableAsync();
  },

  async writeFile(fileName, contents) {
    const file = new File(Paths.cache, fileName);
    await file.write(contents);
    return file.uri;
  },

  async share(uri) {
    await Sharing.shareAsync(uri, { mimeType: BACKUP_MIME_TYPE, dialogTitle: BACKUP_DIALOG_TITLE });
  },
};

/**
 * Snapshot every table as pretty JSON (2-space), write it to
 * `backupFileName(now)` and share it. Throws if reading, writing or sharing fails.
 */
export async function exportBackupToShare(
  db: AppDb,
  now: IsoInstant,
  sharer: BackupSharer = expoBackupSharer,
): Promise<BackupExportResult> {
  if (!(await sharer.isAvailable())) return { status: 'unavailable' };
  const json = JSON.stringify(await exportBackup(db, now), null, 2);
  const uri = await sharer.writeFile(backupFileName(now), json);
  await sharer.share(uri);
  return { status: 'shared', uri };
}
