/**
 * @jest-environment node
 */
import { type AppDb, getJob, listJobs, listPremiumRules } from '../../db/jobRepo';
import { listRotaPatterns, listShiftTemplates } from '../../db/rotaRepo';
import { getSetting } from '../../db/settingsRepo';
import { listShifts } from '../../db/shiftRepo';
import { createTestDb } from '../../db/testDb';
import { ONBOARDING_COMPLETE_KEY } from '../../services/completeOnboarding';
import { materialiseWindow } from '../../services/materialise';
import { useJobsStore } from '../jobsStore';
import { useSettingsStore } from '../settingsStore';
import {
  MESSAGES,
  formatLongDate,
  isJobStepValid,
  endsNextDay,
  isPayStepValid,
  isRotaStepValid,
  isValidLocalDate,
  isValidTime,
  jobStepErrors,
  needsOnboarding,
  newId,
  penceToRateText,
  parseBreakMinutes,
  parseRateToPence,
  payStepErrors,
  rotaPreview,
  rotaStepErrors,
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
  rotaPreset: 'mon_fri',
  shiftStart: '09:00',
  shiftEnd: '17:00',
  unpaidBreakText: '30',
  firstDayOn: '2026-11-02',
  daysOfWeek: [],
  premiums: [],
  overtimePremiumMode: 'highest',
  bankHolidayRegion: 'england-and-wales',
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

describe('step 3 (rota)', () => {
  it('parses times and breaks', () => {
    expect(isValidTime('09:00')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
    expect(isValidTime('9:00')).toBe(false);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('12:60')).toBe(false);
    expect(endsNextDay('22:00', '06:00')).toBe(true);
    expect(endsNextDay('09:00', '17:00')).toBe(false);
    expect(endsNextDay('22:00', 'x')).toBe(false);
    expect(parseBreakMinutes(' 45 ')).toBe(45);
    expect(parseBreakMinutes('0')).toBe(0);
    expect(parseBreakMinutes('241')).toBeNull();
    expect(parseBreakMinutes('30.5')).toBeNull();
    expect(parseBreakMinutes('')).toBeNull();
  });

  it('accepts the defaults and an overnight shift', () => {
    expect(rotaStepErrors(draft())).toEqual({});
    expect(isRotaStepValid(draft())).toBe(true);
    const night = draft({ shiftStart: '22:00', shiftEnd: '06:00', unpaidBreakText: '60' });
    expect(rotaStepErrors(night)).toEqual({});
    expect(isRotaStepValid(night)).toBe(true);
  });

  it('flags bad times and a shift that starts and ends at the same time', () => {
    expect(rotaStepErrors(draft({ shiftStart: '9am', shiftEnd: '25:00' }))).toEqual({
      shiftStart: MESSAGES.time,
      shiftEnd: MESSAGES.time,
    });
    expect(rotaStepErrors(draft({ shiftStart: '08:00', shiftEnd: '08:00' }))).toEqual({
      shiftEnd: MESSAGES.sameTime,
    });
  });

  it('flags a break that is out of range or not shorter than the shift', () => {
    expect(rotaStepErrors(draft({ unpaidBreakText: '300' }))).toEqual({
      unpaidBreak: MESSAGES.breakMinutes,
    });
    expect(rotaStepErrors(draft({ unpaidBreakText: 'abc' }))).toEqual({
      unpaidBreak: MESSAGES.breakMinutes,
    });
    expect(
      rotaStepErrors(draft({ shiftStart: '09:00', shiftEnd: '11:00', unpaidBreakText: '120' })),
    ).toEqual({ unpaidBreak: MESSAGES.breakTooLong });
    expect(
      rotaStepErrors(draft({ shiftStart: '23:00', shiftEnd: '01:00', unpaidBreakText: '119' })),
    ).toEqual({});
  });

  it('checks the first day on and needs a day for custom rotas', () => {
    expect(rotaStepErrors(draft({ firstDayOn: '2026-02-30' }))).toEqual({
      firstDayOn: MESSAGES.date,
    });
    expect(rotaStepErrors(draft({ rotaPreset: 'custom_weekly' }))).toEqual({
      daysOfWeek: MESSAGES.pickDays,
    });
    expect(isRotaStepValid(draft({ rotaPreset: 'custom_weekly', daysOfWeek: [6] }))).toBe(true);
  });

  it('hides messages for empty fields but is not valid', () => {
    const empty = draft({ shiftStart: '', shiftEnd: '', unpaidBreakText: '', firstDayOn: '' });
    expect(rotaStepErrors(empty)).toEqual({});
    expect(isRotaStepValid(empty)).toBe(false);
    expect(rotaStepErrors(empty, true)).toEqual({
      shiftStart: MESSAGES.time,
      shiftEnd: MESSAGES.time,
      unpaidBreak: MESSAGES.breakMinutes,
      firstDayOn: MESSAGES.date,
    });
  });

  it('previews the next 14 days as runs of on and off days', () => {
    // 2026-11-02 is a Monday.
    expect(rotaPreview(draft(), '2026-11-02')).toBe(
      'On Mon 2–Fri 6, off Sat 7–Sun 8, on Mon 9–Fri 13, off Sat 14–Sun 15',
    );
    expect(rotaPreview(draft({ rotaPreset: 'four_on_four_off' }), '2026-10-31')).toBe(
      'On Mon 2–Thu 5, off Fri 6–Mon 9, on Tue 10–Fri 13, off Sat 14–Sun 15',
    );
    expect(rotaPreview(draft({ rotaPreset: 'custom_weekly', daysOfWeek: [3] }), '2026-11-03')).toBe(
      'Off Tue 3, on Wed 4, off Thu 5–Tue 10, on Wed 11, off Thu 12–Mon 16',
    );
    expect(rotaPreview(draft({ shiftStart: 'x' }), '2026-11-02')).toBeNull();
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

  it('holds the rota fields and toggles days in order', () => {
    const s = useOnboardingStore.getState();
    s.setRotaPreset('custom_weekly');
    s.setShiftStart('22:00');
    s.setShiftEnd('06:00');
    s.setUnpaidBreakText('45');
    s.setFirstDayOn('2026-11-02');
    s.toggleDayOfWeek(5);
    s.toggleDayOfWeek(1);
    s.toggleDayOfWeek(3);
    s.toggleDayOfWeek(5);
    expect(useOnboardingStore.getState()).toMatchObject({
      rotaPreset: 'custom_weekly',
      shiftStart: '22:00',
      shiftEnd: '06:00',
      unpaidBreakText: '45',
      firstDayOn: '2026-11-02',
      daysOfWeek: [1, 3],
    });
  });

  it('reset clears the draft and saved id', async () => {
    fill(draft());
    const s = useOnboardingStore.getState();
    s.setRotaPreset('two_two_three');
    s.setShiftEnd('19:00');
    s.setFirstDayOn('2026-11-02');
    s.toggleDayOfWeek(2);
    await useOnboardingStore.getState().finishPayStep(db, TODAY);
    useOnboardingStore.getState().reset();
    expect(useOnboardingStore.getState()).toMatchObject({
      name: '',
      baseRateText: '',
      payFrequency: 'weekly',
      nextPayDate: '',
      periodEndDate: '',
      periodCutoffDay: '',
      rotaPreset: 'mon_fri',
      shiftStart: '09:00',
      shiftEnd: '17:00',
      unpaidBreakText: '30',
      firstDayOn: '',
      daysOfWeek: [],
      jobId: undefined,
    });
  });

  it('toggles premiums in the order picked and holds D1 and region', () => {
    const s = useOnboardingStore.getState();
    s.togglePremium('sundays');
    s.togglePremium('nights');
    s.togglePremium('bank_holidays');
    s.togglePremium('sundays');
    s.setOvertimePremiumMode('stack');
    s.setBankHolidayRegion('northern-ireland');
    expect(useOnboardingStore.getState()).toMatchObject({
      premiums: ['nights', 'bank_holidays'],
      overtimePremiumMode: 'stack',
      bankHolidayRegion: 'northern-ireland',
    });
  });

  it.each<[string, Partial<OnboardingDraft>]>([
    ['weekly', {}],
    ['fortnightly', { payFrequency: 'fortnightly' }],
    ['monthly', { payFrequency: 'monthly', nextPayDate: '2026-11-27', periodCutoffDay: '20' }],
    [
      'monthly paid on the cut-off',
      { payFrequency: 'monthly', nextPayDate: '2026-11-20', periodCutoffDay: '20' },
    ],
  ])('loadFromJob prefills steps 1-2 from a saved %s job', async (_label, overrides) => {
    const typed = draft({ baseRateText: '12.05', ...overrides });
    fill(typed);
    const id = await useOnboardingStore.getState().finishPayStep(db, TODAY);
    const [saved] = await listJobs(db);
    useOnboardingStore.getState().reset();

    useOnboardingStore.getState().loadFromJob(saved);
    const monthly = typed.payFrequency === 'monthly';
    expect(useOnboardingStore.getState()).toMatchObject({
      jobId: id,
      name: typed.name,
      baseRateText: '12.05',
      payFrequency: typed.payFrequency,
      nextPayDate: typed.nextPayDate,
      periodEndDate: monthly ? '' : typed.periodEndDate,
      periodCutoffDay: monthly ? typed.periodCutoffDay : '',
    });
    // Saving step 2 again updates the same job to the same schedule.
    expect(await useOnboardingStore.getState().finishPayStep(db, TODAY)).toBe(id);
    expect(await listJobs(db)).toEqual([saved]);
  });

  async function finishedDraft(premiums: OnboardingDraft['premiums']): Promise<string> {
    fill(draft());
    const s = useOnboardingStore.getState();
    s.setFirstDayOn('2026-11-02');
    for (const p of premiums) s.togglePremium(p);
    s.setOvertimePremiumMode('replace');
    s.setBankHolidayRegion('scotland');
    return useOnboardingStore.getState().finishPayStep(db, TODAY);
  }

  it('finishOnboarding saves the rota, rules, D1 and region, materialises and resets', async () => {
    const id = await finishedDraft(['sundays', 'overtime_39']);
    await useOnboardingStore.getState().finishOnboarding(db, TODAY);

    expect(await getJob(db, id)).toMatchObject({
      overtimePremiumMode: 'replace',
      bankHolidayRegion: 'scotland',
    });
    const [template] = await listShiftTemplates(db, id);
    expect(template).toMatchObject({
      startTime: '09:00',
      endTime: '17:00',
      unpaidBreakMinutes: 30,
    });
    const [pattern] = await listRotaPatterns(db, id);
    expect(pattern).toMatchObject({ startDate: '2026-11-02', cycleLengthDays: 7 });
    const rules = await listPremiumRules(db, id);
    expect(rules.map((r) => r.name).sort()).toEqual(['Overtime', 'Sunday']);
    expect(await getSetting(db, ONBOARDING_COMPLETE_KEY)).toBe(true);
    expect(needsOnboarding(useSettingsStore.getState().values)).toBe(false);

    const w = materialiseWindow(TODAY);
    const shifts = await listShifts(db, w.start, w.end);
    expect(shifts.length).toBeGreaterThan(0);
    expect(shifts.every((s) => s.jobId === id && s.unpaidBreakMinutes === 30)).toBe(true);
    expect(shifts.map((s) => s.date)).toContain('2026-11-02');

    expect(useOnboardingStore.getState()).toMatchObject({
      name: '',
      premiums: [],
      overtimePremiumMode: 'highest',
      bankHolidayRegion: 'england-and-wales',
      jobId: undefined,
    });
  });

  it('finishOnboarding with no presets saves no rules', async () => {
    const id = await finishedDraft([]);
    await useOnboardingStore.getState().finishOnboarding(db, TODAY);
    expect(await listPremiumRules(db, id)).toEqual([]);
    expect(await listRotaPatterns(db, id)).toHaveLength(1);
  });

  it('finishOnboarding needs a saved job and a valid rota, and keeps the draft on error', async () => {
    fill(draft());
    useOnboardingStore.getState().setFirstDayOn('2026-11-02');
    await expect(useOnboardingStore.getState().finishOnboarding(db, TODAY)).rejects.toThrow(
      'step 2',
    );
    await useOnboardingStore.getState().finishPayStep(db, TODAY);
    useOnboardingStore.getState().setShiftStart('9am');
    await expect(useOnboardingStore.getState().finishOnboarding(db, TODAY)).rejects.toThrow(
      'not valid',
    );
    expect(await getSetting(db, ONBOARDING_COMPLETE_KEY)).toBeUndefined();
    expect(useOnboardingStore.getState().name).toBe('Day job');
  });
});

describe('needsOnboarding and penceToRateText', () => {
  it('needs onboarding until the flag is exactly true', () => {
    expect(needsOnboarding({})).toBe(true);
    expect(needsOnboarding({ [ONBOARDING_COMPLETE_KEY]: false })).toBe(true);
    expect(needsOnboarding({ [ONBOARDING_COMPLETE_KEY]: 'true' })).toBe(true);
    expect(needsOnboarding({ [ONBOARDING_COMPLETE_KEY]: true })).toBe(false);
  });

  it('writes pence as a rate step 1 accepts', () => {
    expect(penceToRateText(1221)).toBe('12.21');
    expect(penceToRateText(1205)).toBe('12.05');
    expect(penceToRateText(1200)).toBe('12.00');
    expect(parseRateToPence(penceToRateText(99))).toBe(99);
  });
});
