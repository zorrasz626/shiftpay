/**
 * Shift reminder planner (SPEC "shift reminders, configurable lead time").
 * Pure: turns stored shifts + reminder settings + "now" into the list of
 * local notifications to schedule. The caller hands the result to the
 * notification service; nothing here touches Expo.
 *
 * Lead time is subtracted in real elapsed minutes (`addMinutes()`), so a
 * reminder across the BST/GMT change fires the right amount of time before
 * the shift. Instants are compared via `minutesBetween()`, never as strings.
 */
import { MONTH_NAMES } from './calendarMonth';
import { addMinutes, instantToLocal, minutesBetween } from './time';
import type { IsoInstant, Shift } from './types';

export const REMINDER_DEFAULTS = { enabled: true, leadMinutes: 60, maxReminders: 30 } as const;

/** Lead times (minutes) offered in the settings UI. */
export const REMINDER_LEAD_OPTIONS = [15, 30, 60, 120, 180] as const;

export const REMINDERS_ENABLED_KEY = 'reminders.enabled';
export const REMINDER_LEAD_KEY = 'reminders.leadMinutes';

const MAX_LEAD_MINUTES = 1440;

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export interface ReminderSettings {
  enabled: boolean;
  leadMinutes: number;
}

/** Reminder settings from the stored settings map; missing/invalid values fall back to defaults. */
export function reminderSettings(values: Record<string, unknown>): ReminderSettings {
  const enabled = values[REMINDERS_ENABLED_KEY];
  const lead = values[REMINDER_LEAD_KEY];
  const validLead = typeof lead === 'number' && Number.isInteger(lead) && lead > 0 && lead <= MAX_LEAD_MINUTES;
  return {
    enabled: typeof enabled === 'boolean' ? enabled : REMINDER_DEFAULTS.enabled,
    leadMinutes: validLead ? lead : REMINDER_DEFAULTS.leadMinutes,
  };
}

export interface PlannedReminder {
  /** `shift-<shiftId>-<fireAt>`: stable, and changes when the shift's time changes. */
  id: string;
  shiftId: string;
  fireAt: IsoInstant;
  title: string;
  body: string;
}

export interface PlanRemindersInput {
  shifts: Shift[];
  /** Job id -> job name. */
  jobNames: Record<string, string>;
  now: IsoInstant;
  leadMinutes: number;
  /** Cap on the number of reminders (default `REMINDER_DEFAULTS.maxReminders`). */
  max?: number;
}

/** "15 min", "1 h", "1 h 30 min". */
export function formatLeadMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function reminderBody(shift: Shift): string {
  const local = instantToLocal(shift.start);
  const [, month, day] = local.date.split('-').map(Number);
  const dateLabel = `${DAY_SHORT[local.dayOfWeek]} ${day} ${MONTH_NAMES[month - 1].slice(0, 3)}`;
  const overtime = shift.overtimeFlag ? ' (overtime)' : '';
  return `Starts ${local.time} on ${dateLabel}${overtime}`;
}

/** Reminders for planned shifts whose fire time is still in the future, soonest first. */
export function planReminders(input: PlanRemindersInput): PlannedReminder[] {
  const { shifts, jobNames, now, leadMinutes, max = REMINDER_DEFAULTS.maxReminders } = input;
  const lead = formatLeadMinutes(leadMinutes);
  const planned = shifts
    .filter((shift) => shift.status === 'planned')
    .map((shift) => ({ shift, fireAt: addMinutes(shift.start, -leadMinutes) }))
    .filter(({ fireAt }) => minutesBetween(now, fireAt) > 0)
    .sort(
      (a, b) =>
        minutesBetween(b.fireAt, a.fireAt) ||
        (a.shift.id < b.shift.id ? -1 : a.shift.id > b.shift.id ? 1 : 0),
    );
  return planned.slice(0, Math.max(0, max)).map(({ shift, fireAt }) => {
    const jobName = jobNames[shift.jobId];
    return {
      id: `shift-${shift.id}-${fireAt}`,
      shiftId: shift.id,
      fireAt,
      title: jobName ? `${jobName} shift in ${lead}` : `Shift in ${lead}`,
      body: reminderBody(shift),
    };
  });
}
