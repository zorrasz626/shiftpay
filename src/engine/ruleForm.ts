/**
 * Premium / overtime rule editor <-> PremiumRule (Settings, task 3.8).
 * Pure: no React, DB or clock.
 *
 * Text inputs stay strings in the form. Multipliers are decimals typed by the
 * user ("1.25"); flat adds are typed in £ per hour and stored as integer pence
 * (D3), converted digit by digit so there is no float drift ("1.10" -> 110).
 */
import { isValidWallClock } from './manualShift';
import { parsePoundsToPence } from './money';
import type {
  DayOfWeek,
  PremiumRate,
  PremiumRule,
  PremiumRuleType,
  StackingMode,
  WallClockTime,
} from './types';

export type RuleRateKind = 'multiplier' | 'flat';

export interface RuleFormValues {
  type: PremiumRuleType;
  name: string;
  rateKind: RuleRateKind;
  /** Decimal multiplier of the base rate, e.g. "1.5". */
  multiplierText: string;
  /** Flat add in £ per hour, e.g. "1.10". */
  flatText: string;
  /** time_band only. */
  startTime: WallClockTime;
  /** time_band only. */
  endTime: WallClockTime;
  /** day_of_week only. */
  daysOfWeek: DayOfWeek[];
  /** Overtime rules only: hours beyond which overtime applies. */
  thresholdText: string;
  /** overtime_weekly only. */
  weekStartsOn: DayOfWeek;
  stacking: StackingMode;
  priority: number;
}

export type RuleFormField =
  | 'name'
  | 'multiplierText'
  | 'flatText'
  | 'startTime'
  | 'endTime'
  | 'daysOfWeek'
  | 'thresholdText';

export interface RuleFormError {
  field: RuleFormField;
  message: string;
}

type OvertimeType = 'overtime_daily' | 'overtime_weekly' | 'overtime_period';

/** Largest threshold per overtime type: hours in a day, a week, a 31-day month. */
export const RULE_THRESHOLD_MAX: Readonly<Record<OvertimeType, number>> = {
  overtime_daily: 24,
  overtime_weekly: 168,
  overtime_period: 744,
};

export const MULTIPLIER_MAX = 10;

export const RULE_FORM_MESSAGES = {
  name: 'Enter a name',
  multiplier: `Enter a multiplier above 0 and up to ${MULTIPLIER_MAX}, e.g. 1.5`,
  flat: 'Enter an amount in £ per hour, at least 0.01, with up to 2 decimal places',
  startTime: 'Enter a start time as HH:MM, from 00:00 to 23:59',
  endTime: 'Enter an end time as HH:MM, from 00:00 to 23:59',
  daysOfWeek: 'Pick at least one day',
  threshold: (max: number) => `Enter hours above 0 and up to ${max}`,
} as const;

const DECIMAL_RE = /^\d+(\.\d+)?$/;
/** Flat adds are plain digits: no sign, £ or commas. */
const PLAIN_POUNDS = { plain: true } as const;

/** Default form for a new rule of the given type. */
export function newRuleForm(type: PremiumRuleType): RuleFormValues {
  const base: RuleFormValues = {
    type,
    name: 'Overtime',
    rateKind: 'multiplier',
    multiplierText: '1.5',
    flatText: '',
    startTime: '22:00',
    endTime: '06:00',
    daysOfWeek: [0],
    thresholdText: '',
    weekStartsOn: 1,
    stacking: 'highest_only',
    priority: 0,
  };
  switch (type) {
    case 'time_band':
      return { ...base, name: 'Night', multiplierText: '1.25' };
    case 'day_of_week':
      return { ...base, name: 'Sunday' };
    case 'bank_holiday':
      return { ...base, name: 'Bank holiday', multiplierText: '2' };
    case 'overtime_daily':
      return { ...base, thresholdText: '8' };
    case 'overtime_weekly':
      return { ...base, thresholdText: '39' };
    case 'overtime_period':
      return { ...base, thresholdText: '160' };
  }
}

function penceToPoundsText(pence: number): string {
  const pounds = Math.floor(pence / 100);
  const rest = pence % 100;
  return `${pounds}.${rest < 10 ? '0' : ''}${rest}`;
}

