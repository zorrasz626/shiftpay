/**
 * @jest-environment node
 */
import { type AppDb, listJobs } from '../../db/jobRepo';
import { createTestDb } from '../../db/testDb';
import { useJobsStore } from '../jobsStore';
import {
  MESSAGES,
  formatLongDate,
  isJobStepValid,
  isPayStepValid,
  isValidLocalDate,
  jobStepErrors,
  newId,
  parseRateToPence,
  payStepErrors,
  useOnboardingStore,
  type OnboardingDraft,
} from '../onboardingStore';
import { resetStores } from '../testFixtures';

const TODAY = '2026-10-31';

const draft = (overrides: Partial<OnboardingDraft> = {}): OnboardingDraft => ({
  name: 'Day job',
  baseRateText: '12.21',
  payFrequency: 'weekly',
  nextPayDate: '2026-11-06',
  periodEndDate: '2026-11-01',
  periodCutoffDay: '',
  ...overrides,
});

function fill(d: OnboardingDraft): void {
  const s = useOnboardingStore.getState();
  s.setName(d.name);
  s.setBaseRateText(d.baseRateText);
  s.setPayFrequency(d.payFrequency);
  s.setNextPayDate(d.nextPayDate);
  s.setPeriodEndDate(d.periodEndDate);
  s.setPeriodCutoffDay(d.periodCutoffDay);
}

describe('parseRateToPence', () => {
  it.each([
    ['12.21', 1221],
    ['£12.21', 1221],
    [' 12 ', 1200],
    ['12.5', 1250],
    ['0.01', 1],
    ['£ 9', 900],
  ])('parses %p as %p pence', (text, pence) => {
    expect(parseRateToPence(text)).toBe(pence);
  });

  it.each(['', '0', '0.00', '-5', '12.345', 'abc', '12.', '.5', '12,50', '1e3', '£'])(
    'rejects %p',
    (text) => {
      expect(parseRateToPence(text)).toBeNull();
    },
  );
});

describe('date helpers', () => {
  it('accepts only real YYYY-MM-DD dates', () => {
    expect(isValidLocalDate('2026-11-06')).toBe(true);
    expect(isValidLocalDate('2028-02-29')).toBe(true);
    expect(isValidLocalDate('2026-02-30')).toBe(false);
    expect(isValidLocalDate('2026-13-01')).toBe(false);
    expect(isValidLocalDate('2026-1-6')).toBe(false);
    expect(isValidLocalDate('')).toBe(false);
  });

  it('formats a date in plain words', () => {
    expect(formatLongDate('2026-11-06')).toBe('Friday 6 November 2026');
    expect(formatLongDate('2027-01-01')).toBe('Friday 1 January 2027');
    expect(formatLongDate('2026-02-30')).toBeNull();
  });

  it('newId gives distinct prefixed ids', () => {
    const a = newId();
    expect(a).toMatch(/^job-[a-z0-9]+-[a-z0-9]+$/);
    expect(newId()).not.toBe(a);
  });
});

describe('step validation', () => {
  it('step 1: hides errors on empty fields but is not valid', () => {
    const empty = draft({ name: '', baseRateText: '' });
    expect(jobStepErrors(empty)).toEqual({});
    expect(isJobStepValid(empty)).toBe(false);
    expect(jobStepErrors(draft({ name: '  ', baseRateText: '12.345' }))).toEqual({
      name: MESSAGES.nameRequired,
      baseRate: MESSAGES.rate,
    });
    expect(isJobStepValid(draft())).toBe(true);
  });

  it('step 2: flags malformed dates without throwing', () => {
    expect(payStepErrors(draft({ nextPayDate: '2026-02-30', periodEndDate: 'x' }))).toEqual({
      nextPayDate: MESSAGES.date,
      periodEndDate: MESSAGES.date,
    });
    expect(payStepErrors(draft({ nextPayDate: '', periodEndDate: '' }))).toEqual({});
    expect(isPayStepValid(draft({ nextPayDate: '', periodEndDate: '' }))).toBe(false);
  });

  it('step 2: maps schedule errors to plain English', () => {
    expect(payStepErrors(draft({ periodEndDate: '2026-11-07' }))).toEqual({
      periodEndDate: MESSAGES.end_after_pay,
    });
    expect(payStepErrors(draft({ periodEndDate: '2026-09-01' }))).toEqual({
      periodEndDate: MESSAGES.offset_too_large,
    });
    expect(isPayStepValid(draft())).toBe(true);
  });

  it('step 2 monthly: ignores the period end and checks the cut-off day', () => {
    const monthly = (periodCutoffDay: string) =>
      draft({ payFrequency: 'monthly', periodEndDate: 'not a date', periodCutoffDay });
    expect(payStepErrors(monthly(''))).toEqual({});
    expect(isPayStepValid(monthly(''))).toBe(false);
    expect(payStepErrors(monthly(''), true)).toEqual({ periodCutoffDay: MESSAGES.cutoff });
    expect(payStepErrors(monthly('32'))).toEqual({ periodCutoffDay: MESSAGES.cutoff });
    expect(payStepErrors(monthly('0'))).toEqual({ periodCutoffDay: MESSAGES.cutoff });
    expect(payStepErrors(monthly('2.5'))).toEqual({ periodCutoffDay: MESSAGES.cutoff });
    expect(isPayStepValid(monthly('31'))).toBe(true);
  });
});

