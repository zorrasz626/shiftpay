/**
 * Overtime (SPEC §5 item 4, D1, D2): applied after base/premium allocation,
 * to the latest paid minutes first.
 *
 * Every OT rule marks a shift's LAST N paid minutes ("tail"): daily = beyond the
 * threshold within the shift; weekly / period = beyond the threshold counted
 * chronologically across shifts (worked by the caller). Slices are split
 * where a tail starts, so a segment is either wholly OT or not at all.
 * A minute marked by several OT rules is paid under the one with the highest
 * uplift (tie -> higher priority, then smaller id); OT rules never stack.
 * How the OT rule combines with the segment's premiums follows the job's
 * `overtimePremiumMode`. Rounding only via `segmentPence()`.
 */
import { clearNoise, segmentPence, sumPence } from './money';
import { applyPremiums, upliftPerHour } from './premiums';
import { addLocalDays, addMinutes, instantToLocal, startOfLocalDay } from './time';
import type {
  DayOfWeek,
  Job,
  LocalDate,
  OvertimeRule,
  PremiumRule,
  Segment,
  SegmentSlice,
} from './types';

/** For one shift: OT rule id -> how many of the shift's last paid minutes that rule marks. */
export type OvertimeTails = Map<string, number>;

export function isOvertimeRule(rule: PremiumRule): rule is OvertimeRule {
  return rule.type === 'overtime_daily' || rule.type === 'overtime_weekly' || rule.type === 'overtime_period';
}

function beats(a: OvertimeRule, b: OvertimeRule, basePence: number): boolean {
  const ua = upliftPerHour(a, basePence);
  const ub = upliftPerHour(b, basePence);
  if (ua !== ub) return ua > ub;
  if (a.priority !== b.priority) return a.priority > b.priority;
  return a.id < b.id;
}

/** The OT rule with the highest uplift (tie -> higher priority, then smaller id). */
export function topOvertimeRule(rules: OvertimeRule[], basePence: number): OvertimeRule | undefined {
  let winner: OvertimeRule | undefined;
  for (const rule of rules) {
    if (winner === undefined || beats(rule, winner, basePence)) winner = rule;
  }
  return winner;
}

/**
 * Paid minutes of a shift beyond the threshold when `before` qualifying paid
 * minutes were already counted (0 for daily OT). These are the shift's last minutes.
 */
export function overtimeTail(paidMinutes: number, before: number, thresholdHours: number): number {
  const threshold = Math.round(thresholdHours * 60);
  return Math.min(paidMinutes, Math.max(0, before + paidMinutes - threshold));
}

/** First day of the OT week containing `date`. */
export function weekStart(date: LocalDate, weekStartsOn: DayOfWeek): LocalDate {
  const dayOfWeek = instantToLocal(startOfLocalDay(date)).dayOfWeek;
  return addLocalDays(date, -((dayOfWeek - weekStartsOn + 7) % 7));
}

/** Splits off the slice's last `n` paid minutes (break 0); the earlier piece keeps the break. */
function splitTail(slice: SegmentSlice, n: number): [SegmentSlice, SegmentSlice] {
  const cut = addMinutes(slice.end, -n);
  return [
    { ...slice, end: cut, minutes: slice.minutes - n, paidMinutes: slice.paidMinutes - n },
    { ...slice, start: cut, minutes: n, breakMinutes: 0, paidMinutes: n },
  ];
}

/** Splits the slices at each cut, a paid-minute offset from the shift start. */
function splitAt(slices: SegmentSlice[], cuts: number[]): SegmentSlice[] {
  const unique = [...new Set(cuts)].sort((a, b) => b - a); // latest first
  const out: SegmentSlice[] = [];
  let from = 0;
  for (const slice of slices) {
    const to = from + slice.paidMinutes;
    let head = slice;
    const tail: SegmentSlice[] = [];
    for (const cut of unique.filter((c) => c > from && c < to)) {
      const [earlier, later] = splitTail(head, from + head.paidMinutes - cut);
      head = earlier;
      tail.unshift(later);
    }
    out.push(head, ...tail);
    from = to;
  }
  return out;
}

/** Pays `segment` (wholly OT) under `rule`, combined with its premiums per D1. */
function payOvertime(segment: Segment, rule: OvertimeRule, job: Job, rules: PremiumRule[]): Segment {
  const basePence = job.baseRatePence;
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const otPence =
    rule.multiplier !== undefined
      ? segmentPence(basePence, segment.paidMinutes, rule.multiplier - 1)
      : segmentPence(rule.flatAddPencePerHour, segment.paidMinutes);
  const premiumUplift = clearNoise(
    segment.ruleAmounts.reduce((acc, r) => acc + upliftPerHour(ruleById.get(r.ruleId) as PremiumRule, basePence), 0),
  );
  const otUplift = upliftPerHour(rule, basePence);
  const mode = job.overtimePremiumMode;
  let ruleAmounts = segment.ruleAmounts;
  let overtimePence = otPence;
  if (mode === 'replace' || (mode === 'highest' && otUplift > premiumUplift)) {
    ruleAmounts = [];
  } else if (mode === 'highest') {
    overtimePence = 0;
  }
  const premiumPence = sumPence(ruleAmounts.map((r) => r.pence));
  return {
    ...segment,
    isOvertime: true,
    overtimeRuleId: rule.id,
    ruleAmounts,
    premiumPence,
    overtimePence,
    totalPence: sumPence([segment.basePence, premiumPence, overtimePence]),
  };
}

/**
 * Base pay, premiums and overtime for one shift's slices. `tails` gives each
 * OT rule's marked minutes at the end of the shift; rules without an entry mark none.
 */
export function applyOvertime(
  slices: SegmentSlice[],
  job: Job,
  rules: PremiumRule[],
  tails: OvertimeTails,
): Segment[] {
  const total = slices.reduce((acc, s) => acc + s.paidMinutes, 0);
  // Each rule marks the paid minutes from offset `from` to the end of the shift.
  const marks = rules.filter(isOvertimeRule).map((rule) => ({ rule, from: total - (tails.get(rule.id) ?? 0) }));
  const segments = applyPremiums(splitAt(slices, marks.map((m) => m.from)), job, rules);
  let end = 0;
  return segments.map((segment) => {
    end += segment.paidMinutes;
    const marking = marks.filter((m) => end > m.from).map((m) => m.rule);
    const winner = topOvertimeRule(marking, job.baseRatePence);
    return winner === undefined ? segment : payOvertime(segment, winner, job, rules);
  });
}
