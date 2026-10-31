/**
 * Onboarding draft (steps 1-4): what the user has typed so far, plain-English
 * validation, and `finishPayStep`, which builds the Job and saves it through
 * the jobs store. Text fields are kept exactly as typed; parsing happens here.
 * The rota (step 3) and extra pay (step 4) choices stay in the draft until
 * `finishOnboarding` saves them.
 */
import { create } from 'zustand';

import type { AppDb, StoredJob } from '../db/jobRepo';
import {
  newJobDefaults,
  paySchedule,
  validatePaySchedule,
  type PayScheduleError,
  type PayScheduleInput,
} from '../engine/paySchedule';
import { FIXED_LENGTH_DAYS, monthlyPeriod } from '../engine/payPeriods';
import {
  buildPremiumRules,
  buildRota,
  type PremiumPresetId,
  type RotaPresetId,
} from '../engine/presets';
import { generateShifts } from '../engine/rota';
import { addLocalDays, instantToLocal, startOfLocalDay } from '../engine/time';
import type {
  BankHolidayRegion,
  DayOfWeek,
  LocalDate,
  OvertimePremiumMode,
  PayFrequency,
} from '../engine/types';
import { ONBOARDING_COMPLETE_KEY, completeOnboarding } from '../services/completeOnboarding';
import { useJobsStore } from './jobsStore';

export interface OnboardingDraft {
  name: string;
  /** Base rate per hour as typed, e.g. "12.21" or "£12.21". */
  baseRateText: string;
  payFrequency: PayFrequency;
  /** YYYY-MM-DD as typed. */
  nextPayDate: string;
  /** YYYY-MM-DD as typed; follows `nextPayDate` until the user changes it. Ignored for monthly. */
  periodEndDate: string;
  /** Monthly cut-off day (1-31) as typed. Ignored unless monthly. */
  periodCutoffDay: string;
  rotaPreset: RotaPresetId;
  /** HH:mm (24h) as typed. */
  shiftStart: string;
  /** HH:mm (24h) as typed; before `shiftStart` means the shift ends the next day. */
  shiftEnd: string;
  /** Unpaid break in whole minutes as typed. */
  unpaidBreakText: string;
  /** YYYY-MM-DD as typed; '' until the rota screen pre-fills today. */
  firstDayOn: string;
  /** Days worked for 'custom_weekly'; ignored for other presets. */
  daysOfWeek: DayOfWeek[];
  /** Premium presets the user opted into, in the order picked. */
  premiums: PremiumPresetId[];
  /** D1: what overtime on a premium hour pays. */
  overtimePremiumMode: OvertimePremiumMode;
  /** D5: which bank holidays apply. */
  bankHolidayRegion: BankHolidayRegion;
}

export interface OnboardingState extends OnboardingDraft {
  /** Id of the job saved by `finishPayStep`; saving again updates the same job. */
  jobId?: string;
  setName: (name: string) => void;
  setBaseRateText: (text: string) => void;
  setPayFrequency: (frequency: PayFrequency) => void;
  setNextPayDate: (date: string) => void;
  setPeriodEndDate: (date: string) => void;
  setPeriodCutoffDay: (text: string) => void;
  setRotaPreset: (preset: RotaPresetId) => void;
  setShiftStart: (time: string) => void;
  setShiftEnd: (time: string) => void;
  setUnpaidBreakText: (text: string) => void;
  setFirstDayOn: (date: string) => void;
  /** Adds the day to `daysOfWeek` if missing, removes it if present (kept sorted). */
  toggleDayOfWeek: (day: DayOfWeek) => void;
  /** Adds the preset to `premiums` if missing, removes it if present. */
  togglePremium: (preset: PremiumPresetId) => void;
  setOvertimePremiumMode: (mode: OvertimePremiumMode) => void;
  setBankHolidayRegion: (region: BankHolidayRegion) => void;
  /**
   * Prefills steps 1-2 and `jobId` from a saved job (resuming after quitting
   * past step 2), so saving step 2 again updates that job instead of adding one.
   */
  loadFromJob: (job: StoredJob) => void;
  reset: () => void;
  /** Validates steps 1-2, saves the Job via the jobs store and returns its id. Throws if invalid. */
  finishPayStep: (db: AppDb, today: LocalDate) => Promise<string>;
  /**
   * Saves the rota, premium rules, D1 mode and region for the job saved at step 2,
   * marks onboarding complete, materialises shifts and resets the draft.
   * Throws if there is no saved job or step 3 is invalid.
   */
  finishOnboarding: (db: AppDb, today: LocalDate) => Promise<void>;
}

