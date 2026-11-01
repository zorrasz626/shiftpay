/**
 * Backup import (PLAN 5.4, flow): let the user pick a backup file, validate it,
 * ask before replacing everything, then replace every table in one transaction
 * and reload the stores (rota shifts re-materialised). `restoreBackup` talks
 * only to the `BackupPicker` interface so it can be tested with a fake;
 * `expoBackupPicker` is the one place that touches expo-document-picker and
 * expo-file-system.
 */
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import type { Backup } from '../db/backup';
import { type BackupRejectReason, importBackup, parseBackup } from '../db/backupImport';
import type { AppDb } from '../db/jobRepo';
import { MONTH_NAMES } from '../engine/calendarMonth';
import { instantToLocal } from '../engine/time';
import type { IsoInstant } from '../engine/types';
import { bootstrap } from '../store/bootstrap';

export interface BackupPicker {
  /** Lets the user pick one file and returns its text, or null when they cancel. */
  pickText(): Promise<string | null>;
}

/** 'cancelled': at the picker or the confirm dialog; nothing changed. */
export type RestoreResult = 'restored' | 'cancelled' | BackupRejectReason;

export const expoBackupPicker: BackupPicker = {
  async pickText() {
    // Android often labels .json from Drive/Downloads as octet-stream: accept
    // any file and let validation decide.
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
    });
    if (result.canceled || result.assets.length === 0) return null;
    return new File(result.assets[0].uri).text();
  },
};

/** `2026-11-01T09:30:00.000Z` -> `1 Nov 2026` (the London date). */
export function formatBackupDate(exportedAt: IsoInstant): string {
  const [year, month, day] = instantToLocal(exportedAt).date.split('-');
  return `${Number(day)} ${MONTH_NAMES[Number(month) - 1].slice(0, 3)} ${Number(year)}`;
}

/**
 * Pick -> parse -> validate -> confirm -> replace -> reload. A rejected file
 * or a cancel leaves the database untouched. Throws if reading the file,
 * writing the database or reloading the stores fails (the import itself
 * rolls back on error).
 */
export async function restoreBackup(
  db: AppDb,
  now: IsoInstant,
  confirm: (backup: Backup) => Promise<boolean>,
  picker: BackupPicker = expoBackupPicker,
): Promise<RestoreResult> {
  const text = await picker.pickText();
  if (text === null) return 'cancelled';

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return 'invalid';
  }
  const parsed = parseBackup(json);
  if (!parsed.ok) return parsed.reason;

  if (!(await confirm(parsed.backup))) return 'cancelled';
  await importBackup(db, parsed.backup);
  await bootstrap(db, instantToLocal(now).date);
  return 'restored';
}
