/**
 * @jest-environment node
 */
import { buildPremiumRules, buildRota } from '../../engine/presets';
import { type AppDb, createJob, createPremiumRule, getJob, listPremiumRules } from '../../db/jobRepo';
import { listRotaPatterns, listShiftTemplates } from '../../db/rotaRepo';
import { getSetting } from '../../db/settingsRepo';
import { createShift, listShifts } from '../../db/shiftRepo';
import { createTestDb } from '../../db/testDb';
import { useJobsStore } from '../../store/jobsStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useShiftsStore } from '../../store/shiftsStore';
import { TODAY, job, resetStores, shift } from '../../store/testFixtures';
import { ONBOARDING_COMPLETE_KEY, type CompleteOnboardingInput, completeOnboarding } from '../completeOnboarding';
import { materialiseWindow } from '../materialise';

let db: AppDb;
let seq = 0;
const makeId = (): string => `id-${++seq}`;

function onboardingInput(overrides: Partial<CompleteOnboardingInput> = {}): CompleteOnboardingInput {
  return {
    jobId: 'job-1',
    rota: buildRota({
      preset: 'mon_fri',
      jobId: 'job-1',
      firstDayOn: '2026-06-01',
      startTime: '09:00',
      endTime: '17:00',
      unpaidBreakMinutes: 30,
      makeId,
    }),
    rules: buildPremiumRules({ jobId: 'job-1', selected: ['nights', 'overtime_39'], makeId }),
    bankHolidayRegion: 'scotland',
    overtimePremiumMode: 'stack',
    today: TODAY,
    ...overrides,
  };
}

/** Every shift in the materialisation window. */
async function windowShifts() {
  const w = materialiseWindow(TODAY);
  return listShifts(db, w.start, w.end);
}

beforeEach(async () => {
  resetStores();
  db = createTestDb();
  await createJob(db, job);
});

describe('completeOnboarding', () => {
  it('writes the rota, rules, job settings and flag, materialises and reloads the stores', async () => {
    const input = onboardingInput();
    await completeOnboarding(db, input);

    expect(await listShiftTemplates(db, 'job-1')).toEqual([input.rota.template]);
    expect(await listRotaPatterns(db, 'job-1')).toEqual([input.rota.pattern]);
    expect(await listPremiumRules(db, 'job-1')).toHaveLength(2);
    expect(await getJob(db, 'job-1')).toEqual({
      ...job,
      bankHolidayRegion: 'scotland',
      overtimePremiumMode: 'stack',
    });
    expect(await getSetting(db, ONBOARDING_COMPLETE_KEY)).toBe(true);

    const stored = await windowShifts();
    // 211-day window, Mon-Fri: 151 weekdays.
    expect(stored).toHaveLength(151);
    expect(stored.every((s) => s.id.startsWith(`${input.rota.pattern.id}:`))).toBe(true);

    expect(useJobsStore.getState().jobs[0].overtimePremiumMode).toBe('stack');
    expect(useSettingsStore.getState().values[ONBOARDING_COMPLETE_KEY]).toBe(true);
    expect(useShiftsStore.getState().range).toEqual(materialiseWindow(TODAY));
    expect(useShiftsStore.getState().shifts).toHaveLength(151);
  });

  it('running it twice (after Back) leaves no duplicates', async () => {
    await createPremiumRule(db, buildPremiumRules({ jobId: 'job-1', selected: ['sundays'], makeId })[0]);
    await createShift(db, shift('2026-06-20')); // a manual shift is kept
    await completeOnboarding(db, onboardingInput());

    const second = onboardingInput({
      rota: buildRota({
        preset: 'four_on_four_off',
        jobId: 'job-1',
        firstDayOn: '2026-06-01',
        startTime: '07:00',
        endTime: '19:00',
        unpaidBreakMinutes: 0,
        makeId,
      }),
      rules: buildPremiumRules({ jobId: 'job-1', selected: ['bank_holidays'], makeId }),
      bankHolidayRegion: 'northern-ireland',
      overtimePremiumMode: 'replace',
    });
    await completeOnboarding(db, second);

    expect(await listShiftTemplates(db, 'job-1')).toEqual([second.rota.template]);
    expect(await listRotaPatterns(db, 'job-1')).toEqual([second.rota.pattern]);
    expect(await listPremiumRules(db, 'job-1')).toEqual(second.rules);
    const updated = await getJob(db, 'job-1');
    expect(updated?.bankHolidayRegion).toBe('northern-ireland');
    expect(updated?.overtimePremiumMode).toBe('replace');

    const stored = await windowShifts();
    const patternShifts = stored.filter((s) => s.source === 'pattern');
    // 211 days, 4 on 4 off from 2026-03-17 (cycle day 0 is 2026-06-01).
    expect(patternShifts.every((s) => s.id.startsWith(`${second.rota.pattern.id}:`))).toBe(true);
    expect(new Set(patternShifts.map((s) => s.date)).size).toBe(patternShifts.length);
    expect(patternShifts.length).toBeGreaterThanOrEqual(104);
    expect(stored.filter((s) => s.source === 'manual').map((s) => s.id)).toEqual(['s-2026-06-20']);
    expect(useShiftsStore.getState().shifts).toHaveLength(stored.length);
  });

  it('keeps user-modified shifts from the old pattern', async () => {
    const first = onboardingInput();
    await completeOnboarding(db, first);
    const [s] = await windowShifts();
    await useShiftsStore.getState().setStatus(db, s.id, 'sick');

    await completeOnboarding(db, onboardingInput());
    expect((await windowShifts()).some((x) => x.id === s.id && x.status === 'sick')).toBe(true);
  });

  it('throws for an unknown job', async () => {
    await expect(completeOnboarding(db, onboardingInput({ jobId: 'nope' }))).rejects.toThrow(/nope not found/);
  });
});
