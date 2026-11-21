/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const MIGRATIONS = path.resolve(__dirname, '../../../drizzle');

interface JournalEntry {
  idx: number;
  tag: string;
}

/** A copy of `drizzle/` holding only the first `count` migrations. */
function migrationsUpTo(count: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiftpay-migrations-'));
  fs.mkdirSync(path.join(dir, 'meta'));
  const journal = JSON.parse(
    fs.readFileSync(path.join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: JournalEntry[] };
  const entries = journal.entries.filter((e) => e.idx < count);
  for (const e of entries) {
    fs.copyFileSync(path.join(MIGRATIONS, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  }
  fs.writeFileSync(
    path.join(dir, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries }),
  );
  return dir;
}

describe('migration 0002: shifts.pattern_id foreign key', () => {
  let tmp: string;

  beforeAll(() => {
    tmp = migrationsUpTo(2);
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('keeps every shift, nulls dangling pattern ids and adds the FK and index', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: tmp });

    sqlite.exec(`
      INSERT INTO jobs (id, name, base_rate_pence, pay_frequency, pay_period_anchor_date,
        pay_day_offset_days, period_cutoff_day, contracted_hours_per_week, bank_holiday_region,
        holiday_year_start, holiday_entitlement_hours)
      VALUES ('job-1', 'Job', 1200, 'monthly', '2026-04-01', 0, 31, 37.5, 'england-and-wales',
        '2026-04-01', 210);
      INSERT INTO rota_patterns (id, job_id, cycle_length_days, start_date, days)
      VALUES ('pat-1', 'job-1', 1, '2026-01-01', '["OFF"]');
    `);
    const insertShift = sqlite.prepare(`
      INSERT INTO shifts (id, job_id, date, start, end, unpaid_break_minutes, source, status,
        overtime_flag, notes, pattern_id, user_modified)
      VALUES (?, 'job-1', ?, ?, ?, 30, ?, 'worked', 0, ?, ?, ?)`);
    insertShift.run('pat-1:2026-03-01', '2026-03-01', '2026-03-01T08:00:00.000Z', '2026-03-01T16:00:00.000Z', 'pattern', 'kept', 'pat-1', 0);
    insertShift.run('gone:2026-03-02', '2026-03-02', '2026-03-02T08:00:00.000Z', '2026-03-02T16:00:00.000Z', 'pattern', null, 'pat-gone', 1);
    insertShift.run('m-1', '2026-03-03', '2026-03-03T08:00:00.000Z', '2026-03-03T16:00:00.000Z', 'manual', 'by hand', null, 0);
    const selectAll = 'SELECT * FROM shifts ORDER BY id';
    const before = sqlite.prepare(selectAll).all() as Record<string, unknown>[];

    migrate(db, { migrationsFolder: MIGRATIONS });

    const after = sqlite.prepare(selectAll).all() as Record<string, unknown>[];
    expect(after).toEqual(
      before.map((row) => (row.pattern_id === 'pat-gone' ? { ...row, pattern_id: null } : row)),
    );
    expect(after.map((r) => r.pattern_id)).toEqual([null, null, 'pat-1']);
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);

    const indexes = (sqlite.pragma('index_list(shifts)') as { name: string }[]).map((i) => i.name);
    expect(indexes).toEqual(
      expect.arrayContaining(['shifts_date_idx', 'shifts_job_id_date_idx', 'shifts_pattern_id_idx']),
    );
    const fks = sqlite.pragma('foreign_key_list(shifts)') as { from: string; table: string; on_delete: string }[];
    expect(fks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'pattern_id', table: 'rota_patterns', on_delete: 'SET NULL' }),
        expect.objectContaining({ from: 'job_id', table: 'jobs', on_delete: 'CASCADE' }),
      ]),
    );

    // The FK is live: deleting the pattern nulls its shift, the shift stays.
    sqlite.exec(`DELETE FROM rota_patterns WHERE id = 'pat-1'`);
    const kept = sqlite.prepare(`SELECT pattern_id FROM shifts WHERE id = 'pat-1:2026-03-01'`).get();
    expect(kept).toEqual({ pattern_id: null });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM shifts').get()).toEqual({ n: 3 });
  });
});
