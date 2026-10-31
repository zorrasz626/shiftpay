/**
 * Thin adapter over expo-notifications for shift reminders. The sync logic
 * (`reminderSync.ts`) talks only to the `Notifier` interface so it can be
 * tested with a fake; this file is the one place that touches Expo.
 */
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import type { PlannedReminder } from '../engine/reminders';

export const REMINDER_CHANNEL_ID = 'shift-reminders';

export interface Notifier {
  /** True when notifications may be shown; asks the user if not yet decided. Never throws. */
  ensurePermission(): Promise<boolean>;
  cancelAll(): Promise<void>;
  schedule(reminder: PlannedReminder): Promise<void>;
}

let setupDone: Promise<void> | null = null;

/**
 * Foreground handler + Android channel, once. Android 13+ only shows the
 * permission prompt once a channel exists, so this runs before asking.
 */
function setup(): Promise<void> {
  if (setupDone) return setupDone;
  setupDone = (async () => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
        name: 'Shift reminders',
        importance: AndroidImportance.DEFAULT,
      });
    }
  })().catch((e: unknown) => {
    setupDone = null;
    throw e;
  });
  return setupDone;
}

export const expoNotifier: Notifier = {
  async ensurePermission() {
    try {
      await setup();
      const current = await Notifications.getPermissionsAsync();
      if (current.granted) return true;
      if (!current.canAskAgain) return false;
      const requested = await Notifications.requestPermissionsAsync();
      return requested.granted;
    } catch (e) {
      console.warn('Notification permission check failed.', e);
      return false;
    }
  },

  async cancelAll() {
    await Notifications.cancelAllScheduledNotificationsAsync();
  },

  async schedule(reminder) {
    await setup();
    await Notifications.scheduleNotificationAsync({
      identifier: reminder.id,
      content: {
        title: reminder.title,
        body: reminder.body,
        data: { shiftId: reminder.shiftId },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(reminder.fireAt),
        channelId: REMINDER_CHANNEL_ID,
      },
    });
  },
};
