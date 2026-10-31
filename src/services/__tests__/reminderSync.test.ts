import type { PlannedReminder } from '../../engine/reminders';
import { REMINDERS_ENABLED_KEY, planReminders } from '../../engine/reminders';
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

  it('cancels then schedules every planned reminder in planner order', async () => {
    const notifier = fakeNotifier();
    await syncReminders({ shifts, jobs: [job], settings: ONBOARDED, now: NOW, notifier });
    const expected = planReminders({ shifts, jobNames: { [job.id]: job.name }, now: NOW, leadMinutes: 60 });
    expect(expected).toHaveLength(2);
    expect(notifier.calls).toEqual(['ensurePermission', 'cancelAll', ...expected.map((r) => `schedule:${r.id}`)]);
    expect(notifier.scheduled).toEqual(expected);
    expect(notifier.scheduled[0].title).toBe('Warehouse shift in 1 h');
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
    expect(notifier.scheduled.at(-1)?.title).toBe('Depot shift in 1 h');
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

  it('logs and swallows errors', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const notifier = fakeNotifier({ cancelAll: () => Promise.reject(new Error('boom')) });
    const stop = await started(notifier);
    expect(warn).toHaveBeenCalledWith('Reminder sync failed.', expect.any(Error));
    warn.mockRestore();
    stop();
  });
});
