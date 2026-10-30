/**
 * Jobs store: in-memory copy of the jobs table. Actions take the db as their
 * first argument so the store never imports expo-sqlite (Jest can load it).
 * Writes go through the repository, then state is reloaded from the DB.
 */
import { create } from 'zustand';

import { type AppDb, type StoredJob, createJob, deleteJob, getJob, listJobs, updateJob } from '../db/jobRepo';

export interface JobsState {
  jobs: StoredJob[];
  loaded: boolean;
  load: (db: AppDb) => Promise<void>;
  /** Creates the job, or replaces it in full if its id already exists. */
  saveJob: (db: AppDb, job: StoredJob) => Promise<void>;
  /**
   * Deletes the job (the DB cascades to its rules, templates, patterns and
   * shifts). Does not touch the shifts store: the caller reloads shifts.
   */
  removeJob: (db: AppDb, id: string) => Promise<void>;
}

export const useJobsStore = create<JobsState>()((set) => {
  async function load(db: AppDb): Promise<void> {
    const jobs = await listJobs(db);
    set({ jobs, loaded: true });
  }

  return {
    jobs: [],
    loaded: false,
    load,
    saveJob: async (db, job) => {
      if (await getJob(db, job.id)) await updateJob(db, job);
      else await createJob(db, job);
      await load(db);
    },
    removeJob: async (db, id) => {
      await deleteJob(db, id);
      await load(db);
    },
  };
});
