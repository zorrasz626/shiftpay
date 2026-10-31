/**
 * @jest-environment node
 */
import type { PremiumRule } from '../../engine/types';
import { type AppDb, createJob, getPremiumRule } from '../../db/jobRepo';
import { createTestDb } from '../../db/testDb';
import { useRulesStore } from '../rulesStore';
import { job, resetStores } from '../testFixtures';

const night: PremiumRule = {
  id: 'r-night',
  jobId: 'job-1',
  name: 'Nights',
  type: 'time_band',
  startTime: '22:00',
  endTime: '06:00',
  multiplier: 1.25,
  stacking: 'highest_only',
  priority: 1,
};

const sunday: PremiumRule = {
  id: 'r-sun',
  jobId: 'job-2',
  name: 'Sundays',
  type: 'day_of_week',
  daysOfWeek: [0],
  flatAddPencePerHour: 150,
  stacking: 'stack',
  priority: 0,
};

describe('useRulesStore', () => {
  let db: AppDb;

  beforeEach(async () => {
    db = createTestDb();
    resetStores();
    await createJob(db, job);
    await createJob(db, { ...job, id: 'job-2', name: 'Bar' });
  });

  it('starts empty and not loaded', () => {
    expect(useRulesStore.getState()).toMatchObject({ rules: [], loaded: false });
  });

  it('load reads the rules of every job and sets loaded', async () => {
    await useRulesStore.getState().load(db);
    expect(useRulesStore.getState()).toMatchObject({ rules: [], loaded: true });

    await useRulesStore.getState().saveRule(db, night);
    await useRulesStore.getState().saveRule(db, sunday);
    resetStores();
    await useRulesStore.getState().load(db);
    const { rules } = useRulesStore.getState();
    expect(rules).toHaveLength(2);
    expect(rules).toEqual(expect.arrayContaining([night, sunday]));
  });

  it('saveRule creates a new rule, then replaces it in full (type may change)', async () => {
    const { saveRule } = useRulesStore.getState();
    await saveRule(db, night);
    expect(useRulesStore.getState().rules).toEqual([night]);
    expect(useRulesStore.getState().loaded).toBe(true);

    const replaced: PremiumRule = {
      id: night.id,
      jobId: 'job-1',
      name: 'Bank holidays',
      type: 'bank_holiday',
      multiplier: 2,
      stacking: 'stack',
      priority: 3,
    };
    await saveRule(db, replaced);
    expect(useRulesStore.getState().rules).toEqual([replaced]);
    expect(await getPremiumRule(db, night.id)).toEqual(replaced);
  });

  it('removeRule deletes the rule and reloads', async () => {
    await useRulesStore.getState().saveRule(db, night);
    await useRulesStore.getState().saveRule(db, sunday);
    await useRulesStore.getState().removeRule(db, night.id);
    expect(useRulesStore.getState().rules).toEqual([sunday]);
    expect(await getPremiumRule(db, night.id)).toBeUndefined();
  });
});
