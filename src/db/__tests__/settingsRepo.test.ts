/**
 * @jest-environment node
 */
import type { AppDb } from '../jobRepo';
import { deleteSetting, getAllSettings, getSetting, setSetting } from '../settingsRepo';
import { createTestDb } from '../testDb';

describe('settingsRepo', () => {
  let db: AppDb;

  beforeEach(() => {
    db = createTestDb();
  });

  it('round-trips a string, a number and an object', async () => {
    const obj = { reminders: { minutesBefore: [60, 15] }, enabled: true, note: null };
    await setSetting(db, 'theme', 'dark');
    await setSetting(db, 'reminderMinutes', 37.5);
    await setSetting(db, 'prefs', obj);
    expect(await getSetting<string>(db, 'theme')).toBe('dark');
    expect(await getSetting<number>(db, 'reminderMinutes')).toBe(37.5);
    expect(await getSetting<typeof obj>(db, 'prefs')).toEqual(obj);
    expect(await getAllSettings(db)).toEqual({
      theme: 'dark',
      reminderMinutes: 37.5,
      prefs: obj,
    });
  });

  it('overwrites an existing key', async () => {
    await setSetting(db, 'theme', 'dark');
    await setSetting(db, 'theme', { mode: 'light' });
    expect(await getSetting(db, 'theme')).toEqual({ mode: 'light' });
    expect(Object.keys(await getAllSettings(db))).toEqual(['theme']);
  });

  it('returns undefined for a missing or deleted key', async () => {
    expect(await getSetting(db, 'nope')).toBeUndefined();
    await setSetting(db, 'theme', 'dark');
    await deleteSetting(db, 'theme');
    expect(await getSetting(db, 'theme')).toBeUndefined();
    expect(await getAllSettings(db)).toEqual({});
  });

  it('rejects a value JSON cannot encode', async () => {
    await expect(setSetting(db, 'x', undefined)).rejects.toThrow(/x/);
  });
});
