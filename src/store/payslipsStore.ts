/**
 * Payslips store: in-memory copy of every job's saved payslips (with lines).
 * At most one payslip per (jobId, periodStart). Actions take the db as their
 * first argument so the store never imports expo-sqlite (Jest can load it).
 * Writes go through the repository, then state is reloaded from the DB.
 */
import { create } from 'zustand';

import type { LocalDate, Payslip } from '../engine/types';
import { type AppDb, listJobs } from '../db/jobRepo';
import {
  createPayslip,
  deletePayslip,
  getPayslip,
  listPayslips,
  updatePayslip,
} from '../db/payslipRepo';

export interface PayslipsState {
  /** Payslips of every job, grouped by job (listJobs order), then newest periodEnd first, then id. */
  payslips: Payslip[];
  loaded: boolean;
  load: (db: AppDb) => Promise<void>;
  /**
   * Replaces the payslip in full if its id exists; otherwise replaces the
   * job's payslip for the same periodStart (keeping that one's id); otherwise
   * creates it.
   */
  savePayslip: (db: AppDb, payslip: Payslip) => Promise<void>;
  removePayslip: (db: AppDb, id: string) => Promise<void>;
}

/** The saved payslip for a job's pay period, if any. */
export function payslipForPeriod(
  payslips: readonly Payslip[],
  jobId: string,
  periodStart: LocalDate,
): Payslip | undefined {
  return payslips.find((p) => p.jobId === jobId && p.periodStart === periodStart);
}

export const usePayslipsStore = create<PayslipsState>()((set) => {
  async function load(db: AppDb): Promise<void> {
    const payslips: Payslip[] = [];
    for (const job of await listJobs(db)) payslips.push(...(await listPayslips(db, job.id)));
    set({ payslips, loaded: true });
  }

  return {
    payslips: [],
    loaded: false,
    load,
    savePayslip: async (db, payslip) => {
      if (await getPayslip(db, payslip.id)) {
        await updatePayslip(db, payslip);
      } else {
        const existing = payslipForPeriod(
          await listPayslips(db, payslip.jobId),
          payslip.jobId,
          payslip.periodStart,
        );
        if (existing) await updatePayslip(db, { ...payslip, id: existing.id });
        else await createPayslip(db, payslip);
      }
      await load(db);
    },
    removePayslip: async (db, id) => {
      await deletePayslip(db, id);
      await load(db);
    },
  };
});
