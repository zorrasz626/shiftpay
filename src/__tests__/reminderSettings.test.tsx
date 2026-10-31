import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { Linking } from 'react-native';

import SettingsScreen from '../../app/(tabs)/settings';
import ReminderSettingsScreen from '../../app/settings/reminders';
import { db } from '../db/client';
import { deleteSetting, getAllSettings, setSetting } from '../db/settingsRepo';
import { type PlannedReminder, REMINDER_LEAD_KEY, REMINDERS_ENABLED_KEY } from '../engine/reminders';
import { addMinutes } from '../engine/time';
import { ONBOARDING_COMPLETE_KEY } from '../services/completeOnboarding';
import type { Notifier } from '../services/notifier';
import { startReminderSync } from '../services/reminderSync';
import { useJobsStore } from '../store/jobsStore';
import { useSettingsStore } from '../store/settingsStore';
import { useShiftsStore } from '../store/shiftsStore';
import { job, resetStores, shift } from '../store/testFixtures';

jest.mock('../db/client', () => ({ db: require('../db/testDb').createTestDb() }));
const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
}));

const mocked = Notifications as jest.Mocked<typeof Notifications>;
function perm(granted: boolean, canAskAgain = true) {
  return { granted, canAskAgain } as unknown as Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>;
}

const DENIED = /Notifications are turned off for ShiftPay/;
const KEYS = [REMINDERS_ENABLED_KEY, REMINDER_LEAD_KEY, ONBOARDING_COMPLETE_KEY];

async function seedSettings(values: Record<string, unknown>): Promise<void> {
  for (const [key, value] of Object.entries(values)) await setSetting(db, key, value);
  await useSettingsStore.getState().load(db);
}

const toggle = () => screen.getByRole('switch', { name: 'Shift reminders' });
const chip = (name: string) => screen.getByRole('button', { name });
const saveButton = () => screen.getByRole('button', { name: 'Save' });

beforeEach(async () => {
  resetStores();
  for (const key of KEYS) await deleteSetting(db, key);
  mockPush.mockClear();
  mockBack.mockClear();
  mocked.getPermissionsAsync.mockReset().mockResolvedValue(perm(true));
  mocked.requestPermissionsAsync.mockReset().mockResolvedValue(perm(true));
});

