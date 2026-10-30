/**
 * Payslips and their lines: typed CRUD mapping DB rows <-> engine types.
 * DB null <-> optional field absent; `lines` is omitted when none are stored.
 * Line ids are `${payslipId}:${index}`; writes with lines run in one
 * (synchronous) transaction.
 */
import { asc, desc, eq, inArray } from 'drizzle-orm';

import type { Payslip, PayslipLine } from '../engine/types';
import type { AppDb } from './jobRepo';
import { payslipLines, payslips } from './schema';

type PayslipRow = typeof payslips.$inferSelect;
type LineRow = typeof payslipLines.$inferSelect;

function payslipToRow(p: Payslip): PayslipRow {
  return {
    id: p.id,
    jobId: p.jobId,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    grossPaidPence: p.grossPaidPence,
    hoursPaid: p.hoursPaid ?? null,
    taxPence: p.taxPence,
    niPence: p.niPence,
    pensionPence: p.pensionPence,
    netPence: p.netPence ?? null,
  };
}

function linesToRows(p: Payslip): LineRow[] {
  return (p.lines ?? []).map((line, index) => ({
    id: `${p.id}:${index}`,
    payslipId: p.id,
    position: index,
    label: line.label,
    hours: line.hours ?? null,
    amountPence: line.amountPence,
  }));
}

function rowToLine(row: LineRow): PayslipLine {
  return row.hours === null
    ? { label: row.label, amountPence: row.amountPence }
    : { label: row.label, hours: row.hours, amountPence: row.amountPence };
}

function rowToPayslip(row: PayslipRow, lines: LineRow[]): Payslip {
  const { hoursPaid, netPence, ...rest } = row;
  const payslip: Payslip = { ...rest };
  if (hoursPaid !== null) payslip.hoursPaid = hoursPaid;
  if (netPence !== null) payslip.netPence = netPence;
  if (lines.length) payslip.lines = lines.map(rowToLine);
  return payslip;
}

/** Payslips for a job with their lines, newest periodEnd first, then id. */
export async function listPayslips(db: AppDb, jobId: string): Promise<Payslip[]> {
  const rows = await db
    .select()
    .from(payslips)
    .where(eq(payslips.jobId, jobId))
    .orderBy(desc(payslips.periodEnd), asc(payslips.id));
  if (rows.length === 0) return [];
  const lineRows = await db
    .select()
    .from(payslipLines)
    .where(
      inArray(
        payslipLines.payslipId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(payslipLines.position));
  const byPayslip = new Map<string, LineRow[]>();
  for (const line of lineRows) {
    const list = byPayslip.get(line.payslipId) ?? [];
    list.push(line);
    byPayslip.set(line.payslipId, list);
  }
  return rows.map((r) => rowToPayslip(r, byPayslip.get(r.id) ?? []));
}

/** The payslip with its lines ordered by position. */
export async function getPayslip(db: AppDb, id: string): Promise<Payslip | undefined> {
  const rows = await db.select().from(payslips).where(eq(payslips.id, id));
  if (rows.length === 0) return undefined;
  const lineRows = await db
    .select()
    .from(payslipLines)
    .where(eq(payslipLines.payslipId, id))
    .orderBy(asc(payslipLines.position));
  return rowToPayslip(rows[0], lineRows);
}

/** Inserts the payslip and its lines atomically. */
export async function createPayslip(db: AppDb, p: Payslip): Promise<void> {
  const row = payslipToRow(p);
  const lines = linesToRows(p);
  db.transaction((tx) => {
    tx.insert(payslips).values(row).run();
    if (lines.length) tx.insert(payslipLines).values(lines).run();
  });
}

/** Full replace by id, lines included; throws if no such payslip. */
export async function updatePayslip(db: AppDb, p: Payslip): Promise<void> {
  const { id, ...values } = payslipToRow(p);
  const lines = linesToRows(p);
  db.transaction((tx) => {
    const updated = tx
      .update(payslips)
      .set(values)
      .where(eq(payslips.id, id))
      .returning({ id: payslips.id })
      .all();
    if (updated.length === 0) throw new Error(`Payslip ${id} not found`);
    tx.delete(payslipLines).where(eq(payslipLines.payslipId, id)).run();
    if (lines.length) tx.insert(payslipLines).values(lines).run();
  });
}

/** Deletes the payslip; its lines cascade. */
export async function deletePayslip(db: AppDb, id: string): Promise<void> {
  await db.delete(payslips).where(eq(payslips.id, id));
}
