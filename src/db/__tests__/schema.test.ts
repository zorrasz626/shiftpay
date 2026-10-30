/**
 * @jest-environment node
 */
import { eq, sql } from 'drizzle-orm';

import type { AppDb } from '../jobRepo';
import * as schema from '../schema';
import { createTestDb } from '../testDb';

const TABLES = [
  'jobs',
  'premium_rules',
  'shift_templates',
  'rota_patterns',
  'shifts',
  'payslips',
  'payslip_lines',
  'settings',
];

const job: typeof schema.jobs.$inferInsert = {
  id: 'job-1',
  name: 'Main job',
  baseRatePence: 1250,
  payFrequency: 'four_weekly',
  payPeriodAnchorDate: '2026-04-06',
  payDayOffsetDays: 5,
  periodCutoffDay: 31,
  contractedHoursPerWeek: 37.5,
  bankHolidayRegion: 'scotland',
  overtimePremiumMode: 'stack',
  holidayYearStart: '2026-04-01',
  holidayEntitlementHours: 210.25,
  holidayMode: 'accrual',
  colour: '#3366ff',
};

const rule: typeof schema.premiumRules.$inferInsert = {
  id: 'rule-1',
  jobId: 'job-1',
  name: 'Nights',
  type: 'time_band',
  multiplier: 1.333,
  flatAddPencePerHour: null,
  startTime: '22:00',
  endTime: '06:00',
  daysOfWeek: [0, 6],
  thresholdHours: 39.5,
  weekStartsOn: 1,
  stacking: 'stack',
  priority: 3,
};

const template: typeof schema.shiftTemplates.$inferInsert = {
  id: 'tpl-1',
  jobId: 'job-1',
  name: 'Night',
  startTime: '22:00',
  endTime: '06:00',
  unpaidBreakMinutes: 30,
  colour: '#112233',
};

const pattern: typeof schema.rotaPatterns.$inferInsert = {
  id: 'pat-1',
  jobId: 'job-1',
  cycleLengthDays: 3,
  startDate: '2026-01-05',
  days: [{ shiftTemplateId: 'tpl-1' }, 'OFF', 'OFF'],
};

const shift: typeof schema.shifts.$inferInsert = {
  id: 'shift-1',
  jobId: 'job-1',
  date: '2026-10-24',
  start: '2026-10-24T21:00:00.000Z',
  end: '2026-10-25T06:00:00.000Z',
  unpaidBreakMinutes: 30,
  source: 'pattern',
  status: 'worked',
  overtimeFlag: true,
  notes: 'Clock change night',
  patternId: 'pat-1',
  userModified: true,
};

const payslip: typeof schema.payslips.$inferInsert = {
  id: 'slip-1',
  jobId: 'job-1',
  periodStart: '2026-04-06',
  periodEnd: '2026-05-03',
  grossPaidPence: 187550,
  hoursPaid: 150.75,
  taxPence: 20000,
  niPence: 9000,
  pensionPence: 5626,
  netPence: 152924,
};

const line: typeof schema.payslipLines.$inferInsert = {
  id: 'line-1',
  payslipId: 'slip-1',
  position: 0,
  label: 'Night premium',
  hours: 1.333,
  amountPence: 4166,
};

function seed(db: AppDb): void {
  db.insert(schema.jobs).values(job).run();
  db.insert(schema.premiumRules).values(rule).run();
  db.insert(schema.shiftTemplates).values(template).run();
  db.insert(schema.rotaPatterns).values(pattern).run();
  db.insert(schema.shifts).values(shift).run();
  db.insert(schema.payslips).values(payslip).run();
  db.insert(schema.payslipLines).values(line).run();
  db.insert(schema.settings).values({ key: 'pensionPercent', value: '5.5' }).run();
}

