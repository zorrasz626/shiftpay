/**
 * Keeps scheduled shift reminders in step with the stores. `syncReminders`
 * is one full replace (cancel all, schedule the planner's list);
 * `startReminderSync` re-runs it, debounced and serialised, whenever shifts,
 * jobs or settings change. "now" is passed in (a clock for the long-lived
 * subscription) so tests are deterministic.
 */
import type { StoredJob } from '../db/jobRepo';
import type { StoredShift } from '../db/shiftRepo';
import { planReminders, reminderSettings } from '../engine/reminders';
import type { IsoInstant } from '../engine/types';
import { useJobsStore } from '../store/jobsStore';
import { useSettingsStore } from '../store/settingsStore';
import { useShiftsStore } from '../store/shiftsStore';
import { ONBOARDING_COMPLETE_KEY } from './completeOnboarding';
import type { Notifier } from './notifier';

export const REMINDER_SYNC_DEBOUNCE_MS = 500;

export interface SyncRemindersInput {
  shifts: StoredShift[];
  jobs: StoredJob[];
  settings: Record<string, unknown>;
  now: IsoInstant;
  notifier: Notifier;
}

/**
 * Replace every scheduled reminder with the current plan. Reminders off or
 * onboarding not finished: just cancel (no permission prompt). Permission
 * denied: cancel and stop.
 */
export async function syncReminders(input: SyncRemindersInput): Promise<void> {
  const { shifts, jobs, settings, now, notifier } = input;
  const { enabled, leadMinutes } = reminderSettings(settings);
  if (!enabled || settings[ONBOARDING_COMPLETE_KEY] !== true) {
    await notifier.cancelAll();
    return;
  }
  if (!(await notifier.ensurePermission())) {
    await notifier.cancelAll();
    return;
  }
  const jobNames: Record<string, string> = {};
  for (const job of jobs) jobNames[job.id] = job.name;
  const planned = planReminders({ shifts, jobNames, now, leadMinutes });
  await notifier.cancelAll();
  for (const reminder of planned) {
    await notifier.schedule(reminder);
  }
}

/**
 * Run a sync now, then again (debounced) after any change to shifts, jobs or
 * settings. Runs never overlap: a change during a run queues exactly one
 * more. Errors are logged, never thrown. Returns an unsubscribe.
 */
export function startReminderSync(
  notifier: Notifier,
  clock: () => IsoInstant = () => new Date().toISOString(),
): () => void {
  let stopped = false;
  let running = false;
  let rerun = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = async (): Promise<void> => {
    if (stopped) return;
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    try {
      await syncReminders({
        shifts: useShiftsStore.getState().shifts,
        jobs: useJobsStore.getState().jobs,
        settings: useSettingsStore.getState().values,
        now: clock(),
        notifier,
      });
    } catch (e) {
      console.warn('Reminder sync failed.', e);
    } finally {
      running = false;
    }
    if (rerun) {
      rerun = false;
      await run();
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void run();
    }, REMINDER_SYNC_DEBOUNCE_MS);
  };

  const unsubscribers = [
    useShiftsStore.subscribe((s, prev) => {
      if (s.shifts !== prev.shifts) schedule();
    }),
    useJobsStore.subscribe((s, prev) => {
      if (s.jobs !== prev.jobs) schedule();
    }),
    useSettingsStore.subscribe((s, prev) => {
      if (s.values !== prev.values) schedule();
    }),
  ];

  void run();

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}
