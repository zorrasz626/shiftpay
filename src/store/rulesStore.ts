/**
 * Premium rules store: in-memory copy of every job's premium rules. Actions
 * take the db as their first argument so the store never imports expo-sqlite
 * (Jest can load it). Writes go through the repository, then state is
 * reloaded from the DB.
 */
import { create } from 'zustand';

import type { PremiumRule } from '../engine/types';
import {
  type AppDb,
  createPremiumRule,
  deletePremiumRule,
  getPremiumRule,
  listJobs,
  listPremiumRules,
  updatePremiumRule,
} from '../db/jobRepo';

export interface RulesState {
  /** Rules of every job, grouped by job (listJobs order), then priority descending, then id. */
  rules: PremiumRule[];
  loaded: boolean;
  load: (db: AppDb) => Promise<void>;
  /** Creates the rule, or replaces it in full if its id already exists. */
  saveRule: (db: AppDb, rule: PremiumRule) => Promise<void>;
  removeRule: (db: AppDb, id: string) => Promise<void>;
}

export const useRulesStore = create<RulesState>()((set) => {
  async function load(db: AppDb): Promise<void> {
    const rules: PremiumRule[] = [];
    for (const job of await listJobs(db)) rules.push(...(await listPremiumRules(db, job.id)));
    set({ rules, loaded: true });
  }

  return {
    rules: [],
    loaded: false,
    load,
    saveRule: async (db, rule) => {
      if (await getPremiumRule(db, rule.id)) await updatePremiumRule(db, rule);
      else await createPremiumRule(db, rule);
      await load(db);
    },
    removeRule: async (db, id) => {
      await deletePremiumRule(db, id);
      await load(db);
    },
  };
});
