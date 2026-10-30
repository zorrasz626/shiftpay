/**
 * @jest-environment node
 */
import { type AppDb, getJob } from '../../db/jobRepo';
import { createShift, getShift } from '../../db/shiftRepo';
import { createTestDb } from '../../db/testDb';
import { useJobsStore } from '../jobsStore';
import { job, resetStores, shift } from '../testFixtures';

describe('useJobsStore', () => {
  let db: AppDb;

  beforeEach(() => {
    db = createTestDb();
    resetStores();
  });

  it('starts empty and not loaded', () => {
    expect(useJobsStore.getState()).toMatchObject({ jobs: [], loaded: false });
  });

  it('load reads jobs from the DB and sets loaded', async () => {
    await useJobsStore.getState().load(db);
    expect(useJobsStore.getState()).toMatchObject({ jobs: [], loaded: true });
  });

  it('saveJob creates a new job, then updates it in full', async () => {
    const { saveJob } = useJobsStore.getState();
    await saveJob(db, job);
    expect(useJobsStore.getState().jobs).toEqual([job]);
    expect(useJobsStore.getState().loaded).toBe(true);

    const renamed = { ...job, name: 'Depot', colour: '#ff0000' };
    await saveJob(db, renamed);
    expect(useJobsStore.getState().jobs).toEqual([renamed]);
    expect(await getJob(db, job.id)).toEqual(renamed);
  });

  it('removeJob deletes the job (DB cascades to its shifts) and reloads', async () => {
    await useJobsStore.getState().saveJob(db, job);
    await createShift(db, shift('2026-06-15'));
    await useJobsStore.getState().removeJob(db, job.id);
    expect(useJobsStore.getState().jobs).toEqual([]);
    expect(await getShift(db, 's-2026-06-15')).toBeUndefined();
  });
});
