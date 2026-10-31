/**
 * Onboarding presets (SPEC §7.1, PLAN 3.3): common rota shapes and premium
 * rules, built as plain engine types. Pure: ids come from the caller's
 * `makeId`, never generated here.
 */
import { addLocalDays, instantToLocal, startOfLocalDay } from './time';
import type {
  DayOfWeek,
  LocalDate,
  PremiumRule,
  RotaDay,
  RotaPattern,
  ShiftTemplate,
  WallClockTime,
} from './types';

export type RotaPresetId = 'mon_fri' | 'four_on_four_off' | 'two_two_three' | 'custom_weekly';

export const ROTA_PRESETS: readonly { id: RotaPresetId; label: string }[] = [
  { id: 'mon_fri', label: 'Monday to Friday' },
  { id: 'four_on_four_off', label: '4 on, 4 off' },
  { id: 'two_two_three', label: '2-2-3' },
  { id: 'custom_weekly', label: 'Pick your days' },
];

export interface BuildRotaInput {
  preset: RotaPresetId;
  jobId: string;
  /** First day on; day 0 of the cycle. */
  firstDayOn: LocalDate;
  startTime: WallClockTime;
  endTime: WallClockTime;
  unpaidBreakMinutes: number;
  /** Required (at least one) for `custom_weekly`; ignored otherwise. */
  daysOfWeek?: DayOfWeek[];
  makeId: () => string;
}

export interface BuiltRota {
  template: ShiftTemplate;
  pattern: RotaPattern;
}

const MON_FRI: DayOfWeek[] = [1, 2, 3, 4, 5];
/** Panama 2-2-3 over 14 days: true = on. */
const TWO_TWO_THREE = [true, true, false, false, true, true, true, false, false, true, true, false, false, false];
const FOUR_ON_FOUR_OFF = [true, true, true, true, false, false, false, false];

/** 7-day cycle from `start`: on where the date's weekday is in `days`. */
function weeklyCycle(start: LocalDate, days: DayOfWeek[]): boolean[] {
  const on = new Set<number>(days);
  return Array.from({ length: 7 }, (_, i) => on.has(instantToLocal(startOfLocalDay(addLocalDays(start, i))).dayOfWeek));
}

function cycleFor(input: BuildRotaInput): boolean[] {
  switch (input.preset) {
    case 'mon_fri':
      return weeklyCycle(input.firstDayOn, MON_FRI);
    case 'four_on_four_off':
      return FOUR_ON_FOUR_OFF;
    case 'two_two_three':
      return TWO_TWO_THREE;
    case 'custom_weekly':
      if (input.daysOfWeek === undefined || input.daysOfWeek.length === 0) {
        throw new Error('custom_weekly rota needs at least one day of the week');
      }
      return weeklyCycle(input.firstDayOn, input.daysOfWeek);
  }
}

/** One "Shift" template plus a rota pattern whose day 0 is `firstDayOn`. */
export function buildRota(input: BuildRotaInput): BuiltRota {
  const cycle = cycleFor(input);
  const template: ShiftTemplate = {
    id: input.makeId(),
    jobId: input.jobId,
    name: 'Shift',
    startTime: input.startTime,
    endTime: input.endTime,
    unpaidBreakMinutes: input.unpaidBreakMinutes,
  };
  const days: RotaDay[] = cycle.map((on) => (on ? { shiftTemplateId: template.id } : 'OFF'));
  const pattern: RotaPattern = {
    id: input.makeId(),
    jobId: input.jobId,
    cycleLengthDays: days.length,
    startDate: input.firstDayOn,
    days,
  };
  return { template, pattern };
}

export type PremiumPresetId = 'nights' | 'sundays' | 'bank_holidays' | 'overtime_39';

export const PREMIUM_PRESETS: readonly { id: PremiumPresetId; label: string }[] = [
  { id: 'nights', label: 'Nights ×1.25' },
  { id: 'sundays', label: 'Sundays ×1.5' },
  { id: 'bank_holidays', label: 'Bank hols ×2' },
  { id: 'overtime_39', label: 'Overtime after 39h/week ×1.5' },
];

export interface BuildPremiumRulesInput {
  jobId: string;
  selected: PremiumPresetId[];
  makeId: () => string;
}

function presetRule(preset: PremiumPresetId, id: string, jobId: string): PremiumRule {
  const common = { id, jobId, stacking: 'highest_only', priority: 0 } as const;
  switch (preset) {
    case 'nights':
      return { ...common, name: 'Night', type: 'time_band', startTime: '22:00', endTime: '06:00', multiplier: 1.25 };
    case 'sundays':
      return { ...common, name: 'Sunday', type: 'day_of_week', daysOfWeek: [0], multiplier: 1.5 };
    case 'bank_holidays':
      return { ...common, name: 'Bank holiday', type: 'bank_holiday', multiplier: 2 };
    case 'overtime_39':
      return {
        ...common,
        name: 'Overtime',
        type: 'overtime_weekly',
        thresholdHours: 39,
        weekStartsOn: 1,
        multiplier: 1.5,
      };
  }
}

/** One rule per selected preset, in selection order. */
export function buildPremiumRules(input: BuildPremiumRulesInput): PremiumRule[] {
  return input.selected.map((preset) => presetRule(preset, input.makeId(), input.jobId));
}
