/**
 * @jest-environment node
 */
import type { AppDb } from '../../db/jobRepo';
import { getSetting } from '../../db/settingsRepo';
import { createTestDb } from '../../db/testDb';
import { useSettingsStore } from '../settingsStore';
import { resetStores } from '../testFixtures';

describe('useSettingsStore', () => {
  let db: AppDb;

  beforeEach(() => {
    db = createTestDb();
    resetStores();
  });

  it('starts empty and not loaded; load sets loaded', async () => {
    expect(useSettingsStore.getState()).toMatchObject({ values: {}, loaded: false });
    await useSettingsStore.getState().load(db);
    expect(useSettingsStore.getState()).toMatchObject({ values: {}, loaded: true });
  });

  it('set persists the value and reloads; remove deletes it', async () => {
    const { set, remove } = useSettingsStore.getState();
    await set(db, 'reminders', { enabled: true, minutesBefore: 60 });
    await set(db, 'theme', 'dark');
    expect(useSettingsStore.getState().values).toEqual({
      reminders: { enabled: true, minutesBefore: 60 },
      theme: 'dark',
    });
    expect(await getSetting(db, 'theme')).toBe('dark');

    await remove(db, 'theme');
    expect(useSettingsStore.getState().values).toEqual({ reminders: { enabled: true, minutesBefore: 60 } });
    expect(await getSetting(db, 'theme')).toBeUndefined();
  });
});
