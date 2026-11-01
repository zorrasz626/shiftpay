/**
 * Shift detail (SPEC §7): how one shift's expected gross is made up — base,
 * each premium rule, overtime — plus its time slices. Pure.
 *
 * The shift is priced with `calculateShifts` over its own pay period (like
 * `homeSummary`), so weekly / period OT from the other shifts is right.
 * Every pence figure is a sum of the engine's already-rounded segment pence,
 * never re-rounded, so sum(lines.pence) === totalGrossPence exactly.
 */
import type { BankHolidayLookup } from './bankHolidays';
import { sumPence } from './money';
import { periodContaining } from './payPeriods';
import { calculateShifts } from './shiftPay';
import { instantToLocal } from './time';
import type { IsoInstant, Job, PremiumRule, Segment, Shift, WallClockTime } from './types';
import { isOvertimeHour, isOvertimeRule } from './overtime';

export type ShiftDetailLineKind = 'base' | 'premium' | 'overtime';

export interface ShiftDetailLine {
  /** Stable key: `base`, `premium:<ruleId>` or `overtime:<ruleId>`. */
  key: string;
  label: string;
  kind: ShiftDetailLineKind;
  /** Paid hours this line was paid on (decimal). */
  hours: number;
  pence: number;
}

export interface ShiftDetailSlice {
  start: IsoInstant;
  end: IsoInstant;
  /** London wall-clock time at the slice start / end. */
  localStart: WallClockTime;
  localEnd: WallClockTime;
  paidMinutes: number;
  /** Names of the rules that paid on this slice (empty = base only). */
  labels: string[];
  totalPence: number;
}

export interface ShiftDetail {
  totalGrossPence: number;
  paidHours: number;
  /**
   * "Base" first, then premiums by rule, then overtime by rule; 0p lines
   * dropped, except overtime lines with hours.
   */
  lines: ShiftDetailLine[];
  slices: ShiftDetailSlice[];
}

export interface ShiftDetailInput {
  shift: Shift;
  /** All of the job's shifts (other shifts in the week / period count to OT). */
  shifts: Shift[];
  job: Job;
  rules: PremiumRule[];
  bankHolidays: BankHolidayLookup;
}

function line(
  key: string,
  label: string,
  kind: ShiftDetailLineKind,
  segments: Segment[],
  pick: (s: Segment) => number,
): ShiftDetailLine {
  return {
    key,
    label,
    kind,
    hours: segments.reduce((acc, s) => acc + s.paidMinutes, 0) / 60,
    pence: sumPence(segments.map(pick)),
  };
}

/** Pay breakdown for `shift` of `job`. Throws if the shift is not the job's. */
export function shiftDetail({
  shift,
  shifts,
  job,
  rules,
  bankHolidays,
}: ShiftDetailInput): ShiftDetail {
  if (shift.jobId !== job.id) throw new Error(`Shift ${shift.id} is not for job ${job.id}`);
  const input = shifts.some((s) => s.id === shift.id) ? shifts : [...shifts, shift];
  const period = periodContaining(shift.date, job);
  const breakdown = calculateShifts(input, job, rules, bankHolidays, period).find(
    (b) => b.shiftId === shift.id,
  );
  // `shift` is in `input`, is the job's and is dated within `period`, so it is always priced.
  const { segments, totalGrossPence, paidHours } = breakdown as NonNullable<typeof breakdown>;

  const jobRules = rules.filter((r) => r.jobId === job.id);
  const premiumLines = jobRules
    .filter((r) => !isOvertimeRule(r))
    .map((rule) => {
      const paid = segments.filter((s) => s.ruleAmounts.some((a) => a.ruleId === rule.id));
      return line(`premium:${rule.id}`, rule.name, 'premium', paid, (s) =>
        sumPence(s.ruleAmounts.filter((a) => a.ruleId === rule.id).map((a) => a.pence)),
      );
    });
  const overtimeLines = jobRules.filter(isOvertimeRule).map((rule) =>
    line(
      `overtime:${rule.id}`,
      rule.name,
      'overtime',
      segments.filter((s) => isOvertimeHour(s, rule.id)),
      (s) => s.overtimePence,
    ),
  );
  const lines = [
    line('base', 'Base', 'base', segments, (s) => s.basePence),
    ...premiumLines,
    ...overtimeLines,
  ].filter((l) => l.pence !== 0 || (l.kind === 'overtime' && l.hours !== 0));

  const ruleNames = new Map(jobRules.map((r) => [r.id, r.name]));
  const slices = segments.map((s): ShiftDetailSlice => {
    const labels = s.ruleAmounts
      .filter((a) => a.pence !== 0)
      .map((a) => ruleNames.get(a.ruleId) as string);
    if (isOvertimeHour(s)) labels.push(ruleNames.get(s.overtimeRuleId as string) as string);
    return {
      start: s.start,
      end: s.end,
      localStart: instantToLocal(s.start).time,
      localEnd: instantToLocal(s.end).time,
      paidMinutes: s.paidMinutes,
      labels,
      totalPence: s.totalPence,
    };
  });

  return { totalGrossPence, paidHours, lines, slices };
}