/** Existing rule -> form. Fields the type doesn't use keep the type's defaults. */
export function ruleToForm(rule: PremiumRule): RuleFormValues {
  const form: RuleFormValues = {
    ...newRuleForm(rule.type),
    name: rule.name,
    stacking: rule.stacking,
    priority: rule.priority,
  };
  if (rule.multiplier !== undefined) {
    form.rateKind = 'multiplier';
    form.multiplierText = String(rule.multiplier);
  } else {
    form.rateKind = 'flat';
    form.flatText = penceToPoundsText(rule.flatAddPencePerHour);
  }
  switch (rule.type) {
    case 'time_band':
      form.startTime = rule.startTime;
      form.endTime = rule.endTime;
      break;
    case 'day_of_week':
      form.daysOfWeek = [...rule.daysOfWeek];
      break;
    case 'bank_holiday':
      break;
    case 'overtime_weekly':
      form.weekStartsOn = rule.weekStartsOn ?? 1;
      form.thresholdText = String(rule.thresholdHours);
      break;
    case 'overtime_daily':
    case 'overtime_period':
      form.thresholdText = String(rule.thresholdHours);
      break;
  }
  return form;
}

/** Positive decimal ("1.5", "2"), or null. No commas, signs or exponents. */
function parseDecimal(text: string): number | null {
  const t = text.trim();
  return DECIMAL_RE.test(t) ? Number(t) : null;
}

function isOvertimeType(type: PremiumRuleType): type is OvertimeType {
  return type in RULE_THRESHOLD_MAX;
}

/** Field errors for the form; empty when it can be saved. */
export function ruleFormErrors(values: RuleFormValues): RuleFormError[] {
  const errors: RuleFormError[] = [];
  if (values.name.trim() === '') {
    errors.push({ field: 'name', message: RULE_FORM_MESSAGES.name });
  }
  if (values.rateKind === 'multiplier') {
    const m = parseDecimal(values.multiplierText);
    if (m === null || m <= 0 || m > MULTIPLIER_MAX) {
      errors.push({ field: 'multiplierText', message: RULE_FORM_MESSAGES.multiplier });
    }
  } else {
    const p = parsePoundsToPence(values.flatText, PLAIN_POUNDS);
    if (p === null || p < 1) {
      errors.push({ field: 'flatText', message: RULE_FORM_MESSAGES.flat });
    }
  }
  if (values.type === 'time_band') {
    if (!isValidWallClock(values.startTime)) {
      errors.push({ field: 'startTime', message: RULE_FORM_MESSAGES.startTime });
    }
    if (!isValidWallClock(values.endTime)) {
      errors.push({ field: 'endTime', message: RULE_FORM_MESSAGES.endTime });
    }
  }
  if (values.type === 'day_of_week' && values.daysOfWeek.length === 0) {
    errors.push({ field: 'daysOfWeek', message: RULE_FORM_MESSAGES.daysOfWeek });
  }
  if (isOvertimeType(values.type)) {
    const max = RULE_THRESHOLD_MAX[values.type];
    const h = parseDecimal(values.thresholdText);
    if (h === null || h <= 0 || h > max) {
      errors.push({ field: 'thresholdText', message: RULE_FORM_MESSAGES.threshold(max) });
    }
  }
  return errors;
}

/** Valid form -> PremiumRule. Throws if `ruleFormErrors(values)` is not empty. */
export function formToRule(values: RuleFormValues, ids: { id: string; jobId: string }): PremiumRule {
  const errors = ruleFormErrors(values);
  if (errors.length > 0) {
    throw new Error(`Invalid rule form: ${errors.map((e) => e.field).join(', ')}`);
  }
  const rate: PremiumRate =
    values.rateKind === 'multiplier'
      ? { multiplier: Number(values.multiplierText.trim()) }
      : { flatAddPencePerHour: parsePoundsToPence(values.flatText, PLAIN_POUNDS) as number };
  const common = {
    id: ids.id,
    jobId: ids.jobId,
    name: values.name.trim(),
    stacking: values.stacking,
    priority: values.priority,
    ...rate,
  };
  const threshold = Number(values.thresholdText.trim());
  switch (values.type) {
    case 'time_band':
      return { ...common, type: 'time_band', startTime: values.startTime, endTime: values.endTime };
    case 'day_of_week':
      return { ...common, type: 'day_of_week', daysOfWeek: [...values.daysOfWeek] };
    case 'bank_holiday':
      return { ...common, type: 'bank_holiday' };
    case 'overtime_daily':
      return { ...common, type: 'overtime_daily', thresholdHours: threshold };
    case 'overtime_weekly':
      return {
        ...common,
        type: 'overtime_weekly',
        thresholdHours: threshold,
        weekStartsOn: values.weekStartsOn,
      };
    case 'overtime_period':
      return { ...common, type: 'overtime_period', thresholdHours: threshold };
  }
}