describe('useOnboardingStore', () => {
  let db: AppDb;

  beforeEach(() => {
    db = createTestDb();
    resetStores();
    useOnboardingStore.getState().reset();
  });

  it('period end follows the next pay date until changed', () => {
    const s = useOnboardingStore.getState();
    s.setNextPayDate('2026-11-06');
    expect(useOnboardingStore.getState().periodEndDate).toBe('2026-11-06');
    s.setPeriodEndDate('2026-11-01');
    s.setNextPayDate('2026-11-13');
    expect(useOnboardingStore.getState().periodEndDate).toBe('2026-11-01');
  });

  it('saves a weekly job that round-trips through listJobs', async () => {
    fill(draft({ name: '  Day job  ' }));
    const id = await useOnboardingStore.getState().finishPayStep(db, TODAY);
    const jobs = await listJobs(db);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual({
      id,
      name: 'Day job',
      baseRatePence: 1221,
      payFrequency: 'weekly',
      payPeriodAnchorDate: '2026-10-26',
      payDayOffsetDays: 5,
      periodCutoffDay: 1,
      contractedHoursPerWeek: 39,
      bankHolidayRegion: 'england-and-wales',
      overtimePremiumMode: 'highest',
      holidayYearStart: '2026-01-01',
      holidayEntitlementHours: 218.4,
      holidayMode: 'fixed',
    });
    expect(useJobsStore.getState().jobs).toEqual(jobs);
    expect(useOnboardingStore.getState().jobId).toBe(id);
  });

  it('saves a monthly job with the cut-off schedule', async () => {
    fill(draft({ payFrequency: 'monthly', nextPayDate: '2026-11-27', periodCutoffDay: '20' }));
    await useOnboardingStore.getState().finishPayStep(db, TODAY);
    const [job] = await listJobs(db);
    expect(job).toMatchObject({
      payFrequency: 'monthly',
      payPeriodAnchorDate: '2026-10-21',
      payDayOffsetDays: 7,
      periodCutoffDay: 20,
    });
  });

  it('saving again updates the same job instead of adding one', async () => {
    fill(draft());
    const id = await useOnboardingStore.getState().finishPayStep(db, TODAY);
    useOnboardingStore.getState().setBaseRateText('13');
    expect(await useOnboardingStore.getState().finishPayStep(db, TODAY)).toBe(id);
    const jobs = await listJobs(db);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].baseRatePence).toBe(1300);
  });

  it.each<[string, Partial<OnboardingDraft>]>([
    ['bad rate', { baseRateText: '12.345' }],
    ['empty name', { name: ' ' }],
    ['impossible date', { nextPayDate: '2026-02-30' }],
    ['end after pay', { periodEndDate: '2026-11-07' }],
    ['monthly without cut-off', { payFrequency: 'monthly', periodCutoffDay: '' }],
  ])('does not save on invalid input (%s)', async (_label, overrides) => {
    fill(draft(overrides));
    await expect(useOnboardingStore.getState().finishPayStep(db, TODAY)).rejects.toThrow(
      'not valid',
    );
    expect(await listJobs(db)).toEqual([]);
    expect(useOnboardingStore.getState().jobId).toBeUndefined();
  });

  it('reset clears the draft and saved id', async () => {
    fill(draft());
    await useOnboardingStore.getState().finishPayStep(db, TODAY);
    useOnboardingStore.getState().reset();
    expect(useOnboardingStore.getState()).toMatchObject({
      name: '',
      baseRateText: '',
      payFrequency: 'weekly',
      nextPayDate: '',
      periodEndDate: '',
      periodCutoffDay: '',
      jobId: undefined,
    });
  });
});
