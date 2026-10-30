/**
 * Premiums (SPEC §5 item 3): attach base pay plus time_band / day_of_week /
 * bank_holiday premiums to segment slices. Overtime rules are not handled here.
 *
 * Uplift per hour: multiplier m -> base x (m - 1); flat add -> flatAddPencePerHour.
 * Matched rules combine as max(highest_only uplifts) + sum(stack uplifts).
 * A tie for the max goes to the higher priority, then the smaller rule id.
 * Each applied rule is rounded once via `segmentPence()`; sums use `sumPence()`.
 */
import { clearNoise, segmentPence, sumPence } from './money';
import { instantToLocal } from './time';
import type {
  BankHolidayRule,
  DayOfWeekRule,
  Job,
  PremiumRate,
  PremiumRule,
  RuleAmount,
  Segment,
  SegmentSlice,
  TimeBandRule,
  WallClockTime,
} from './types';

type SegmentRule = TimeBandRule | DayOfWeekRule | BankHolidayRule;

function isSegmentRule(rule: PremiumRule): rule is SegmentRule {
  return rule.type === 'time_band' || rule.type === 'day_of_week' || rule.type === 'bank_holiday';
}

/** `HH:mm` strings compare correctly as text. `end <= start` crosses midnight; `start == end` is all day. */
function inBand(time: WallClockTime, start: WallClockTime, end: WallClockTime): boolean {
  if (start === end) return true;
  if (start < end) return time >= start && time < end;
  return time >= start || time < end;
}

function matches(rule: SegmentRule, slice: SegmentSlice): boolean {
  switch (rule.type) {
    case 'time_band':
      return inBand(instantToLocal(slice.start).time, rule.startTime, rule.endTime);
    case 'day_of_week':
      return rule.daysOfWeek.includes(slice.dayOfWeek);
    case 'bank_holiday':
      return slice.isBankHoliday;
  }
}

/**
 * Uplift in (decimal) pence per hour: multiplier m -> base x (m - 1); flat add as is.
 * Noise-cleared, for comparison only; never paid out.
 */
export function upliftPerHour(rate: PremiumRate, basePence: number): number {
  const raw = rate.multiplier !== undefined ? basePence * (rate.multiplier - 1) : rate.flatAddPencePerHour;
  return clearNoise(raw);
}

/** The rule's pay on `paidMinutes`, rounded once. */
function rulePence(rule: SegmentRule, basePence: number, paidMinutes: number): number {
  return rule.multiplier !== undefined
    ? segmentPence(basePence, paidMinutes, rule.multiplier - 1)
    : segmentPence(rule.flatAddPencePerHour, paidMinutes);
}

/** True if `a` beats `b` for the highest_only slot. */
function beats(a: SegmentRule, b: SegmentRule, basePence: number): boolean {
  const ua = upliftPerHour(a, basePence);
  const ub = upliftPerHour(b, basePence);
  if (ua !== ub) return ua > ub;
  if (a.priority !== b.priority) return a.priority > b.priority;
  return a.id < b.id;
}

/** Base pay plus premiums for each slice, in the slices' order. Overtime fields are 0 / false. */
export function applyPremiums(slices: SegmentSlice[], job: Job, rules: PremiumRule[]): Segment[] {
  const segmentRules = rules.filter(isSegmentRule);
  const basePence = job.baseRatePence;
  return slices.map((slice) => {
    const matched = segmentRules.filter((rule) => matches(rule, slice));
    let winner: SegmentRule | undefined;
    for (const rule of matched) {
      if (rule.stacking === 'highest_only' && (winner === undefined || beats(rule, winner, basePence))) {
        winner = rule;
      }
    }
    // Input order is kept: the winning highest_only rule plus every stacked rule.
    const ruleAmounts: RuleAmount[] = matched
      .filter((rule) => rule.stacking === 'stack' || rule === winner)
      .map((rule) => ({ ruleId: rule.id, pence: rulePence(rule, basePence, slice.paidMinutes) }));
    const segmentBase = segmentPence(basePence, slice.paidMinutes);
    const premiumPence = sumPence(ruleAmounts.map((r) => r.pence));
    const overtimePence = 0;
    return {
      ...slice,
      isOvertime: false,
      ruleAmounts,
      basePence: segmentBase,
      premiumPence,
      overtimePence,
      totalPence: sumPence([segmentBase, premiumPence, overtimePence]),
    };
  });
}
