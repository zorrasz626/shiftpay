/**
 * Finishes onboarding (SPEC §7.1): replaces the job's rota and premium rules
 * with the chosen ones, sets its bank-holiday region and overtime mode, marks
 * onboarding complete, materialises shifts and reloads the stores.
 *
 * Re-runnable (the user may go Back and finish again): the job's existing
 * templates, patterns and premium rules are deleted first, together with the
 * unmodified shifts generated from those patterns (`shifts.pattern_id` has no
 * foreign key, and materialisation keeps past pattern rows as history).
 * "today" is passed in (a Europe/London LocalDate).
 */
import { and, eq, inArray } from 'drizzle-orm';

import type { BuiltRota } from '../engine/presets';
import type { BankHolidayRegion, LocalDate, OvertimePremiumMode, PremiumRule } from '../engine/types';
import {
  type AppDb,
  createPremiumRule,
  deletePremiumRule,
  getJob,
  listPremiumRules,
  updateJob,
} from '../db/jobRepo';
import {
  createRotaPattern,
  createShiftTemplate,
  deleteRotaPattern,
  deleteShiftTemplate,
  listRotaPatterns,
  listShiftTemplates,
} from '../db/rotaRepo';
import { shifts } from '../db/schema';
import { setSetting } from '../db/settingsRepo';
import { useJobsStore } from '../store/jobsStore';
import { useSettingsStore } from '../store/settingsStore';
import { useShiftsStore } from '../store/shiftsStore';
import { materialiseShifts, materialiseWindow } from './materialise';

export const ONBOARDING_COMPLETE_KEY = 'onboardingComplete';

export interface CompleteOnboardingInput {
  jobId: string;
  rota: BuiltRota;
  rules: PremiumRule[];
  bankHolidayRegion: BankHolidayRegion;
  overtimePremiumMode: OvertimePremiumMode;
  today: LocalDate;
}

export async function completeOnboarding(db: AppDb, input: CompleteOnboardingInput): Promise<void> {
  const { jobId, rota, rules, today } = input;
  const job = await getJob(db, jobId);
  if (job === undefined) throw new Error(`Job ${jobId} not found`);

  const oldPatternIds = (await listRotaPatterns(db, jobId)).map((p) => p.id);
  if (oldPatternIds.length > 0) {
    await db
      .delete(shifts)
      .where(and(inArray(shifts.patternId, oldPatternIds), eq(shifts.userModified, false)));
  }
  for (const id of oldPatternIds) await deleteRotaPattern(db, id);
  for (const t of await listShiftTemplates(db, jobId)) await deleteShiftTemplate(db, t.id);
  for (const r of await listPremiumRules(db, jobId)) await deletePremiumRule(db, r.id);

  await createShiftTemplate(db, rota.template);
  await createRotaPattern(db, rota.pattern);
  for (const r of rules) await createPremiumRule(db, r);

  await updateJob(db, {
    ...job,
    bankHolidayRegion: input.bankHolidayRegion,
    overtimePremiumMode: input.overtimePremiumMode,
  });
  await setSetting(db, ONBOARDING_COMPLETE_KEY, true);

  await materialiseShifts(db, today);

  await useJobsStore.getState().load(db);
  await useSettingsStore.getState().load(db);
  await useShiftsStore.getState().load(db, materialiseWindow(today));
}
