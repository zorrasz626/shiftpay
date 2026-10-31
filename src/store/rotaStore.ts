/**
 * Rota store: in-memory copy of every job's shift templates and rota
 * patterns. Actions take the db as their first argument so the store never
 * imports expo-sqlite (Jest can load it). "today" is always passed in.
 *
 * Every write goes through the repository, then re-materialises the rota
 * (future unmodified pattern shifts follow the edit; past, userModified and
 * manual shifts are left alone), then reloads this store and the shifts
 * store's materialisation window. A materialisation error is thrown to the
 * caller.
 */
import { create } from 'zustand';

import type { LocalDate, RotaPattern } from '../engine/types';
import { type AppDb, listJobs } from '../db/jobRepo';
import {
  type StoredShiftTemplate,
  createRotaPattern,
  createShiftTemplate,
  deleteShiftTemplate,
  getRotaPattern,
  getShiftTemplate,
  listRotaPatterns,
  listShiftTemplates,
  updateRotaPattern,
  updateShiftTemplate,
} from '../db/rotaRepo';
import { materialiseShifts, materialiseWindow } from '../services/materialise';
import { useShiftsStore } from './shiftsStore';

/** Thrown by removeTemplate when a rota pattern day still uses the template. */
export class TemplateInUseError extends Error {
  constructor(
    readonly templateId: string,
    readonly patternIds: string[],
  ) {
    super(`Shift template ${templateId} is used by rota pattern(s) ${patternIds.join(', ')}`);
    this.name = 'TemplateInUseError';
  }
}

export interface RotaState {
  /** Templates of every job, grouped by job (listJobs order). */
  templates: StoredShiftTemplate[];
  /** Patterns of every job, grouped by job (listJobs order). */
  patterns: RotaPattern[];
  loaded: boolean;
  load: (db: AppDb) => Promise<void>;
  /** Creates the template, or replaces it in full if its id already exists. */
  saveTemplate: (db: AppDb, template: StoredShiftTemplate, today: LocalDate) => Promise<void>;
  /** Deletes the template; throws TemplateInUseError if any pattern day uses it. */
  removeTemplate: (db: AppDb, id: string, today: LocalDate) => Promise<void>;
  /** Creates the pattern, or replaces it in full if its id already exists. */
  savePattern: (db: AppDb, pattern: RotaPattern, today: LocalDate) => Promise<void>;
}

function usesTemplate(pattern: RotaPattern, templateId: string): boolean {
  return pattern.days.some((d) => d !== 'OFF' && d.shiftTemplateId === templateId);
}

export const useRotaStore = create<RotaState>()((set) => {
  async function load(db: AppDb): Promise<void> {
    const templates: StoredShiftTemplate[] = [];
    const patterns: RotaPattern[] = [];
    for (const job of await listJobs(db)) {
      templates.push(...(await listShiftTemplates(db, job.id)));
      patterns.push(...(await listRotaPatterns(db, job.id)));
    }
    set({ templates, patterns, loaded: true });
  }

  /** Re-materialises the rota, then reloads this store and the shifts window. */
  async function afterWrite(db: AppDb, today: LocalDate): Promise<void> {
    await materialiseShifts(db, today);
    await load(db);
    await useShiftsStore.getState().load(db, materialiseWindow(today));
  }

  return {
    templates: [],
    patterns: [],
    loaded: false,
    load,
    saveTemplate: async (db, template, today) => {
      if (await getShiftTemplate(db, template.id)) await updateShiftTemplate(db, template);
      else await createShiftTemplate(db, template);
      await afterWrite(db, today);
    },
    removeTemplate: async (db, id, today) => {
      const users: string[] = [];
      for (const job of await listJobs(db)) {
        for (const p of await listRotaPatterns(db, job.id)) if (usesTemplate(p, id)) users.push(p.id);
      }
      if (users.length > 0) throw new TemplateInUseError(id, users);
      await deleteShiftTemplate(db, id);
      await afterWrite(db, today);
    },
    savePattern: async (db, pattern, today) => {
      if (await getRotaPattern(db, pattern.id)) await updateRotaPattern(db, pattern);
      else await createRotaPattern(db, pattern);
      await afterWrite(db, today);
    },
  };
});
