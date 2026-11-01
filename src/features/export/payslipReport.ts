/**
 * Payslip-check export (SPEC §6, Pro): turns a period's breakdown and its
 * payslip check into CSV text or printable HTML the user can take to payroll.
 * Pure: no React/Expo, never reads the clock (`generatedAt` is passed in).
 * Money stays integer pence until it is formatted here, once, for output.
 */
import { DISCLAIMER } from '../../config/disclaimer';
import { formatPence } from '../../engine/money';
import type { PayslipCheckView } from '../../engine/payslipCheck';
import type { PeriodDetail, PeriodDetailLineKind } from '../../engine/periodList';
import { instantToLocal } from '../../engine/time';
import type { LocalDate, ShiftStatus } from '../../engine/types';

export interface PayslipReportInput {
  /** The user's own job name (never an employer name from the app). */
  jobName: string;
  period: { start: LocalDate; end: LocalDate };
  payDate: LocalDate;
  detail: PeriodDetail;
  check: PayslipCheckView;
  generatedAt: LocalDate;
}

export type PayslipReportExt = 'csv' | 'pdf';

export const REPORT_TITLE = 'ShiftPay payslip check';

const MINUS = '−';

const STATUS_LABEL: Record<ShiftStatus, string> = {
  planned: 'Planned',
  worked: 'Worked',
  sick: 'Sick',
  holiday: 'Holiday',
  cancelled: 'Cancelled',
};

const KIND_LABEL: Record<PeriodDetailLineKind, string> = {
  base: 'Base',
  premium: 'Premium',
  overtime: 'Overtime',
};

/** `shiftpay-payslip-check-2026-10-01.csv`. */
export function payslipReportFileName(periodStart: LocalDate, ext: PayslipReportExt): string {
  return `shiftpay-payslip-check-${periodStart}.${ext}`;
}

/** Integer pence as a plain decimal for numeric CSV columns: `123456` -> `1234.56`, `-1230` -> `-12.30`. */
export function penceToDecimal(pence: number): string {
  // formatPence validates integer pence; strip its £ and thousands separators.
  return formatPence(pence).replace('£', '').replace(/,/g, '');
}

/** Hours as a plain number without trailing zeros: `7.5`, `0.33`. */
function hoursNumber(hours: number): string {
  return String(Number(hours.toFixed(2)));
}

// ---------------------------------------------------------------- CSV

/** RFC 4180 field: quoted when it holds a comma, quote, CR or LF; quotes doubled. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** UTF-8 byte-order mark: makes Excel read the file as UTF-8 (£, —). */
export const CSV_BOM = '\uFEFF';

/**
 * Formula-injection guard for text cells (never the numeric money/hours
 * columns): a leading = + - @, tab or CR gets an apostrophe so a spreadsheet
 * shows the cell as text instead of evaluating it.
 */
export function csvText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvRow(fields: readonly string[]): string {
  return fields.map(csvField).join(',');
}

/**
 * The report as CSV: UTF-8 with a BOM, `\r\n` line endings, money as `1234.56`.
 * Text cells go through `csvText`; numeric cells are written as-is.
 */
