import { AppState, type AppStateStatus } from 'react-native';

import type { PlannedReminder } from '../../engine/reminders';
import { REMINDER_LEAD_KEY, REMINDERS_ENABLED_KEY, planReminders } from '../../engine/reminders';
import { addMinutes } from '../../engine/time';
import { useJobsStore } from '../../store/jobsStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useShiftsStore } from '../../store/shiftsStore';
import { job, resetStores, shift } from '../../store/testFixtures';
import { ONBOARDING_COMPLETE_KEY } from '../completeOnboarding';
import type { Notifier } from '../notifier';
import { REMINDER_SYNC_DEBOUNCE_MS, startReminderSync, syncReminders } from '../reminderSync';

const NOW = '2026-06-15T00:00:00.000Z';
const ONBOARDED = { [ONBOARDING_COMPLETE_KEY]: true };

interface FakeNotifier extends Notifier {
  calls: string[];
  scheduled: PlannedReminder[];
}

function fakeNotifier(opts: { granted?: boolean; cancelAll?: () => Promise<void> } = {}): FakeNotifier {
  const calls: string[] = [];
  const scheduled: PlannedReminder[] = [];
  return {
    calls,
    scheduled,
    ensurePermission: jest.fn(async () => {
      calls.push('ensurePermission');
      return opts.granted ?? true;
    }),
    cancelAll: jest.fn(async () => {
      calls.push('cancelAll');
      await opts.cancelAll?.();
    }),
    schedule: jest.fn(async (r: PlannedReminder) => {
      calls.push(`schedule:${r.id}`);
      scheduled.push(r);
    }),
  };
}

const shifts = [shift('2026-06-17'), shift('2026-06-16'), shift('2026-06-18', { status: 'worked' })];

describe('syncReminders', () => {
  it('only cancels when reminders are disabled', async () => {
    const notifier = fakeNotifier();
    await syncReminders({
      shifts,
      jobs: [job],
      settings: { ...ONBOARDED, [REMINDERS_ENABLED_KEY]: false },
      now: NOW,
      notifier,
    });
    expect(notifier.calls).toEqual(['cancelAll']);
  });

  it('only cancels before onboarding is complete', async () => {
    const notifier = fakeNotifier();
    await syncReminders({ shifts, jobs: [job], settings: {}, now: NOW, notifier });
    expect(notifier.calls).toEqual(['cancelAll']);
  });

  it('schedules nothing when permission is denied', async () => {
    const notifier = fakeNotifier({ granted: false });
    await syncReminders({ shifts, jobs: [job], settings: ONBOARDED, now: NOW, notifier });
    expect(notifier.calls).toEqual(['ensurePermission', 'cancelAll']);
    expect(notifier.schedule).not.toHaveBeenCalled();
  });

  it('passes askPermission through, asking by default', async () => {
    const notifier = fakeNotifier();
    await syncReminders({ shifts, jobs: [job], settings: ONBOARDED, now: NOW, notifier });
    expect(notifier.ensurePermission).toHaveBeenLastCalledWith({ ask: true });
    await syncReminders({ shifts, jobs: [job], settings: ONBOARDED, now: NOW, notifier, askPermission: false });
    expect(notifier.ensurePermission).toHaveBeenLastCalledWith({ ask: false });
  });

  it('cancels then schedules every planned reminder in planner order', async () => {
    const notifier = fakeNotifier();
    await syncReminders({ shifts, jobs: [job], settings: ONBOARDED, now: NOW, notifier });
    const expected = planReminders({ shifts, jobNames: { [job.id]: job.name }, now: NOW, leadMinutes: 60 });
    expect(expected).toHaveLength(2);
    expect(notifier.calls).toEqual(['ensurePermission', 'cancelAll', ...expected.map((r) => `schedule:${r.id}`)]);
    expect(notifier.scheduled).toEqual(expected);
    expect(notifier.scheduled[0].title).toBe('Shift in 1 h');
    expect(notifier.scheduled[0].body).toMatch(/^Warehouse · starts /);
  });
});

