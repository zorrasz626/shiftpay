import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { REMINDER_CHANNEL_ID, expoNotifier } from '../notifier';

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

describe('expoNotifier', () => {
  beforeAll(() => {
    Platform.OS = 'android';
  });

  beforeEach(() => {
    mocked.getPermissionsAsync.mockReset();
    mocked.requestPermissionsAsync.mockReset();
  });

  it('creates the channel and handler before asking, and returns true when already granted', async () => {
    mocked.getPermissionsAsync.mockResolvedValue(perm(true));
    await expect(expoNotifier.ensurePermission()).resolves.toBe(true);
    expect(mocked.setNotificationHandler).toHaveBeenCalledTimes(1);
    expect(mocked.setNotificationChannelAsync).toHaveBeenCalledWith(REMINDER_CHANNEL_ID, {
      name: 'Shift reminders',
      importance: 3,
    });
    expect(mocked.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('asks when undecided and returns the answer', async () => {
    mocked.getPermissionsAsync.mockResolvedValue(perm(false));
    mocked.requestPermissionsAsync.mockResolvedValue(perm(false));
    await expect(expoNotifier.ensurePermission()).resolves.toBe(false);
    expect(mocked.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('does not ask again once permanently denied', async () => {
    mocked.getPermissionsAsync.mockResolvedValue(perm(false, false));
    await expect(expoNotifier.ensurePermission()).resolves.toBe(false);
    expect(mocked.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('returns false instead of throwing', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mocked.getPermissionsAsync.mockRejectedValue(new Error('boom'));
    await expect(expoNotifier.ensurePermission()).resolves.toBe(false);
    warn.mockRestore();
  });

  it('schedules a date trigger on the reminder channel', async () => {
    await expoNotifier.schedule({
      id: 'shift-s1-2026-06-16T07:00:00.000Z',
      shiftId: 's1',
      fireAt: '2026-06-16T07:00:00.000Z',
      title: 'Shift in 1 h',
      body: 'Starts 08:00 on Tue 16 Jun',
    });
    expect(mocked.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: 'shift-s1-2026-06-16T07:00:00.000Z',
      content: { title: 'Shift in 1 h', body: 'Starts 08:00 on Tue 16 Jun', data: { shiftId: 's1' } },
      trigger: { type: 'date', date: new Date('2026-06-16T07:00:00.000Z'), channelId: REMINDER_CHANNEL_ID },
    });
    expect(mocked.setNotificationHandler).toHaveBeenCalledTimes(1);
  });

  it('cancels all scheduled notifications', async () => {
    await expoNotifier.cancelAll();
    expect(mocked.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
  });

  it('foreground handler shows the banner', async () => {
    const { handleNotification } = mocked.setNotificationHandler.mock.calls[0][0]!;
    await expect(handleNotification({} as never)).resolves.toMatchObject({ shouldShowBanner: true });
  });
});
