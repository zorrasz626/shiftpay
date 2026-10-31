import {
  REMINDER_DEFAULTS,
  REMINDER_LEAD_KEY,
  REMINDER_LEAD_OPTIONS,
  REMINDERS_ENABLED_KEY,
  formatLeadMinutes,
  planReminders,
  reminderSettings,
} from '../reminders';
import { localToInstant } from '../time';
import type { IsoInstant, LocalDate, Shift, ShiftStatus } from '../types';

function shift(
  id: string,
  start: IsoInstant,
  opts: { status?: ShiftStatus; overtimeFlag?: boolean; jobId?: string; date?: LocalDate } = {},
): Shift {
  return {
    id,
    jobId: opts.jobId ?? 'j1',
    date: opts.date ?? (start.slice(0, 10) as LocalDate),
    start,
    end: start,
    unpaidBreakMinutes: 0,
    source: 'manual',
    status: opts.status ?? 'planned',
    overtimeFlag: opts.overtimeFlag ?? false,
  };
}

const jobNames = { j1: 'Warehouse' };
const NOW = '2026-11-02T08:00:00.000Z';

describe('constants', () => {
  it('exposes defaults, lead options and settings keys', () => {
    expect(REMINDER_DEFAULTS).toEqual({ enabled: true, leadMinutes: 60, maxReminders: 30 });
    expect(REMINDER_LEAD_OPTIONS).toEqual([15, 30, 60, 120, 180]);
    expect(REMINDERS_ENABLED_KEY).toBe('reminders.enabled');
    expect(REMINDER_LEAD_KEY).toBe('reminders.leadMinutes');
  });
});

describe('reminderSettings', () => {
  it('uses defaults when nothing is stored', () => {
    expect(reminderSettings({})).toEqual({ enabled: true, leadMinutes: 60 });
  });

  it('reads stored values', () => {
    expect(reminderSettings({ [REMINDERS_ENABLED_KEY]: false, [REMINDER_LEAD_KEY]: 30 })).toEqual({
      enabled: false,
      leadMinutes: 30,
    });
    expect(reminderSettings({ [REMINDER_LEAD_KEY]: 1440 }).leadMinutes).toBe(1440);
  });

  it.each([0, -15, 1441, 12.5, '30', null, Number.NaN])('falls back for invalid lead %p', (lead) => {
    expect(reminderSettings({ [REMINDER_LEAD_KEY]: lead }).leadMinutes).toBe(60);
  });

  it('falls back for a non-boolean enabled value', () => {
    expect(reminderSettings({ [REMINDERS_ENABLED_KEY]: 'false' }).enabled).toBe(true);
  });
});

describe('formatLeadMinutes', () => {
  it.each([
    [15, '15 min'],
    [30, '30 min'],
    [60, '1 h'],
    [90, '1 h 30 min'],
    [120, '2 h'],
    [180, '3 h'],
    [0, '0 min'],
  ])('%p -> %p', (minutes, label) => {
    expect(formatLeadMinutes(minutes)).toBe(label);
  });
});

