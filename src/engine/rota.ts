/**
 * Rota generation (SPEC §2 item 1, §4 RotaPattern/Shift).
 *
 * Turns a rota pattern plus its shift templates into planned `Shift`s for an
 * inclusive local-date range. Cycle day for a date = days from
 * `pattern.startDate`, mod `cycleLengthDays` (normalised to 0..n-1, so dates
 * before `startDate` work). A shift belongs to the date it starts on; if
 * `endTime <= startTime` it ends the next day. Wall times go through
 * `localToInstant`, so DST gap/overlap handling follows time.ts (D4).
 */
import type { DateRange } from './shiftPay';
import { addLocalDays, localDaysBetween, localToInstant } from './time';
import type { RotaPattern, Shift, ShiftTemplate } from './types';

/** Planned shifts for `pattern` on every date in `range` (inclusive), ordered by date. */
export function generateShifts(pattern: RotaPattern, templates: ShiftTemplate[], range: DateRange): Shift[] {
  const n = pattern.cycleLengthDays;
  if (n < 1) throw new Error(`Rota pattern ${pattern.id}: cycleLengthDays must be at least 1 (got ${n})`);
  if (pattern.days.length !== n) {
    throw new Error(`Rota pattern ${pattern.id}: days.length ${pattern.days.length} !== cycleLengthDays ${n}`);
  }
  const byId = new Map(templates.map((t) => [t.id, t]));
  const cycle = pattern.days.map((d) => {
    if (d === 'OFF') return undefined;
    const template = byId.get(d.shiftTemplateId);
    if (template === undefined) {
      throw new Error(`Rota pattern ${pattern.id}: shift template ${d.shiftTemplateId} not found`);
    }
    return template;
  });
  const length = localDaysBetween(range.start, range.end) + 1;
  if (length < 1) throw new Error(`Invalid range: ${range.start} is after ${range.end}`);

  const firstIndex = localDaysBetween(pattern.startDate, range.start);
  const shifts: Shift[] = [];
  for (let i = 0; i < length; i++) {
    const template = cycle[(((firstIndex + i) % n) + n) % n];
    if (template === undefined) continue;
    const date = addLocalDays(range.start, i);
    const endDate = template.endTime <= template.startTime ? addLocalDays(date, 1) : date;
    shifts.push({
      id: `${pattern.id}:${date}`,
      jobId: pattern.jobId,
      date,
      start: localToInstant(date, template.startTime),
      end: localToInstant(endDate, template.endTime),
      unpaidBreakMinutes: template.unpaidBreakMinutes,
      source: 'pattern',
      status: 'planned',
      overtimeFlag: false,
    });
  }
  return shifts;
}
