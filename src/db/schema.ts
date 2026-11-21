/**
 * SQLite schema (SPEC §4 + D1, D4-D6). Field names follow `src/engine/types.ts`,
 * in snake_case. Representation:
 * - ids: app-generated text primary keys
 * - LocalDate `YYYY-MM-DD`, WallClockTime `HH:mm`, IsoInstant UTC ISO: text
 * - money: integer pence; multipliers, hours, thresholds and flat adds: REAL (D3)
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type {
  BankHolidayRegion,
  DayOfWeek,
  HolidayMode,
  OvertimePremiumMode,
  PayFrequency,
  PremiumRuleType,
  RotaDay,
  ShiftSource,
  ShiftStatus,
  StackingMode,
} from '../engine/types';

const PAY_FREQUENCIES = [
  'weekly',
  'fortnightly',
  'four_weekly',
  'monthly',
] as const satisfies readonly PayFrequency[];
const BANK_HOLIDAY_REGIONS = [
  'england-and-wales',
  'scotland',
  'northern-ireland',
] as const satisfies readonly BankHolidayRegion[];
const OVERTIME_PREMIUM_MODES = [
  'replace',
  'highest',
  'stack',
] as const satisfies readonly OvertimePremiumMode[];
const HOLIDAY_MODES = ['fixed', 'accrual'] as const satisfies readonly HolidayMode[];
const PREMIUM_RULE_TYPES = [
  'time_band',
  'day_of_week',
  'bank_holiday',
  'overtime_daily',
  'overtime_weekly',
  'overtime_period',
] as const satisfies readonly PremiumRuleType[];
const STACKING_MODES = ['stack', 'highest_only'] as const satisfies readonly StackingMode[];
const SHIFT_SOURCES = ['pattern', 'manual'] as const satisfies readonly ShiftSource[];
const SHIFT_STATUSES = [
  'planned',
  'worked',
  'sick',
  'holiday',
  'cancelled',
] as const satisfies readonly ShiftStatus[];

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  baseRatePence: integer('base_rate_pence').notNull(),
  payFrequency: text('pay_frequency', { enum: PAY_FREQUENCIES }).notNull(),
  payPeriodAnchorDate: text('pay_period_anchor_date').notNull(),
  payDayOffsetDays: integer('pay_day_offset_days').notNull(),
  periodCutoffDay: integer('period_cutoff_day').notNull(),
  contractedHoursPerWeek: real('contracted_hours_per_week').notNull(),
  bankHolidayRegion: text('bank_holiday_region', { enum: BANK_HOLIDAY_REGIONS }).notNull(),
  overtimePremiumMode: text('overtime_premium_mode', { enum: OVERTIME_PREMIUM_MODES })
    .notNull()
    .default('highest'),
  holidayYearStart: text('holiday_year_start').notNull(),
  holidayEntitlementHours: real('holiday_entitlement_hours').notNull(),
  holidayMode: text('holiday_mode', { enum: HOLIDAY_MODES }).notNull().default('fixed'),
  colour: text('colour'),
});

export const premiumRules = sqliteTable(
  'premium_rules',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type', { enum: PREMIUM_RULE_TYPES }).notNull(),
    /** Exactly one of multiplier / flat_add_pence_per_hour is set (CHECK below). */
    multiplier: real('multiplier'),
    flatAddPencePerHour: real('flat_add_pence_per_hour'),
    startTime: text('start_time'),
    endTime: text('end_time'),
    daysOfWeek: text('days_of_week', { mode: 'json' }).$type<DayOfWeek[]>(),
    thresholdHours: real('threshold_hours'),
    weekStartsOn: integer('week_starts_on').$type<DayOfWeek>(),
    stacking: text('stacking', { enum: STACKING_MODES }).notNull().default('highest_only'),
    priority: integer('priority').notNull().default(0),
  },
  (t) => [
    index('premium_rules_job_id_idx').on(t.jobId),
    check(
      'premium_rules_rate_check',
      sql`(${t.multiplier} IS NULL) <> (${t.flatAddPencePerHour} IS NULL)`,
    ),
  ],
);

export const shiftTemplates = sqliteTable(
  'shift_templates',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    unpaidBreakMinutes: integer('unpaid_break_minutes').notNull(),
    colour: text('colour'),
  },
  (t) => [index('shift_templates_job_id_idx').on(t.jobId)],
);

export const rotaPatterns = sqliteTable(
  'rota_patterns',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    cycleLengthDays: integer('cycle_length_days').notNull(),
    startDate: text('start_date').notNull(),
    days: text('days', { mode: 'json' }).$type<RotaDay[]>().notNull(),
  },
  (t) => [index('rota_patterns_job_id_idx').on(t.jobId)],
);

export const shifts = sqliteTable(
  'shifts',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    start: text('start').notNull(),
    end: text('end').notNull(),
    unpaidBreakMinutes: integer('unpaid_break_minutes').notNull(),
    source: text('source', { enum: SHIFT_SOURCES }).notNull(),
    status: text('status', { enum: SHIFT_STATUSES }).notNull(),
    overtimeFlag: integer('overtime_flag', { mode: 'boolean' }).notNull(),
    notes: text('notes'),
    /**
     * Pattern the shift was generated from. Deleting the pattern sets this to
     * null (history and user edits are kept; materialise prunes the future).
     */
    patternId: text('pattern_id').references(() => rotaPatterns.id, { onDelete: 'set null' }),
    /** Set on any manual/status edit so regeneration never overwrites it. */
    userModified: integer('user_modified', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    index('shifts_job_id_date_idx').on(t.jobId, t.date),
    // Date-range reads across all jobs (the shifts store's window).
    index('shifts_date_idx').on(t.date),
    // ON DELETE SET NULL looks up child rows by pattern_id.
    index('shifts_pattern_id_idx').on(t.patternId),
  ],
);

export const payslips = sqliteTable(
  'payslips',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    periodStart: text('period_start').notNull(),
    periodEnd: text('period_end').notNull(),
    grossPaidPence: integer('gross_paid_pence').notNull(),
    hoursPaid: real('hours_paid'),
    taxPence: integer('tax_pence').notNull(),
    niPence: integer('ni_pence').notNull(),
    pensionPence: integer('pension_pence').notNull(),
    netPence: integer('net_pence'),
  },
  (t) => [index('payslips_job_id_idx').on(t.jobId)],
);

export const payslipLines = sqliteTable(
  'payslip_lines',
  {
    id: text('id').primaryKey(),
    payslipId: text('payslip_id')
      .notNull()
      .references(() => payslips.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    label: text('label').notNull(),
    hours: real('hours'),
    amountPence: integer('amount_pence').notNull(),
  },
  (t) => [index('payslip_lines_payslip_id_idx').on(t.payslipId)],
);

/** Key/value settings; value is JSON-encoded by the repositories. */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
