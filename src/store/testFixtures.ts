/** Shared fixtures and store reset for the store tests. Never import this from app code. */
import type { StoredJob } from '../db/jobRepo';
import type { StoredShift } from '../db/shiftRepo';
import { useJobsStore } from './jobsStore';
import { useSettingsStore } from './settingsStore';
import { useShiftsStore } from './shiftsStore';

export const TODAY = '2026-06-15';

export const job: StoredJob = {
  id: 'job-1',
  name: 'Warehouse',
  baseRatePence: 1250,
  payFrequency: 'weekly',
  payPeriodAnchorDate: '2026-04-06',
  payDayOffsetDays: 5,
  periodCutoffDay: 31,
  contractedHoursPerWeek: 37.5,
  bankHolidayRegion: 'england-and-wales',
  overtimePremiumMode: 'highest',
  holidayYearStart: '2026-04-01',
  holidayEntitlementHours: 210,
  holidayMode: 'fixed',
};

export function shift(date: string, overrides: Partial<StoredShift> = {}): StoredShift {
  return {
    id: `s-${date}`,
    jobId: 'job-1',
    date,
    start: `${date}T08:00:00.000Z`,
    end: `${date}T16:00:00.000Z`,
    unpaidBreakMinutes: 30,
    source: 'manual',
    status: 'planned',
    overtimeFlag: false,
    userModified: false,
    ...overrides,
  };
}

export function resetStores(): void {
  useJobsStore.setState(useJobsStore.getInitialState(), true);
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  useShiftsStore.setState(useShiftsStore.getInitialState(), true);
}
