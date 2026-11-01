/**
 * Engine-facing types. Type-only: no runtime code.
 *
 * Representation (D4):
 * - instants are UTC ISO 8601 strings (e.g. `2026-03-29T00:30:00.000Z`)
 * - local dates are Europe/London calendar dates `YYYY-MM-DD`
 * - wall-clock times are `HH:mm` (24h, Europe/London)
 * Money is integer pence; rates per hour, hours and multipliers are decimals (D3).
 */

/** UTC ISO 8601 instant, e.g. `2026-03-29T00:30:00.000Z`. */
export type IsoInstant = string;
/** Europe/London calendar date, `YYYY-MM-DD`. */
export type LocalDate = string;
/** Europe/London wall-clock time, `HH:mm` (24h). */
export type WallClockTime = string;

/** 0 = Sunday ... 6 = Saturday. */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type PayFrequency = 'weekly' | 'fortnightly' | 'four_weekly' | 'monthly';

/** D5: which bundled bank-holiday list applies to the job. */
export type BankHolidayRegion = 'england-and-wales' | 'scotland' | 'northern-ireland';

/** Bank-holiday snapshot (gov.uk, dates only). A missing region means "no holidays known". */
export interface BankHolidayData {
  fetchedAt: string;
  regions: Partial<Record<BankHolidayRegion, LocalDate[]>>;
}

/** D1: how overtime and a premium on the same hour combine. Default `highest`. */
export type OvertimePremiumMode = 'replace' | 'highest' | 'stack';

/** Holiday entitlement: fixed hours per holiday year, or 12.07% accrual on worked hours. */
export type HolidayMode = 'fixed' | 'accrual';

/** How a premium combines with other premiums on the same hour. Default `highest_only`. */
export type StackingMode = 'stack' | 'highest_only';

export interface Job {
  id: string;
  name: string;
  /** Base rate in integer pence per hour. */
  baseRatePence: number;
  payFrequency: PayFrequency;
  /** Start date of any one pay period; all other periods are generated from it. */
  payPeriodAnchorDate: LocalDate;
  /** Days from period end to pay day. */
  payDayOffsetDays: number;
  /** D6: monthly cut-off day, 1-31, clamped to the month length. */
  periodCutoffDay: number;
  contractedHoursPerWeek: number;
  bankHolidayRegion: BankHolidayRegion;
  overtimePremiumMode: OvertimePremiumMode;
  /** First day of the holiday year. */
  holidayYearStart: LocalDate;
  /** Fixed holiday entitlement for the holiday year, in hours (decimal). */
  holidayEntitlementHours: number;
  /** Fixed entitlement, or 12.07% accrual on worked hours (irregular-hours workers). */
  holidayMode: HolidayMode;
}

export type PremiumRuleType =
  | 'time_band'
  | 'day_of_week'
  | 'bank_holiday'
  | 'overtime_daily'
  | 'overtime_weekly'
  | 'overtime_period';

/** A rule pays either a multiplier of the base rate or a flat add per hour, never both. */
export type PremiumRate =
  | { multiplier: number; flatAddPencePerHour?: undefined }
  | { flatAddPencePerHour: number; multiplier?: undefined };

interface PremiumRuleCommon {
  id: string;
  jobId: string;
  name: string;
  stacking: StackingMode;
  /** Higher priority wins ties between equally valued rules. */
  priority: number;
}

export type TimeBandRule = PremiumRuleCommon &
  PremiumRate & {
    type: 'time_band';
    /** Band start; if endTime <= startTime the band crosses midnight (22:00-06:00). */
    startTime: WallClockTime;
    endTime: WallClockTime;
  };

export type DayOfWeekRule = PremiumRuleCommon &
  PremiumRate & {
    type: 'day_of_week';
    daysOfWeek: DayOfWeek[];
  };

export type BankHolidayRule = PremiumRuleCommon &
  PremiumRate & {
    type: 'bank_holiday';
  };

export type DailyOvertimeRule = PremiumRuleCommon &
  PremiumRate & {
    type: 'overtime_daily';
    /** Paid hours in a shift beyond this are overtime. */
    thresholdHours: number;
  };

export type WeeklyOvertimeRule = PremiumRuleCommon &
  PremiumRate & {
    type: 'overtime_weekly';
    /** Paid hours in a week beyond this are overtime. */
    thresholdHours: number;
    /** First day of the overtime week; defaults to Monday (1). */
    weekStartsOn?: DayOfWeek;
  };

export type PeriodOvertimeRule = PremiumRuleCommon &
  PremiumRate & {
    type: 'overtime_period';
    /** Paid hours in a pay period beyond this are overtime. */
    thresholdHours: number;
  };

export type PremiumRule =
  | TimeBandRule
  | DayOfWeekRule
  | BankHolidayRule
  | DailyOvertimeRule
  | WeeklyOvertimeRule
  | PeriodOvertimeRule;

export type OvertimeRule = DailyOvertimeRule | WeeklyOvertimeRule | PeriodOvertimeRule;

export interface ShiftTemplate {
  id: string;
  jobId: string;
  name: string;
  /** If endTime <= startTime the shift ends the next day. */
  startTime: WallClockTime;
  endTime: WallClockTime;
  unpaidBreakMinutes: number;
}

/** One day of a rota cycle: a shift template, or a day off. */
export type RotaDay = { shiftTemplateId: string } | 'OFF';

export interface RotaPattern {
  id: string;
  jobId: string;
  cycleLengthDays: number;
  /** Local date of day 0 of the cycle. */
  startDate: LocalDate;
  /** Length equals cycleLengthDays. */
  days: RotaDay[];
}

