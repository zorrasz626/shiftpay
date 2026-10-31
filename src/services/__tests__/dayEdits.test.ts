/**
 * @jest-environment node
 *
 * Day-sheet edits (SPEC §7.3) made through the shifts store survive
 * re-materialisation: status changes, the overtime flag, and manual shifts.
 */
import { manualShiftTimes, shiftToForm } from '../../engine/manualShift';
import type { RotaPattern } from '../../engine/types';
import { type AppDb, createJob } from '../../db/jobRepo';
import { type StoredShiftTemplate, createRotaPattern, createShiftTemplate, updateShiftTemplate } from '../../db/rotaRepo';
import { type StoredShift, getShift, listShifts } from '../../db/shiftRepo';
import { createTestDb } from '../../db/testDb';
import { useShiftsStore } from '../../store/shiftsStore';
import { TODAY, job, resetStores } from '../../store/testFixtures';
import { materialiseShifts } from '../materialise';

const day: StoredShiftTemplate = {
  id: 'tpl-d',
  jobId: 'job-1',
  name: 'Day',
  startTime: '08:00',
  endTime: '16:00',
  unpaidBreakMinutes: 30,
};

const pattern: RotaPattern = {
  id: 'pat-1',
  jobId: 'job-1',
  cycleLengthDays: 1,
  startDate: '2026-01-01',
  days: [{ shiftTemplateId: 'tpl-d' }],
};

const RANGE = { start: '2026-06-15', end: '2026-06-30' };
const WORKED = '2026-06-16';
const SICK = '2026-06-17';
const HOLIDAY = '2026-06-18';
const CANCELLED = '2026-06-19';
const OVERTIME = '2026-06-20';
const MANUAL_DATE = '2026-06-21';
const MANUAL_ID = 'manual-1';
const PATTERN_EDITS = [WORKED, SICK, HOLIDAY, CANCELLED, OVERTIME];

function patternId(date: string): string {
  return `pat-1:${date}`;
}

async function requireShift(db: AppDb, id: string): Promise<StoredShift> {
  const s = await getShift(db, id);
  if (!s) throw new Error(`missing ${id}`);
  return s;
}

describe('day-sheet edits survive re-materialisation', () => {
  let db: AppDb;

  beforeEach(async () => {
    db = createTestDb();
    resetStores();
    await createJob(db, job);
    await createShiftTemplate(db, day);
    await createRotaPattern(db, pattern);
    await materialiseShifts(db, TODAY);
    await useShiftsStore.getState().load(db, RANGE);
  });

  async function makeEdits(): Promise<StoredShift[]> {
    const store = useShiftsStore.getState();
    await store.setStatus(db, patternId(WORKED), 'worked');
    await store.setStatus(db, patternId(SICK), 'sick');
    await store.setStatus(db, patternId(HOLIDAY), 'holiday');
    await store.cancelShift(db, patternId(CANCELLED));
    await store.editShift(db, { ...(await requireShift(db, patternId(OVERTIME))), overtimeFlag: true });

    // Add a manual evening shift from the form, then edit it through the form.
    const added = manualShiftTimes({ date: MANUAL_DATE, startTime: '18:00', endTime: '22:00', unpaidBreakMinutes: 0 });
    if (!added.ok) throw new Error('expected a valid manual shift');
    await store.addManualShift(db, {
      id: MANUAL_ID,
      jobId: 'job-1',
      date: MANUAL_DATE,
      start: added.start,
      end: added.end,
      unpaidBreakMinutes: 0,
      status: 'planned',
      overtimeFlag: true,
    });
    const manual = await requireShift(db, MANUAL_ID);
    const edited = manualShiftTimes({ ...shiftToForm(manual), endTime: '02:00', unpaidBreakMinutes: 15 });
    if (!edited.ok) throw new Error('expected a valid edit');
    await store.editShift(db, { ...manual, start: edited.start, end: edited.end, unpaidBreakMinutes: 15 });

    const ids = [...PATTERN_EDITS.map(patternId), MANUAL_ID];
    return Promise.all(ids.map((id) => requireShift(db, id)));
  }

  it('records each edit as userModified with the right values', async () => {
    const [worked, sick, holiday, cancelled, overtime, manual] = await makeEdits();
    expect(worked).toMatchObject({ status: 'worked', userModified: true, source: 'pattern' });
    expect(sick).toMatchObject({ status: 'sick', userModified: true });
    expect(holiday).toMatchObject({ status: 'holiday', userModified: true });
    expect(cancelled).toMatchObject({ status: 'cancelled', userModified: true });
    expect(overtime).toMatchObject({ status: 'planned', overtimeFlag: true, userModified: true });
    // 18:00 BST to 02:00 BST the next day.
    expect(manual).toEqual({
      id: MANUAL_ID,
      jobId: 'job-1',
      date: MANUAL_DATE,
      start: '2026-06-21T17:00:00.000Z',
      end: '2026-06-22T01:00:00.000Z',
      unpaidBreakMinutes: 15,
      source: 'manual',
      status: 'planned',
      overtimeFlag: true,
      userModified: true,
    });
    // The store reloaded its range after each write.
    expect(useShiftsStore.getState().shifts.find((s) => s.id === MANUAL_ID)).toEqual(manual);
  });

  it.each(['2026-06-15', '2026-06-30', '2026-10-01', '2026-05-01'])(
    'keeps every edit after a template change and re-materialising with today = %s',
    async (later) => {
      const edits = await makeEdits();
      // A template change would rewrite every future unmodified pattern shift.
      await updateShiftTemplate(db, { ...day, startTime: '09:00' });
      await materialiseShifts(db, TODAY);
      await materialiseShifts(db, later);
      await materialiseShifts(db, TODAY);

      for (const e of edits) expect(await getShift(db, e.id)).toEqual(e);

      // No duplicates: one pattern shift per edited date, plus the manual one on its date.
      for (const date of PATTERN_EDITS) {
        expect((await listShifts(db, date, date)).map((s) => s.id)).toEqual([patternId(date)]);
      }
      const onManualDate = (await listShifts(db, MANUAL_DATE, MANUAL_DATE)).map((s) => s.id).sort();
      expect(onManualDate).toEqual([MANUAL_ID, patternId(MANUAL_DATE)].sort());

      // The cancelled pattern shift is kept, never deleted.
      expect(await getShift(db, patternId(CANCELLED))).toMatchObject({ status: 'cancelled', source: 'pattern' });

      // Unmodified future pattern shifts did follow the template (09:00 BST = 08:00Z).
      expect((await requireShift(db, patternId('2026-06-22'))).start).toBe('2026-06-22T08:00:00.000Z');

      await useShiftsStore.getState().load(db, RANGE);
      const loaded = useShiftsStore.getState().shifts;
      for (const e of edits) expect(loaded.filter((s) => s.id === e.id)).toEqual([e]);
    },
  );
});