/** Field name to plain-English error; a field with no entry is valid. */
export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export type JobStepField = 'name' | 'baseRate';
export type PayStepField = 'nextPayDate' | 'periodEndDate' | 'periodCutoffDay';
export type RotaStepField = 'shiftStart' | 'shiftEnd' | 'unpaidBreak' | 'firstDayOn' | 'daysOfWeek';

const RATE_RE = /^£?\s*(\d{1,6})(?:\.(\d{1,2}))?$/;
const CUTOFF_RE = /^\d{1,2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const BREAK_RE = /^\d{1,3}$/;
const MAX_BREAK_MINUTES = 240;
const MINUTES_PER_DAY = 24 * 60;
const PREVIEW_DAYS = 14;

export const MESSAGES = {
  nameRequired: 'Enter a name for this job',
  rate: 'Enter an hourly rate like 12.21',
  date: 'Enter a date like 2026-11-06',
  cutoff: 'Enter a day from 1 to 31',
  end_after_pay: "The last day of the period can't be after the pay date",
  offset_too_large: 'Pay day must be within 31 days of the end of the period it pays for',
  time: 'Enter a time like 09:00 (24-hour clock)',
  sameTime: "The shift can't start and end at the same time",
  breakMinutes: 'Enter a break from 0 to 240 minutes',
  breakTooLong: 'The break must be shorter than the shift',
  pickDays: 'Pick at least one day you work',
} as const;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "12.21" / "£12.21" / "12" / "12.5" to integer pence; null if not a positive amount with at most 2 dp. */
export function parseRateToPence(text: string): number | null {
  const m = RATE_RE.exec(text.trim());
  if (!m) return null;
  const pounds = Number(m[1]);
  const pence = Number((m[2] ?? '').padEnd(2, '0'));
  const total = pounds * 100 + pence;
  return total > 0 ? total : null;
}

/** True if `text` is a real calendar date written YYYY-MM-DD (2026-02-30 is not). */
export function isValidLocalDate(text: string): boolean {
  if (!DATE_RE.test(text)) return false;
  try {
    addLocalDays(text, 0);
    return true;
  } catch {
    return false;
  }
}

/** A valid YYYY-MM-DD date in plain words, e.g. "Friday 6 November 2026"; null if invalid. */
export function formatLongDate(text: string): string | null {
  if (!isValidLocalDate(text)) return null;
  const [y, m, d] = text.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAY_NAMES[weekday]} ${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

/** True if `text` is a 24-hour time written HH:mm, e.g. "09:00" or "23:30". */
export function isValidTime(text: string): boolean {
  return TIME_RE.test(text);
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** True if both times are valid and the end is before the start, so the shift ends the next day. */
export function endsNextDay(start: string, end: string): boolean {
  return isValidTime(start) && isValidTime(end) && timeToMinutes(end) < timeToMinutes(start);
}

/** Unpaid break as typed to whole minutes; null unless a whole number from 0 to 240. */
export function parseBreakMinutes(text: string): number | null {
  const trimmed = text.trim();
  if (!BREAK_RE.test(trimmed)) return null;
  const minutes = Number(trimmed);
  return minutes <= MAX_BREAK_MINUTES ? minutes : null;
}

/** True until onboarding has been finished (the settings flag is not `true`). */
export function needsOnboarding(values: Record<string, unknown>): boolean {
  return values[ONBOARDING_COMPLETE_KEY] !== true;
}

/** Integer pence as the rate text step 1 accepts, e.g. 1221 to "12.21". */
export function penceToRateText(pence: number): string {
  return `${Math.floor(pence / 100)}.${String(pence % 100).padStart(2, '0')}`;
}

/** Steps 1-2 draft fields that reproduce the job's stored pay schedule (its anchor period). */
function draftFromJob(
  job: StoredJob,
): Pick<
  OnboardingDraft,
  'name' | 'baseRateText' | 'payFrequency' | 'nextPayDate' | 'periodEndDate' | 'periodCutoffDay'
> {
  const periodEnd =
    job.payFrequency === 'monthly'
      ? monthlyPeriod(job.payPeriodAnchorDate, job.periodCutoffDay).end
      : addLocalDays(job.payPeriodAnchorDate, FIXED_LENGTH_DAYS[job.payFrequency] - 1);
  const monthly = job.payFrequency === 'monthly';
  return {
    name: job.name,
    baseRateText: penceToRateText(job.baseRatePence),
    payFrequency: job.payFrequency,
    nextPayDate: addLocalDays(periodEnd, job.payDayOffsetDays),
    periodEndDate: monthly ? '' : periodEnd,
    periodCutoffDay: monthly ? String(job.periodCutoffDay) : '',
  };
}

/** A small random id, e.g. "job-lq2x9k-4f7h2a1c". */
export function newId(prefix = 'job'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Step 1 errors. Empty fields are invalid but get no message until typed into (`showEmpty`). */
export function jobStepErrors(
  draft: OnboardingDraft,
  showEmpty = false,
): FieldErrors<JobStepField> {
  const errors: FieldErrors<JobStepField> = {};
  if (draft.name.trim() === '' && (showEmpty || draft.name !== ''))
    errors.name = MESSAGES.nameRequired;
  if (parseRateToPence(draft.baseRateText) === null && (showEmpty || draft.baseRateText !== '')) {
    errors.baseRate = MESSAGES.rate;
  }
  return errors;
}

export function isJobStepValid(draft: OnboardingDraft): boolean {
  return Object.keys(jobStepErrors(draft, true)).length === 0;
}

function scheduleInput(draft: OnboardingDraft): PayScheduleInput {
  const monthly = draft.payFrequency === 'monthly';
  const cutoffText = draft.periodCutoffDay.trim();
  return {
    payFrequency: draft.payFrequency,
    nextPayDate: draft.nextPayDate,
    periodEndDate: monthly ? draft.nextPayDate : draft.periodEndDate,
    periodCutoffDay:
      !monthly || cutoffText === ''
        ? undefined
        : CUTOFF_RE.test(cutoffText)
          ? Number(cutoffText)
          : NaN,
  };
}

function scheduleMessage(error: PayScheduleError): [PayStepField, string] {
  switch (error) {
    case 'end_after_pay':
    case 'offset_too_large':
      return ['periodEndDate', MESSAGES[error]];
    case 'cutoff_missing':
    case 'cutoff_out_of_range':
      return ['periodCutoffDay', MESSAGES.cutoff];
  }
}

/** Step 2 errors in plain English. Empty fields get no message unless `showEmpty`. */
export function payStepErrors(
  draft: OnboardingDraft,
  showEmpty = false,
): FieldErrors<PayStepField> {
  const errors: FieldErrors<PayStepField> = {};
  const monthly = draft.payFrequency === 'monthly';
  const show = (text: string) => showEmpty || text !== '';

  const payOk = isValidLocalDate(draft.nextPayDate);
  if (!payOk && show(draft.nextPayDate)) errors.nextPayDate = MESSAGES.date;
  const endOk = monthly || isValidLocalDate(draft.periodEndDate);
  if (!endOk && show(draft.periodEndDate)) errors.periodEndDate = MESSAGES.date;
  if (monthly && draft.periodCutoffDay.trim() === '') {
    if (showEmpty) errors.periodCutoffDay = MESSAGES.cutoff;
    return errors;
  }
  if (!payOk || !endOk) return errors;

  for (const error of validatePaySchedule(scheduleInput(draft))) {
    const [field, message] = scheduleMessage(error);
    errors[field] ??= message;
  }
  return errors;
}

export function isPayStepValid(draft: OnboardingDraft): boolean {
  return Object.keys(payStepErrors(draft, true)).length === 0;
}

/** Step 3 errors in plain English. Empty text fields get no message unless `showEmpty`. */
export function rotaStepErrors(
  draft: OnboardingDraft,
  showEmpty = false,
): FieldErrors<RotaStepField> {
  const errors: FieldErrors<RotaStepField> = {};
  const show = (text: string) => showEmpty || text !== '';

  const startOk = isValidTime(draft.shiftStart);
  if (!startOk && show(draft.shiftStart)) errors.shiftStart = MESSAGES.time;
  const endOk = isValidTime(draft.shiftEnd);
  if (!endOk && show(draft.shiftEnd)) errors.shiftEnd = MESSAGES.time;
  const timesOk = startOk && endOk && draft.shiftStart !== draft.shiftEnd;
  if (startOk && endOk && !timesOk) errors.shiftEnd = MESSAGES.sameTime;

  const breakMinutes = parseBreakMinutes(draft.unpaidBreakText);
  if (breakMinutes === null) {
    if (show(draft.unpaidBreakText)) errors.unpaidBreak = MESSAGES.breakMinutes;
  } else if (timesOk) {
    const shiftMinutes =
      (timeToMinutes(draft.shiftEnd) - timeToMinutes(draft.shiftStart) + MINUTES_PER_DAY) %
      MINUTES_PER_DAY;
    if (breakMinutes >= shiftMinutes) errors.unpaidBreak = MESSAGES.breakTooLong;
  }

  if (!isValidLocalDate(draft.firstDayOn) && show(draft.firstDayOn)) {
    errors.firstDayOn = MESSAGES.date;
  }
  if (draft.rotaPreset === 'custom_weekly' && draft.daysOfWeek.length === 0) {
    errors.daysOfWeek = MESSAGES.pickDays;
  }
  return errors;
}

export function isRotaStepValid(draft: OnboardingDraft): boolean {
  return Object.keys(rotaStepErrors(draft, true)).length === 0;
}

/** "Mon 2" for 2026-11-02. */
function shortDay(date: LocalDate): string {
  const weekday = instantToLocal(startOfLocalDay(date)).dayOfWeek;
  return `${SHORT_DAY_NAMES[weekday]} ${Number(date.slice(8))}`;
}

/**
 * The 14 days from `from` (or from the first day on, if later) as runs of on and off
 * days, e.g. "On Mon 2–Fri 6, off Sat 7–Sun 8, …". Null while step 3 is invalid.
 */
export function rotaPreview(draft: OnboardingDraft, from: LocalDate): string | null {
  if (!isRotaStepValid(draft)) return null;
  let n = 0;
  const { template, pattern } = buildRota({
    preset: draft.rotaPreset,
    jobId: 'preview',
    firstDayOn: draft.firstDayOn,
    startTime: draft.shiftStart,
    endTime: draft.shiftEnd,
    unpaidBreakMinutes: parseBreakMinutes(draft.unpaidBreakText) as number,
    daysOfWeek: draft.daysOfWeek,
    makeId: () => `preview-${n++}`,
  });
  const start = draft.firstDayOn > from ? draft.firstDayOn : from;
  const end = addLocalDays(start, PREVIEW_DAYS - 1);
  const onDates = new Set(generateShifts(pattern, [template], { start, end }).map((s) => s.date));

  const runs: { on: boolean; first: LocalDate; last: LocalDate }[] = [];
  for (let i = 0; i < PREVIEW_DAYS; i++) {
    const date = addLocalDays(start, i);
    const on = onDates.has(date);
    const run = runs[runs.length - 1];
    if (run !== undefined && run.on === on) run.last = date;
    else runs.push({ on, first: date, last: date });
  }
  const text = runs
    .map(({ on, first, last }) => {
      const span = first === last ? shortDay(first) : `${shortDay(first)}–${shortDay(last)}`;
      return `${on ? 'on' : 'off'} ${span}`;
    })
    .join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const initialDraft: OnboardingDraft = {
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
  premiums: [],
  overtimePremiumMode: 'highest',
  bankHolidayRegion: 'england-and-wales',
};

export const useOnboardingStore = create<OnboardingState>()((set, get) => ({
  ...initialDraft,
  jobId: undefined,
  setName: (name) => set({ name }),
  setBaseRateText: (baseRateText) => set({ baseRateText }),
  setPayFrequency: (payFrequency) => set({ payFrequency }),
  setNextPayDate: (nextPayDate) =>
    set((s) =>
      s.periodEndDate === s.nextPayDate
        ? { nextPayDate, periodEndDate: nextPayDate }
        : { nextPayDate },
    ),
  setPeriodEndDate: (periodEndDate) => set({ periodEndDate }),
  setPeriodCutoffDay: (periodCutoffDay) => set({ periodCutoffDay }),
  setRotaPreset: (rotaPreset) => set({ rotaPreset }),
  setShiftStart: (shiftStart) => set({ shiftStart }),
  setShiftEnd: (shiftEnd) => set({ shiftEnd }),
  setUnpaidBreakText: (unpaidBreakText) => set({ unpaidBreakText }),
  setFirstDayOn: (firstDayOn) => set({ firstDayOn }),
  toggleDayOfWeek: (day) =>
    set((s) => ({
      daysOfWeek: s.daysOfWeek.includes(day)
        ? s.daysOfWeek.filter((d) => d !== day)
        : [...s.daysOfWeek, day].sort((a, b) => a - b),
    })),
  togglePremium: (preset) =>
    set((s) => ({
      premiums: s.premiums.includes(preset)
        ? s.premiums.filter((p) => p !== preset)
        : [...s.premiums, preset],
    })),
  setOvertimePremiumMode: (overtimePremiumMode) => set({ overtimePremiumMode }),
  setBankHolidayRegion: (bankHolidayRegion) => set({ bankHolidayRegion }),
  loadFromJob: (job) => set({ ...draftFromJob(job), jobId: job.id }),
  reset: () => set({ ...initialDraft, jobId: undefined }),
  finishPayStep: async (db, today) => {
    const draft = get();
    if (!isJobStepValid(draft) || !isPayStepValid(draft)) {
      throw new Error('Onboarding draft is not valid');
    }
    const id = draft.jobId ?? newId();
    const job: StoredJob = {
      ...newJobDefaults({
        id,
        name: draft.name.trim(),
        baseRatePence: parseRateToPence(draft.baseRateText) as number,
        today,
      }),
      ...paySchedule(scheduleInput(draft)),
    };
    await useJobsStore.getState().saveJob(db, job);
    set({ jobId: id });
    return id;
  },
  finishOnboarding: async (db, today) => {
    const draft = get();
    const jobId = draft.jobId;
    if (jobId === undefined) throw new Error('Save the job (step 2) before finishing onboarding');
    if (!isRotaStepValid(draft)) throw new Error('Onboarding rota is not valid');
    const rota = buildRota({
      preset: draft.rotaPreset,
      jobId,
      firstDayOn: draft.firstDayOn,
      startTime: draft.shiftStart,
      endTime: draft.shiftEnd,
      unpaidBreakMinutes: parseBreakMinutes(draft.unpaidBreakText) as number,
      daysOfWeek: draft.daysOfWeek,
      makeId: () => newId('rota'),
    });
    const rules = buildPremiumRules({
      jobId,
      selected: draft.premiums,
      makeId: () => newId('rule'),
    });
    await completeOnboarding(db, {
      jobId,
      rota,
      rules,
      bankHolidayRegion: draft.bankHolidayRegion,
      overtimePremiumMode: draft.overtimePremiumMode,
      today,
    });
    get().reset();
  },
}));