export type ShiftSource = 'pattern' | 'manual';
export type ShiftStatus = 'planned' | 'worked' | 'sick' | 'holiday' | 'cancelled';

export interface Shift {
  id: string;
  jobId: string;
  /** Local date the shift starts on. */
  date: LocalDate;
  start: IsoInstant;
  end: IsoInstant;
  unpaidBreakMinutes: number;
  source: ShiftSource;
  status: ShiftStatus;
  overtimeFlag: boolean;
  notes?: string;
}

export interface PayslipLine {
  label: string;
  hours?: number;
  amountPence: number;
}

export interface Payslip {
  id: string;
  jobId: string;
  periodStart: LocalDate;
  periodEnd: LocalDate;
  grossPaidPence: number;
  hoursPaid?: number;
  lines?: PayslipLine[];
  taxPence: number;
  niPence: number;
  pensionPence: number;
  netPence?: number;
}

/**
 * A slice of a shift with constant conditions, before any pay is attached:
 * split at local midnight, time-band edges and BST/GMT changeovers, with the
 * unpaid break deducted (D7). Integer minutes throughout.
 */
export interface SegmentSlice {
  start: IsoInstant;
  end: IsoInstant;
  /** London date at the slice start. */
  localDate: LocalDate;
  /** London day of week at the slice start. */
  dayOfWeek: DayOfWeek;
  /** Elapsed minutes from start to end. */
  minutes: number;
  /** Unpaid break minutes deducted from this slice. */
  breakMinutes: number;
  /** minutes - breakMinutes, never negative. */
  paidMinutes: number;
  isBankHoliday: boolean;
}

/** Pence attributed to one rule on one segment, rounded once via `segmentPence()`. */
export interface RuleAmount {
  ruleId: string;
  pence: number;
}

/**
 * A slice with pay attached. Each pence amount is rounded once via
 * `segmentPence()`; premiumPence = sum(ruleAmounts) and totalPence =
 * base + premium + overtime, as integer sums (never re-rounded).
 */
export interface Segment extends SegmentSlice {
  /** True if any of this segment's paid time is overtime. */
  isOvertime: boolean;
  /** The overtime rule this segment's OT is paid under (set when isOvertime). */
  overtimeRuleId?: string;
  /**
   * D1 `highest` only: true when the segment's premiums out-bid its OT rule,
   * so the premiums are paid and no OT (`overtimePence` 0). Such hours are over
   * the threshold but are not overtime hours (`isOvertimeHour`). Absent otherwise.
   */
  premiumBeatOvertime?: true;
  /** Premium/overtime rules applied to this segment, with their pence. */
  ruleAmounts: RuleAmount[];
  basePence: number;
  premiumPence: number;
  overtimePence: number;
  totalPence: number;
}

/** Per-shift engine output (SPEC §5 item 7). Totals are sums of segment pence. */
export interface ShiftBreakdown {
  shiftId: string;
  segments: Segment[];
  basePence: number;
  premiumPence: number;
  overtimePence: number;
  totalGrossPence: number;
  paidHours: number;
}

/** Amount attributed to one rule across a period. */
export interface RuleBreakdown {
  ruleId: string;
  ruleName: string;
  type: PremiumRuleType;
  hours: number;
  pence: number;
}

/** Aggregate for one pay period with a per-rule breakdown. */
export interface PeriodBreakdown {
  periodStart: LocalDate;
  periodEnd: LocalDate;
  payDate: LocalDate;
  shifts: ShiftBreakdown[];
  byRule: RuleBreakdown[];
  basePence: number;
  premiumPence: number;
  overtimePence: number;
  totalGrossPence: number;
  paidHours: number;
}

/** Payslip check result chip (SPEC §6). */
export type PayslipStatus = 'match' | 'check' | 'underpaid' | 'overpaid';

/** A structured likely cause of a payslip difference; the UI turns it into text. */
export type PayslipCause =
  /** Payslip hours differ from the expected paid hours by more than 0.25h (paid - expected). */
  | { kind: 'hours_differ'; diffHours: number }
  /** A rule that earned pence has no payslip line whose label contains its name. */
  | { kind: 'rule_not_on_payslip'; ruleId: string; dates: LocalDate[] }
  /** The shortfall is within £1 of what this rule earned. */
  | { kind: 'shortfall_matches_rule'; ruleId: string; rulePence: number }
  /** The shortfall is within £1 of the period's overtime total. */
  | { kind: 'shortfall_matches_overtime'; overtimePence: number };

/** A payslip compared with the engine's PeriodBreakdown for the same period. */
export interface PayslipDiff {
  status: PayslipStatus;
  expectedPence: number;
  paidPence: number;
  /** paid - expected, integer pence. */
  diffPence: number;
  expectedHours: number;
  paidHours?: number;
  /** paid - expected hours, float noise cleared. */
  diffHours?: number;
  causes: PayslipCause[];
}

/**
 * Holiday position for the holiday year containing a given date (SPEC §5 Holiday).
 * All values are decimal hours with float noise cleared; remaining may be negative.
 */
export interface HolidaySummary {
  /** First day of the holiday year (inclusive). */
  yearStart: LocalDate;
  /** Last day of the holiday year (inclusive). */
  yearEnd: LocalDate;
  /** Fixed: the job's entitlement. Accrual: equal to accrued. */
  entitled: number;
  /** Fixed: entitlement pro rata to days elapsed. Accrual: 12.07% of worked hours to date. */
  accrued: number;
  /** Holiday shifts dated today or later. */
  booked: number;
  /** Holiday shifts dated before today. */
  taken: number;
  /** entitled - taken - booked. */
  remaining: number;
}