describe('planReminders', () => {
  it('plans a reminder lead minutes before a planned shift', () => {
    const start = localToInstant('2026-11-03', '07:00');
    const result = planReminders({ shifts: [shift('s1', start)], jobNames, now: NOW, leadMinutes: 60 });
    expect(result).toEqual([
      {
        id: 'shift-s1-2026-11-03T06:00:00.000Z',
        shiftId: 's1',
        fireAt: '2026-11-03T06:00:00.000Z',
        title: 'Shift in 1 h',
        body: 'Warehouse · starts 07:00 on Tue 3 Nov',
      },
    ]);
  });

  it('only reminds for planned shifts', () => {
    const start = localToInstant('2026-11-03', '07:00');
    const statuses: ShiftStatus[] = ['planned', 'worked', 'holiday', 'sick', 'cancelled'];
    const shifts = statuses.map((status) => shift(status, start, { status }));
    const result = planReminders({ shifts, jobNames, now: NOW, leadMinutes: 60 });
    expect(result.map((r) => r.shiftId)).toEqual(['planned']);
  });

  it('keeps only reminders that fire strictly after now', () => {
    const shifts = [
      shift('past', '2026-11-02T08:30:00.000Z'), // fires 07:30Z, before now
      shift('exact', '2026-11-02T09:00:00.000Z'), // fires exactly at now
      shift('future', '2026-11-02T09:01:00.000Z'), // fires 08:01Z
    ];
    const result = planReminders({ shifts, jobNames, now: NOW, leadMinutes: 60 });
    expect(result.map((r) => r.shiftId)).toEqual(['future']);
  });

  it('compares now as an instant, not a string', () => {
    const shifts = [shift('s1', '2026-11-02T09:01:00.000Z')];
    const result = planReminders({ shifts, jobNames, now: '2026-11-02T08:00:00+00:00', leadMinutes: 60 });
    expect(result).toHaveLength(1);
  });

  it('sorts by fireAt, then shiftId, and caps to max', () => {
    const t1 = '2026-11-04T07:00:00.000Z';
    const t2 = '2026-11-03T07:00:00.000Z';
    const shifts = [shift('b', t1), shift('a', t1), shift('z', t2), shift('c', t1)];
    const all = planReminders({ shifts, jobNames, now: NOW, leadMinutes: 60 });
    expect(all.map((r) => r.shiftId)).toEqual(['z', 'a', 'b', 'c']);
    const capped = planReminders({ shifts, jobNames, now: NOW, leadMinutes: 60, max: 2 });
    expect(capped.map((r) => r.shiftId)).toEqual(['z', 'a']);
    expect(planReminders({ shifts, jobNames, now: NOW, leadMinutes: 60, max: 0 })).toEqual([]);
  });

  it('keeps duplicate ids with the same fire time', () => {
    const t = '2026-11-04T07:00:00.000Z';
    const result = planReminders({ shifts: [shift('a', t), shift('a', t)], jobNames, now: NOW, leadMinutes: 60 });
    expect(result).toHaveLength(2);
  });

  it('caps to REMINDER_DEFAULTS.maxReminders by default', () => {
    const shifts = Array.from({ length: 40 }, (_, i) =>
      shift(`s${String(i).padStart(2, '0')}`, `2026-12-${String(1 + (i % 28)).padStart(2, '0')}T07:00:00.000Z`),
    );
    const result = planReminders({ shifts, jobNames, now: NOW, leadMinutes: 60 });
    expect(result).toHaveLength(30);
  });

  it('changes the id when the shift time changes', () => {
    const a = planReminders({ shifts: [shift('s1', '2026-11-03T07:00:00.000Z')], jobNames, now: NOW, leadMinutes: 60 });
    const b = planReminders({ shifts: [shift('s1', '2026-11-03T08:00:00.000Z')], jobNames, now: NOW, leadMinutes: 60 });
    expect(a[0].id).not.toBe(b[0].id);
  });

  it('labels the lead time and falls back for an unknown job', () => {
    const start = localToInstant('2026-11-03', '07:00');
    const [known] = planReminders({ shifts: [shift('s1', start)], jobNames, now: NOW, leadMinutes: 90 });
    expect(known.title).toBe('Shift in 1 h 30 min');
    const [unknown] = planReminders({
      shifts: [shift('s2', start, { jobId: 'gone' })],
      jobNames,
      now: NOW,
      leadMinutes: 30,
    });
    expect(unknown.title).toBe('Shift in 30 min');
    expect(unknown.body).toBe('Starts 07:00 on Tue 3 Nov');
  });

  it('marks overtime and uses the start date for overnight shifts', () => {
    const start = localToInstant('2026-11-05', '22:00');
    const s = { ...shift('n1', start, { overtimeFlag: true }), end: localToInstant('2026-11-06', '06:00') };
    const [r] = planReminders({ shifts: [s], jobNames, now: NOW, leadMinutes: 120 });
    expect(r.body).toBe('Warehouse · starts 22:00 on Thu 5 Nov (overtime)');
    expect(r.title).toBe('Shift in 2 h');
  });

  it('formats London local time in BST, not the device zone', () => {
    const start = localToInstant('2026-07-01', '06:15');
    const [r] = planReminders({ shifts: [shift('s1', start)], jobNames, now: '2026-06-01T00:00:00.000Z', leadMinutes: 15 });
    expect(start).toBe('2026-07-01T05:15:00.000Z');
    expect(r.fireAt).toBe('2026-07-01T05:00:00.000Z');
    expect(r.body).toBe('Warehouse · starts 06:15 on Wed 1 Jul');
  });

  describe('BST boundaries (lead in real minutes)', () => {
    const now = '2026-03-01T00:00:00.000Z';

    it('spring forward: 01:30 local on 29 Mar 2026', () => {
      // 01:30 does not exist; it reads as 02:30 BST = 01:30Z.
      const start = localToInstant('2026-03-29', '01:30');
      expect(start).toBe('2026-03-29T01:30:00.000Z');
      const [r] = planReminders({ shifts: [shift('s1', start)], jobNames, now, leadMinutes: 120 });
      // Two real hours earlier is 23:30 GMT on the 28th (wall clock would say 00:30).
      expect(r.fireAt).toBe('2026-03-28T23:30:00.000Z');
      expect(r.body).toBe('Warehouse · starts 02:30 on Sun 29 Mar');
    });

    it('fall back: 01:30 local on 25 Oct 2026 (both readings)', () => {
      const first = localToInstant('2026-10-25', '01:30');
      expect(first).toBe('2026-10-25T00:30:00.000Z'); // 01:30 BST
      const second = '2026-10-25T01:30:00.000Z'; // 01:30 GMT, one real hour later
      const result = planReminders({
        shifts: [shift('bst', first), shift('gmt', second)],
        jobNames,
        now: '2026-10-01T00:00:00.000Z',
        leadMinutes: 60,
      });
      expect(result.map((r) => [r.shiftId, r.fireAt, r.body])).toEqual([
        ['bst', '2026-10-24T23:30:00.000Z', 'Warehouse · starts 01:30 on Sun 25 Oct'],
        // One real hour before 01:30 GMT is 01:30 BST (00:30Z), not 00:30 wall clock.
        ['gmt', '2026-10-25T00:30:00.000Z', 'Warehouse · starts 01:30 on Sun 25 Oct'],
      ]);
    });
  });
});
