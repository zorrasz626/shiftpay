/**
 * Holiday position for the job's current holiday year (SPEC §5 Holiday).
 * The shifts store only holds -90/+120 days, so the whole holiday year's
 * shifts are read from the DB; the read re-runs whenever the store's shifts
 * or the job change (a Holiday mark in the day sheet rewrites the store).
 */
import { useEffect, useMemo, useState } from 'react';

import { db } from '../../db/client';
import { listShifts, type StoredShift } from '../../db/shiftRepo';
import { holidaySummary, holidayYearRange } from '../../engine/holiday';
import { instantToLocal } from '../../engine/time';
import type { HolidaySummary, Job } from '../../engine/types';
import { useShiftsStore } from '../../store/shiftsStore';

type Loaded = { jobId: string; shifts: StoredShift[] };

/** Null until the year's shifts have been read (or when there is no job). */
export function useHolidaySummary(job: Job | undefined): HolidaySummary | null {
  const storeShifts = useShiftsStore((s) => s.shifts);
  const today = instantToLocal(new Date().toISOString()).date;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (job === undefined) return;
    let cancelled = false;
    const { start, end } = holidayYearRange(job, today);
    listShifts(db, start, end, job.id)
      // A failed read falls back to what the store holds.
      .catch(() => storeShifts)
      .then((shifts) => {
        if (!cancelled) setLoaded({ jobId: job.id, shifts });
      });
    return () => {
      cancelled = true;
    };
  }, [job, today, storeShifts]);

  return useMemo(
    () =>
      job === undefined || loaded === null || loaded.jobId !== job.id
        ? null
        : holidaySummary(job, loaded.shifts, today),
    [job, loaded, today],
  );
}
