/**
 * Onboarding draft (steps 1-2): what the user has typed so far, plain-English
 * validation, and `finishPayStep`, which builds the Job and saves it through
 * the jobs store. Text fields are kept exactly as typed; parsing happens here.
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
import { addLocalDays } from '../engine/time';
import type { LocalDate, PayFrequency } from '../engine/types';
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
  reset: () => void;
  /** Validates steps 1-2, saves the Job via the jobs store and returns its id. Throws if invalid. */
  finishPayStep: (db: AppDb, today: LocalDate) => Promise<string>;
}

/** Field name to plain-English error; a field with no entry is valid. */
export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export type JobStepField = 'name' | 'baseRate';
export type PayStepField = 'nextPayDate' | 'periodEndDate' | 'periodCutoffDay';

const RATE_RE = /^£?\s*(\d{1,6})(?:\.(\d{1,2}))?$/;
const CUTOFF_RE = /^\d{1,2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const MESSAGES = {
  nameRequired: 'Enter a name for this job',
  rate: 'Enter an hourly rate like 12.21',
  date: 'Enter a date like 2026-11-06',
  cutoff: 'Enter a day from 1 to 31',
  end_after_pay: "The last day of the period can't be after the pay date",
  offset_too_large: 'Pay day must be within 31 days of the end of the period it pays for',
} as const;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
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

const initialDraft: OnboardingDraft = {
  name: '',
  baseRateText: '',
  payFrequency: 'weekly',
  nextPayDate: '',
  periodEndDate: '',
  periodCutoffDay: '',
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
}));
