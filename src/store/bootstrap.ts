/**
 * App start-up after migrations: materialise rota shifts, then load the
 * stores. A materialisation failure (e.g. a pattern pointing at a deleted
 * template) is logged and returned, never thrown, so the app still starts.
 * "today" is passed in (a Europe/London LocalDate).
 */
import type { LocalDate } from '../engine/types';
import type { AppDb } from '../db/jobRepo';
import { materialiseShifts, materialiseWindow } from '../services/materialise';
import { useBankHolidaysStore } from './bankHolidaysStore';
import { useJobsStore } from './jobsStore';
import { usePayslipsStore } from './payslipsStore';
import { useRotaStore } from './rotaStore';
import { useRulesStore } from './rulesStore';
import { useSettingsStore } from './settingsStore';
import { useShiftsStore } from './shiftsStore';

export interface BootstrapResult {
  materialiseError?: Error;
}

export async function bootstrap(db: AppDb, today: LocalDate): Promise<BootstrapResult> {
  const result: BootstrapResult = {};
  try {
    await materialiseShifts(db, today);
  } catch (e) {
    result.materialiseError = e instanceof Error ? e : new Error(String(e));
    console.warn('Shift materialisation failed; continuing with stored shifts.', result.materialiseError);
  }

  await useJobsStore.getState().load(db);
  await useRulesStore.getState().load(db);
  await usePayslipsStore.getState().load(db);
  await useRotaStore.getState().load(db);
  await useSettingsStore.getState().load(db);
  await useBankHolidaysStore.getState().load(db);
  await useShiftsStore.getState().load(db, materialiseWindow(today));
  return result;
}