export function buildPayslipCsv(input: PayslipReportInput): string {
  const { jobName, period, payDate, detail, check, generatedAt } = input;
  const rows: string[][] = [
    [REPORT_TITLE],
    ['Job', csvText(jobName)],
    ['Period start', period.start],
    ['Period end', period.end],
    ['Pay date', payDate],
    ['Generated', generatedAt],
    ['Status', csvText(check.chipLabel)],
    [],
    ['Summary', 'Amount (GBP)', 'Hours'],
    ['Expected', penceToDecimal(check.expectedPence), hoursNumber(check.expectedHours)],
    [
      'Paid',
      penceToDecimal(check.paidPence),
      check.paidHours === undefined ? '' : hoursNumber(check.paidHours),
    ],
    [
      'Difference',
      penceToDecimal(check.diffPence),
      check.diffHours === undefined ? '' : hoursNumber(check.diffHours),
    ],
    [],
    ['Breakdown', 'Type', 'Hours', 'Amount (GBP)'],
    ...detail.lines.map((l) => [
      csvText(l.label),
      KIND_LABEL[l.kind],
      hoursNumber(l.hours),
      penceToDecimal(l.pence),
    ]),
    ['Total', '', hoursNumber(detail.paidHours), penceToDecimal(detail.totalGrossPence)],
    [],
    ['Shifts'],
    ['Date', 'Start', 'End', 'Status', 'Paid hours', 'Amount (GBP)'],
    ...detail.shifts.map((s) => [
      s.date,
      instantToLocal(s.start).time,
      instantToLocal(s.end).time,
      STATUS_LABEL[s.status],
      hoursNumber(s.paidHours),
      penceToDecimal(s.totalGrossPence),
    ]),
    [],
    ['Likely causes'],
    ...check.causes.map((c) => [csvText(c)]),
    [],
    [csvText(DISCLAIMER)],
  ];
  return CSV_BOM + rows.map(csvRow).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- HTML

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for HTML element content and attribute values. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/** `120` -> `+£1.20`, `-1800` -> `−£18.00`, `0` -> `£0.00` (as the result card). */
function signedPence(pence: number): string {
  if (pence > 0) return `+${formatPence(pence)}`;
  if (pence < 0) return `${MINUS}${formatPence(-pence)}`;
  return formatPence(0);
}

/** `7.5` -> `7.5 h`. */
function hoursText(hours: number): string {
  return `${hoursNumber(hours)} h`;
}

/** `1.5` -> `+1.5 h`, `-2` -> `−2 h`, `0` -> `0 h`. */
function signedHours(hours: number): string {
  const text = hoursText(Math.abs(hours));
  if (text === hoursText(0)) return text;
  return `${hours > 0 ? '+' : MINUS}${text}`;
}

function cell(text: string, numeric = false): string {
  return numeric ? `<td class="num">${escapeHtml(text)}</td>` : `<td>${escapeHtml(text)}</td>`;
}

const CSS = `
@page { size: A4; margin: 16mm; }
* { box-sizing: border-box; }
body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 11pt; color: #1a1a1a; margin: 0; }
h1 { font-size: 18pt; margin: 0 0 4pt; }
h2 { font-size: 12pt; margin: 16pt 0 6pt; border-bottom: 1px solid #ccc; padding-bottom: 2pt; }
.meta { margin: 0 0 8pt; color: #444; }
.meta td { padding: 1pt 12pt 1pt 0; }
table { border-collapse: collapse; width: 100%; page-break-inside: auto; }
tr { page-break-inside: avoid; }
th, td { text-align: left; padding: 3pt 6pt; border-bottom: 1px solid #e3e3e3; vertical-align: top; }
th { font-weight: 600; background: #f4f4f4; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.total td { font-weight: 600; border-top: 1px solid #999; }
.chip { display: inline-block; padding: 2pt 8pt; border-radius: 10pt; font-weight: 600; border: 1px solid; }
.chip-positive { color: #1b6e3a; border-color: #1b6e3a; background: #e8f5ec; }
.chip-alert { color: #a3261c; border-color: #a3261c; background: #fbeae8; }
.chip-neutral { color: #444; border-color: #888; background: #f2f2f2; }
ul { margin: 0; padding-left: 16pt; }
.disclaimer { margin-top: 20pt; font-size: 9pt; color: #555; }
`;

/** The report as a self-contained, A4-friendly HTML document (for printing to PDF). */
export function buildPayslipHtml(input: PayslipReportInput): string {
  const { jobName, period, payDate, detail, check, generatedAt } = input;
  const hasHours = check.paidHours !== undefined && check.diffHours !== undefined;

  const summaryRows = [
    `<tr><td>Expected</td>${cell(formatPence(check.expectedPence), true)}${cell(hoursText(check.expectedHours), true)}</tr>`,
    `<tr><td>Paid</td>${cell(formatPence(check.paidPence), true)}${cell(hasHours ? hoursText(check.paidHours as number) : '', true)}</tr>`,
    `<tr class="total"><td>Difference</td>${cell(signedPence(check.diffPence), true)}${cell(hasHours ? signedHours(check.diffHours as number) : '', true)}</tr>`,
  ];

  const lineRows = detail.lines.map(
    (l) =>
      `<tr>${cell(l.label)}${cell(KIND_LABEL[l.kind])}${cell(hoursText(l.hours), true)}${cell(formatPence(l.pence), true)}</tr>`,
  );
  lineRows.push(
    `<tr class="total"><td>Total</td><td></td>${cell(hoursText(detail.paidHours), true)}${cell(formatPence(detail.totalGrossPence), true)}</tr>`,
  );

  const shiftRows = detail.shifts.map((s) => {
    const times = `${instantToLocal(s.start).time}–${instantToLocal(s.end).time}`;
    return `<tr>${cell(s.date)}${cell(times)}${cell(STATUS_LABEL[s.status])}${cell(hoursText(s.paidHours), true)}${cell(formatPence(s.totalGrossPence), true)}</tr>`;
  });

  const causes =
    check.causes.length === 0
      ? '<p>None.</p>'
      : `<ul>${check.causes.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`;

  return [
    '<!DOCTYPE html>',
    '<html lang="en-GB">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(`${REPORT_TITLE} — ${jobName}`)}</title>`,
    `<style>${CSS}</style>`,
    '</head>',
    '<body>',
    `<h1>${escapeHtml(REPORT_TITLE)}</h1>`,
    '<table class="meta"><tbody>',
    `<tr><td>Job</td>${cell(jobName)}</tr>`,
    `<tr><td>Period</td>${cell(`${period.start} to ${period.end}`)}</tr>`,
    `<tr><td>Pay date</td>${cell(payDate)}</tr>`,
    `<tr><td>Generated</td>${cell(generatedAt)}</tr>`,
    '</tbody></table>',
    `<p><span class="chip chip-${check.chipTone}">${escapeHtml(check.chipLabel)}</span></p>`,
    '<h2>Summary</h2>',
    '<table><thead><tr><th></th><th class="num">Amount</th><th class="num">Hours</th></tr></thead>',
    `<tbody>${summaryRows.join('')}</tbody></table>`,
    '<h2>Breakdown</h2>',
    '<table><thead><tr><th>Line</th><th>Type</th><th class="num">Hours</th><th class="num">Amount</th></tr></thead>',
    `<tbody>${lineRows.join('')}</tbody></table>`,
    '<h2>Shifts</h2>',
    '<table><thead><tr><th>Date</th><th>Time</th><th>Status</th><th class="num">Paid hours</th><th class="num">Amount</th></tr></thead>',
    `<tbody>${shiftRows.join('')}</tbody></table>`,
    '<h2>Likely causes</h2>',
    causes,
    `<p class="disclaimer">${escapeHtml(DISCLAIMER)}</p>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