describe('db schema', () => {
  let db: AppDb;

  beforeEach(() => {
    db = createTestDb();
  });

  it('applies the migrations and creates all 8 tables', () => {
    const names = db
      .all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(TABLES));
  });

  it('round-trips a full row per table', () => {
    seed(db);
    expect(db.select().from(schema.jobs).all()).toEqual([job]);
    expect(db.select().from(schema.premiumRules).all()).toEqual([rule]);
    expect(db.select().from(schema.shiftTemplates).all()).toEqual([template]);
    expect(db.select().from(schema.rotaPatterns).all()).toEqual([pattern]);
    expect(db.select().from(schema.shifts).all()).toEqual([shift]);
    expect(db.select().from(schema.payslips).all()).toEqual([payslip]);
    expect(db.select().from(schema.payslipLines).all()).toEqual([line]);
    expect(db.select().from(schema.settings).all()).toEqual([
      { key: 'pensionPercent', value: '5.5' },
    ]);

    const [r] = db.select().from(schema.premiumRules).all();
    expect(r.multiplier).toBe(1.333);
    expect(Array.isArray(r.daysOfWeek)).toBe(true);
    const [s] = db.select().from(schema.shifts).all();
    expect(s.overtimeFlag).toBe(true);
    expect(s.userModified).toBe(true);
  });

  it('applies column defaults', () => {
    const { overtimePremiumMode: _o, holidayMode: _h, colour: _c, ...minimal } = job;
    db.insert(schema.jobs).values(minimal).run();
    const [j] = db.select().from(schema.jobs).all();
    expect(j.overtimePremiumMode).toBe('highest');
    expect(j.holidayMode).toBe('fixed');
    expect(j.colour).toBeNull();

    db.insert(schema.premiumRules)
      .values({ id: 'r2', jobId: 'job-1', name: 'Bank hols', type: 'bank_holiday', multiplier: 2 })
      .run();
    const [r] = db.select().from(schema.premiumRules).all();
    expect(r.stacking).toBe('highest_only');
    expect(r.priority).toBe(0);
    expect(r.daysOfWeek).toBeNull();

    const { userModified: _u, patternId: _p, notes: _n, ...minimalShift } = shift;
    db.insert(schema.shifts).values(minimalShift).run();
    const [s] = db.select().from(schema.shifts).all();
    expect(s.userModified).toBe(false);
    expect(s.patternId).toBeNull();
  });

  it('cascades a job delete to all its rows', () => {
    seed(db);
    db.delete(schema.jobs).where(eq(schema.jobs.id, 'job-1')).run();
    expect(db.select().from(schema.premiumRules).all()).toEqual([]);
    expect(db.select().from(schema.shiftTemplates).all()).toEqual([]);
    expect(db.select().from(schema.rotaPatterns).all()).toEqual([]);
    expect(db.select().from(schema.shifts).all()).toEqual([]);
    expect(db.select().from(schema.payslips).all()).toEqual([]);
    expect(db.select().from(schema.payslipLines).all()).toEqual([]);
    expect(db.select().from(schema.settings).all()).toHaveLength(1);
  });

  it('enforces foreign keys', () => {
    expect(() => db.insert(schema.shifts).values(shift).run()).toThrow(/FOREIGN KEY/);
  });

  it('rejects a rule with both or neither of multiplier and flat add', () => {
    db.insert(schema.jobs).values(job).run();
    expect(() =>
      db
        .insert(schema.premiumRules)
        .values({ ...rule, id: 'both', multiplier: 1.5, flatAddPencePerHour: 125.5 })
        .run(),
    ).toThrow(/CHECK constraint/);
    expect(() =>
      db
        .insert(schema.premiumRules)
        .values({ ...rule, id: 'neither', multiplier: null, flatAddPencePerHour: null })
        .run(),
    ).toThrow(/CHECK constraint/);
    db.insert(schema.premiumRules)
      .values({ ...rule, id: 'flat', multiplier: null, flatAddPencePerHour: 125.5 })
      .run();
    const [r] = db
      .select()
      .from(schema.premiumRules)
      .where(eq(schema.premiumRules.id, 'flat'))
      .all();
    expect(r.flatAddPencePerHour).toBe(125.5);
  });
});
