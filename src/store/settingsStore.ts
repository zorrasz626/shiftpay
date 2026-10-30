/**
 * Settings store: in-memory copy of the key/value settings. Actions take the
 * db as their first argument so the store never imports expo-sqlite.
 * Writes go through the repository, then state is reloaded from the DB.
 */
import { create } from 'zustand';

import type { AppDb } from '../db/jobRepo';
import { deleteSetting, getAllSettings, setSetting } from '../db/settingsRepo';

export interface SettingsState {
  values: Record<string, unknown>;
  loaded: boolean;
  load: (db: AppDb) => Promise<void>;
  set: (db: AppDb, key: string, value: unknown) => Promise<void>;
  remove: (db: AppDb, key: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()((set) => {
  async function load(db: AppDb): Promise<void> {
    const values = await getAllSettings(db);
    set({ values, loaded: true });
  }

  return {
    values: {},
    loaded: false,
    load,
    set: async (db, key, value) => {
      await setSetting(db, key, value);
      await load(db);
    },
    remove: async (db, key) => {
      await deleteSetting(db, key);
      await load(db);
    },
  };
});