describe('Settings tab: Reminders row', () => {
  it('shows the default (on, 1 h) without a job and opens Reminder settings', async () => {
    await render(<SettingsScreen />);
    expect(screen.getByRole('header', { name: 'Reminders' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Shift reminders, On · 1 h before' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/settings/reminders' });
  });

  it('shows the stored lead time, or Off', async () => {
    await seedSettings({ [REMINDER_LEAD_KEY]: 15 });
    await render(<SettingsScreen />);
    expect(screen.getByRole('button', { name: 'Shift reminders, On · 15 min before' })).toBeTruthy();
    await screen.unmount();

    await seedSettings({ [REMINDERS_ENABLED_KEY]: false });
    await render(<SettingsScreen />);
    expect(screen.getByRole('button', { name: 'Shift reminders, Off' })).toBeTruthy();
  });
});

describe('Reminder settings', () => {
  it('shows the stored values and saves a new lead time to the DB and the store', async () => {
    await seedSettings({ [REMINDER_LEAD_KEY]: 30 });
    await render(<ReminderSettingsScreen />);

    expect(toggle().props.value).toBe(true);
    for (const label of ['15 min', '30 min', '1 h', '2 h', '3 h']) expect(chip(label)).toBeTruthy();
    expect(chip('30 min').props.accessibilityState.selected).toBe(true);
    expect(screen.getByText(/Estimates only/)).toBeTruthy();

    await fireEvent.press(chip('2 h'));
    expect(chip('2 h').props.accessibilityState.selected).toBe(true);
    await fireEvent.press(saveButton());

    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    const expected = { [REMINDERS_ENABLED_KEY]: true, [REMINDER_LEAD_KEY]: 120 };
    expect(await getAllSettings(db)).toEqual(expected);
    expect(useSettingsStore.getState().values).toEqual(expected);
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(mocked.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('turning off hides the lead times and saves Off', async () => {
    await render(<ReminderSettingsScreen />);
    await fireEvent(toggle(), 'valueChange', false);
    expect(screen.queryByRole('button', { name: '1 h' })).toBeNull();
    await fireEvent.press(saveButton());

    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(await getAllSettings(db)).toEqual({ [REMINDERS_ENABLED_KEY]: false, [REMINDER_LEAD_KEY]: 60 });
  });

  it('turning on asks for permission; when refused it says so and opens app settings', async () => {
    await seedSettings({ [REMINDERS_ENABLED_KEY]: false });
    mocked.getPermissionsAsync.mockResolvedValue(perm(false));
    mocked.requestPermissionsAsync.mockResolvedValue(perm(false, false));
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await render(<ReminderSettingsScreen />);
    expect(screen.queryByText(DENIED)).toBeNull();

    await fireEvent(toggle(), 'valueChange', true);
    expect(await screen.findByText(DENIED)).toBeTruthy();
    expect(mocked.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(toggle().props.value).toBe(true);
    expect(chip('1 h')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Open app settings' }));
    expect(openSettings).toHaveBeenCalledTimes(1);
    openSettings.mockRestore();
  });

  it('shows the note on open when reminders are on but notifications are off, without asking', async () => {
    mocked.getPermissionsAsync.mockResolvedValue(perm(false, false));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const openSettings = jest.spyOn(Linking, 'openSettings').mockRejectedValue(new Error('no activity'));
    await render(<ReminderSettingsScreen />);

    expect(await screen.findByText(DENIED)).toBeTruthy();
    expect(mocked.requestPermissionsAsync).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Open app settings' }));
    await waitFor(() => expect(warn).toHaveBeenCalledWith('Opening app settings failed.', expect.any(Error)));

    await fireEvent(toggle(), 'valueChange', false);
    expect(screen.queryByText(DENIED)).toBeNull();
    openSettings.mockRestore();
    warn.mockRestore();
  });

  it('shows an error when the save fails, and Back discards edits', async () => {
    useSettingsStore.setState({ set: jest.fn().mockRejectedValue(new Error('disk full')) });
    await render(<ReminderSettingsScreen />);

    await fireEvent.press(saveButton());
    expect(await screen.findByText("Your changes couldn't be saved. Try again.")).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
    expect(saveButton().props.accessibilityState.disabled).toBe(false);

    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(await getAllSettings(db)).toEqual({});
  });

  it('saving a new lead time reschedules reminders at start minus the new lead', async () => {
    const scheduled: PlannedReminder[] = [];
    const notifier: Notifier = {
      ensurePermission: jest.fn(async () => true),
      cancelAll: jest.fn(async () => {}),
      schedule: jest.fn(async (r: PlannedReminder) => {
        scheduled.push(r);
      }),
    };
    const upcoming = shift('2026-06-16');
    useJobsStore.setState({ jobs: [job], loaded: true });
    useShiftsStore.setState({ shifts: [upcoming], loaded: true });
    await seedSettings({ [ONBOARDING_COMPLETE_KEY]: true });
    const stop = startReminderSync(notifier, () => '2026-06-15T00:00:00.000Z');
    await waitFor(() => expect(scheduled.at(-1)?.fireAt).toBe(addMinutes(upcoming.start, -60)));

    await render(<ReminderSettingsScreen />);
    await fireEvent.press(chip('15 min'));
    await fireEvent.press(saveButton());
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(scheduled.at(-1)?.fireAt).toBe(addMinutes(upcoming.start, -15)));
    expect(scheduled.at(-1)?.title).toBe('Shift in 15 min');
    stop();
  });
});
