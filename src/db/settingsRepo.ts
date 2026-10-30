/**
 * Key/value settings, values JSON-encoded. No typed settings schema yet;
 * callers name the type they expect.
 */
import { eq } from 'drizzle-orm';

import type { AppDb } from './jobRepo';
import { settings } from './schema';

export async function getSetting<T>(db: AppDb, key: string): Promise<T | undefined> {
  const rows = await db.select().from(settings).where(eq(settings.key, key));
  return rows.length ? (JSON.parse(rows[0].value) as T) : undefined;
}

/** Inserts or overwrites the key. Throws for values JSON cannot encode (e.g. undefined). */
export async function setSetting(db: AppDb, key: string, value: unknown): Promise<void> {
  const encoded: string | undefined = JSON.stringify(value);
  if (encoded === undefined) throw new Error(`Setting ${key}: value is not JSON-encodable`);
  await db
    .insert(settings)
    .values({ key, value: encoded })
    .onConflictDoUpdate({ target: settings.key, set: { value: encoded } });
}

export async function deleteSetting(db: AppDb, key: string): Promise<void> {
  await db.delete(settings).where(eq(settings.key, key));
}

export async function getAllSettings(db: AppDb): Promise<Record<string, unknown>> {
  const rows = await db.select().from(settings);
  const all: Record<string, unknown> = {};
  for (const row of rows) all[row.key] = JSON.parse(row.value);
  return all;
}
