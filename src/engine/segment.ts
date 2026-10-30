/**
 * Shift segmentation (SPEC §5 items 1-2): split one shift into slices at
 * every boundary that can change its pay, then deduct the unpaid break (D7).
 * No money here: premiums and overtime attach pay to these slices later.
 */
import type { BankHolidayLookup } from './bankHolidays';
import {
  addLocalDays,
  addMinutes,
  instantToLocal,
  localToInstant,
  minutesBetween,
  nextLocalMidnights,
  utcOffsetMinutes,
} from './time';
import type { BankHolidayRegion, IsoInstant, SegmentSlice, Shift, TimeBandRule } from './types';

/** Longest shift accepted: 26h, so a 25h night over the BST->GMT change still passes. */
export const MAX_SHIFT_MINUTES = 26 * 60;

export interface SegmentOptions {
  timeBands: TimeBandRule[];
  region: BankHolidayRegion;
  bankHolidays: BankHolidayLookup;
}

/**
 * Every time-band start/end edge, as an instant, on each London date the
 * shift touches plus the day before. Each date gets both edges, so the end
 * edge of a band that crosses midnight (22:00-06:00) is picked up on the
 * next date. Edges outside the shift are filtered out by the caller.
 * Non-existent / ambiguous wall-clock edges resolve per D4 (localToInstant).
 */
function bandEdges(shift: Shift, timeBands: TimeBandRule[]): IsoInstant[] {
  const edges: IsoInstant[] = [];
  const last = instantToLocal(shift.end).date;
  for (let date = addLocalDays(instantToLocal(shift.start).date, -1); date <= last; date = addLocalDays(date, 1)) {
    for (const band of timeBands) {
      edges.push(localToInstant(date, band.startTime), localToInstant(date, band.endTime));
    }
  }
  return edges;
}

/**
 * The first whole minute after `start` at which the London UTC offset differs
 * from the offset at `start`, found by binary search. A shift of at most 26h
 * can contain at most one changeover (they are months apart).
 */
function offsetChange(start: IsoInstant, end: IsoInstant, total: number): IsoInstant | undefined {
  const before = utcOffsetMinutes(start);
  if (utcOffsetMinutes(end) === before) return undefined;
  let lo = 0;
  let hi = total;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (utcOffsetMinutes(addMinutes(start, mid)) === before) lo = mid;
    else hi = mid;
  }
  return addMinutes(start, hi);
}

/** Splits `shift` into slices ordered by start, with the unpaid break deducted. */
export function segmentShift(shift: Shift, options: SegmentOptions): SegmentSlice[] {
  const total = minutesBetween(shift.start, shift.end);
  if (total <= 0) throw new Error(`Shift ${shift.id}: end must be after start`);
  if (total > MAX_SHIFT_MINUTES) throw new Error(`Shift ${shift.id}: longer than 26h`);
  const breakMinutes = shift.unpaidBreakMinutes;
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0) {
    throw new Error(`Shift ${shift.id}: unpaid break must be a whole number of minutes >= 0`);
  }

  // Cut points keyed by minutes after start: drops duplicates and anything
  // at or outside the shift's ends (no zero-length slices).
  const cuts = new Map<number, IsoInstant>();
  const addCut = (instant: IsoInstant) => {
    const at = minutesBetween(shift.start, instant);
    if (at > 0 && at < total) cuts.set(at, instant);
  };
  nextLocalMidnights(shift.start, shift.end).forEach(addCut);
  bandEdges(shift, options.timeBands).forEach(addCut);
  const change = offsetChange(shift.start, shift.end, total);
  if (change !== undefined) addCut(change);

  const offsets = [...cuts.keys()].sort((a, b) => a - b);
  const bounds: IsoInstant[] = [shift.start, ...offsets.map((m) => cuts.get(m) as IsoInstant), shift.end];
  const slices: SegmentSlice[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i];
    const end = bounds[i + 1];
    const minutes = minutesBetween(start, end);
    const local = instantToLocal(start);
    slices.push({
      start,
      end,
      localDate: local.date,
      dayOfWeek: local.dayOfWeek,
      minutes,
      breakMinutes: 0,
      paidMinutes: minutes,
      isBankHoliday: options.bankHolidays.isBankHoliday(options.region, local.date),
    });
  }

  // D7: break off the longest slice (tie -> earliest); any excess spills to
  // the next longest, and so on. A break >= the shift leaves 0 paid everywhere.
  const order = slices.map((_, i) => i).sort((a, b) => slices[b].minutes - slices[a].minutes || a - b);
  let remaining = breakMinutes;
  for (const i of order) {
    const taken = Math.min(remaining, slices[i].minutes);
    slices[i].breakMinutes = taken;
    slices[i].paidMinutes = slices[i].minutes - taken;
    remaining -= taken;
  }
  return slices;
}