describe('startReminderSync', () => {
  const clock = () => NOW;

  beforeEach(() => {
    jest.useFakeTimers();
    resetStores();
    useJobsStore.setState({ jobs: [job], loaded: true });
    useSettingsStore.setState({ values: ONBOARDED, loaded: true });
    useShiftsStore.setState({ shifts: [shift('2026-06-16')], loaded: true });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function started(notifier: Notifier): Promise<() => void> {
    const stop = startReminderSync(notifier, clock);
    await jest.advanceTimersByTimeAsync(0);
    return stop;
  }

  it('runs once at start', async () => {
    const notifier = fakeNotifier();
    const stop = await started(notifier);
    expect(notifier.schedule).toHaveBeenCalledTimes(1);
    stop();
  });

  it('reschedules once after the debounce when shifts change', async () => {
    const notifier = fakeNotifier();
    const stop = await started(notifier);
    notifier.calls.length = 0;

    useShiftsStore.setState({ shifts: [shift('2026-06-16'), shift('2026-06-17')] });
    await jest.advanceTimersByTimeAsync(REMINDER_SYNC_DEBOUNCE_MS - 1);
    expect(notifier.calls).toEqual([]);
    await jest.advanceTimersByTimeAsync(1);
    expect(notifier.calls.filter((c) => c === 'cancelAll')).toHaveLength(1);
    expect(notifier.calls.filter((c) => c.startsWith('schedule:'))).toHaveLength(2);
    stop();
  });

  it('collapses two rapid changes into one run', async () => {
    const notifier = fakeNotifier();
    const stop = await started(notifier);
    notifier.calls.length = 0;

    useShiftsStore.setState({ shifts: [shift('2026-06-16'), shift('2026-06-17')] });
    await jest.advanceTimersByTimeAsync(100);
    useJobsStore.setState({ jobs: [{ ...job, name: 'Depot' }] });
    await jest.advanceTimersByTimeAsync(REMINDER_SYNC_DEBOUNCE_MS * 4);
    expect(notifier.calls.filter((c) => c === 'ensurePermission')).toHaveLength(1);
    expect(notifier.scheduled.at(-1)?.body).toMatch(/^Depot · starts /);
    stop();
  });

  it('ignores store updates that do not touch shifts, jobs or settings', async () => {
    const notifier = fakeNotifier();
    const stop = await started(notifier);
    notifier.calls.length = 0;

    useShiftsStore.setState({ loaded: false });
    await jest.advanceTimersByTimeAsync(REMINDER_SYNC_DEBOUNCE_MS * 2);
    expect(notifier.calls).toEqual([]);
    stop();
  });

  it('stops after unsubscribe', async () => {
    const notifier = fakeNotifier();
    const stop = await started(notifier);
    notifier.calls.length = 0;

    useSettingsStore.setState({ values: { ...ONBOARDED, [REMINDERS_ENABLED_KEY]: false } });
    stop();
    await jest.advanceTimersByTimeAsync(REMINDER_SYNC_DEBOUNCE_MS * 2);
    useShiftsStore.setState({ shifts: [] });
    await jest.advanceTimersByTimeAsync(REMINDER_SYNC_DEBOUNCE_MS * 2);
    expect(notifier.calls).toEqual([]);
  });

  it('never overlaps runs; a change during a run queues exactly one more', async () => {
    let release: () => void = () => {};
    let block = true;
    const notifier = fakeNotifier({
      cancelAll: () =>
        block ? new Promise<void>((resolve) => (release = () => ((block = false), resolve()))) : Promise.resolve(),
    });
    const stop = startReminderSync(notifier, clock);
    await jest.advanceTimersByTimeAsync(0);
    expect(notifier.calls).toEqual(['ensurePermission', 'cancelAll']);

    useShiftsStore.setState({ shifts: [shift('2026-06-17')] });
    await jest.advanceTimersByTimeAsync(REMINDER_SYNC_DEBOUNCE_MS);
    useShiftsStore.setState({ shifts: [shift('2026-06-18')] });
    await jest.advanceTimersByTimeAsync(REMINDER_SYNC_DEBOUNCE_MS);
    // Still blocked in the first run: no second run has started.
    expect(notifier.calls).toEqual(['ensurePermission', 'cancelAll']);

    release();
    await jest.advanceTimersByTimeAsync(0);
    expect(notifier.calls.filter((c) => c === 'ensurePermission')).toHaveLength(2);
    expect(notifier.scheduled.at(-1)?.shiftId).toBe('s-2026-06-18');
    stop();
  });

  it('reschedules with the new lead time when it changes', async () => {
    const notifier = fakeNotifier();
    const stop = await started(notifier);
    const start = useShiftsStore.getState().shifts[0].start;
    expect(notifier.scheduled.at(-1)?.fireAt).toBe(addMinutes(start, -60));

    useSettingsStore.setState({ values: { ...ONBOARDED, [REMINDER_LEAD_KEY]: 15 } });
    await jest.advanceTimersByTimeAsync(REMINDER_SYNC_DEBOUNCE_MS);
    expect(notifier.scheduled).toHaveLength(2);
    expect(notifier.scheduled.at(-1)?.fireAt).toBe(addMinutes(start, -15));
    expect(notifier.scheduled.at(-1)?.title).toBe('Shift in 15 min');
    stop();
  });

  function captureAppState(): { listener: () => ((state: AppStateStatus) => void) | undefined; remove: jest.Mock } {
    let listener: ((state: AppStateStatus) => void) | undefined;
    const remove = jest.fn();
    // Once only: RN's jest preset already mocks AppState, and restoring a spy on a mock wipes it.
    jest.spyOn(AppState, 'addEventListener').mockImplementationOnce((type, handler) => {
      expect(type).toBe('change');
      listener = handler as (state: AppStateStatus) => void;
      return { remove };
    });
    return { listener: () => listener, remove };
  }

  it('re-runs when the app becomes active; unsubscribe removes the listener', async () => {
    const appState = captureAppState();
    const remove = appState.remove;
    const listener = (state: AppStateStatus) => appState.listener()?.(state);
    const notifier = fakeNotifier();
    const stop = await started(notifier);
    notifier.calls.length = 0;

    listener('background');
    await jest.advanceTimersByTimeAsync(REMINDER_SYNC_DEBOUNCE_MS * 2);
    expect(notifier.calls).toEqual([]);

    listener('active');
    await jest.advanceTimersByTimeAsync(REMINDER_SYNC_DEBOUNCE_MS);
    expect(notifier.calls.filter((c) => c === 'ensurePermission')).toHaveLength(1);
    expect(notifier.ensurePermission).toHaveBeenLastCalledWith({ ask: false });
    expect(notifier.schedule).toHaveBeenCalledTimes(2);

    expect(remove).not.toHaveBeenCalled();
    stop();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('a foreground-only run never asks for permission and cancels when not granted', async () => {
    const appState = captureAppState();
    const notifier = fakeNotifier({ granted: false });
    const stop = await started(notifier);
    expect(notifier.ensurePermission).toHaveBeenLastCalledWith({ ask: true });
    notifier.calls.length = 0;

    for (let i = 0; i < 3; i++) {
      appState.listener()?.('active');
      await jest.advanceTimersByTimeAsync(REMINDER_SYNC_DEBOUNCE_MS);
    }
    expect(notifier.calls).toEqual(Array(3).fill(['ensurePermission', 'cancelAll']).flat());
    expect(notifier.ensurePermission).toHaveBeenCalledTimes(4);
    for (const call of (notifier.ensurePermission as jest.Mock).mock.calls.slice(1)) {
      expect(call).toEqual([{ ask: false }]);
    }
    expect(notifier.schedule).not.toHaveBeenCalled();
    stop();
  });

  it('a foreground trigger coalesced with a store change may ask', async () => {
    const appState = captureAppState();
    const notifier = fakeNotifier();
    const stop = await started(notifier);
    notifier.calls.length = 0;

    appState.listener()?.('active');
    useShiftsStore.setState({ shifts: [shift('2026-06-17')] });
    appState.listener()?.('active');
    await jest.advanceTimersByTimeAsync(REMINDER_SYNC_DEBOUNCE_MS);
    expect(notifier.calls.filter((c) => c === 'ensurePermission')).toHaveLength(1);
    expect(notifier.ensurePermission).toHaveBeenLastCalledWith({ ask: true });

    appState.listener()?.('active');
    await jest.advanceTimersByTimeAsync(REMINDER_SYNC_DEBOUNCE_MS);
    expect(notifier.ensurePermission).toHaveBeenLastCalledWith({ ask: false });
    stop();
  });

  it('a store change during a foreground run lets the queued run ask', async () => {
    const appState = captureAppState();
    let release: () => void = () => {};
    let block = false;
    const notifier = fakeNotifier({
      cancelAll: () => (block ? new Promise<void>((resolve) => (release = () => ((block = false), resolve()))) : Promise.resolve()),
    });
    const stop = await started(notifier);
    block = true;

    appState.listener()?.('active');
    await jest.advanceTimersByTimeAsync(REMINDER_SYNC_DEBOUNCE_MS);
    expect(notifier.ensurePermission).toHaveBeenLastCalledWith({ ask: false });
    useShiftsStore.setState({ shifts: [shift('2026-06-17')] });
    await jest.advanceTimersByTimeAsync(REMINDER_SYNC_DEBOUNCE_MS);
    release();
    await jest.advanceTimersByTimeAsync(0);
    expect(notifier.ensurePermission).toHaveBeenCalledTimes(3);
    expect(notifier.ensurePermission).toHaveBeenLastCalledWith({ ask: true });
    stop();
  });

  it('logs and swallows errors', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const notifier = fakeNotifier({ cancelAll: () => Promise.reject(new Error('boom')) });
    const stop = await started(notifier);
    expect(warn).toHaveBeenCalledWith('Reminder sync failed.', expect.any(Error));
    warn.mockRestore();
    stop();
  });
});
