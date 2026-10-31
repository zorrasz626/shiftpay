/**
 * Payslip entry form <-> Payslip (SPEC §6, task 4.2).
 * Pure: no React, DB or clock.
 *
 * Text inputs stay strings in the form. Money is parsed to integer pence with
 * `parsePoundsToPence` (string arithmetic, no float drift); hours are decimals
 * (D3). Optional fields left blank are omitted from the Payslip so a stored
 * payslip round-trips exactly through the form.
 */
import { parsePoundsToPence } from './money';
import type { LocalDate, Payslip, PayslipLine } from './types';

export interface PayslipLineFormValues {
  label: string;
  hoursText: string;
  amountText: string;
}

export interface PayslipFormValues {
  grossText: string;
  hoursText: string;
  taxText: string;
  niText: string;
  pensionText: string;
  netText: string;
  lines: PayslipLineFormValues[];
}

export type PayslipFormField =
  | 'gross'
  | 'hours'
  | 'tax'
  | 'ni'
  | 'pension'
  | 'net'
  | 'lineLabel'
  | 'lineHours'
  | 'lineAmount';

export interface PayslipFormError {
  field: PayslipFormField;
  message: string;
  /** Index into `values.lines` for line errors. */
  lineIndex?: number;
}

export interface PayslipIds {
  id: string;
  jobId: string;
  periodStart: LocalDate;
  periodEnd: LocalDate;
}

/** Most hours in one pay period: a 31-day month. */
export const PAYSLIP_HOURS_MAX = 744;

export const PAYSLIP_FORM_MESSAGES = {
  gross: 'Enter the gross pay in £, 0 or more, with up to 2 decimal places',
  hours: `Enter hours from 0 up to ${PAYSLIP_HOURS_MAX}, e.g. 37.5`,
  tax: 'Enter tax in £ with up to 2 decimal places (use a minus for a refund)',
  ni: 'Enter National Insurance in £, 0 or more, with up to 2 decimal places',
  pension: 'Enter pension in £, 0 or more, with up to 2 decimal places',
  net: 'Enter net pay in £ with up to 2 decimal places',
  lineLabel: 'Enter a label',
  lineHours: `Enter hours from 0 up to ${PAYSLIP_HOURS_MAX}, e.g. 7.5`,
  lineAmount: 'Enter an amount in £ with up to 2 decimal places',
} as const;

const DECIMAL_RE = /^\d+(\.\d+)?$/;

/** Empty form for a new payslip. */
export function newPayslipForm(): PayslipFormValues {
  return {
    grossText: '',
    hoursText: '',
    taxText: '',
    niText: '',
    pensionText: '',
    netText: '',
    lines: [],
  };
}

/** Integer pence -> plain pounds text, no £ or commas ("1234.50", "-12.00"). */
function penceToPoundsText(pence: number): string {
  const sign = pence < 0 ? '-' : '';
  const abs = Math.abs(pence);
  const pounds = Math.floor(abs / 100);
  const rest = abs % 100;
  return `${sign}${pounds}.${rest < 10 ? '0' : ''}${rest}`;
}

function optionalHoursText(hours: number | undefined): string {
  return hours === undefined ? '' : String(hours);
}

/** Existing payslip -> form. */
export function payslipToForm(p: Payslip): PayslipFormValues {
  return {
    grossText: penceToPoundsText(p.grossPaidPence),
    hoursText: optionalHoursText(p.hoursPaid),
    taxText: penceToPoundsText(p.taxPence),
    niText: penceToPoundsText(p.niPence),
    pensionText: penceToPoundsText(p.pensionPence),
    netText: p.netPence === undefined ? '' : penceToPoundsText(p.netPence),
    lines: (p.lines ?? []).map((line) => ({
      label: line.label,
      hoursText: optionalHoursText(line.hours),
      amountText: penceToPoundsText(line.amountPence),
    })),
  };
}

function isBlank(text: string): boolean {
  return text.trim() === '';
}

function isBlankLine(line: PayslipLineFormValues): boolean {
  return isBlank(line.label) && isBlank(line.hoursText) && isBlank(line.amountText);
}

/** Blank -> undefined; decimal hours 0..max -> number; anything else -> null. */
function parseOptionalHours(text: string): number | undefined | null {
  const t = text.trim();
  if (t === '') return undefined;
  if (!DECIMAL_RE.test(t)) return null;
  const n = Number(t);
  return n <= PAYSLIP_HOURS_MAX ? n : null;
}

/** Money that may be blank (treated as 0); null if malformed, or negative when not allowed. */
function parseBlankAsZero(text: string, allowNegative: boolean): number | null {
  if (isBlank(text)) return 0;
  const p = parsePoundsToPence(text);
  if (p === null || (!allowNegative && p < 0)) return null;
  return p;
}

function parseGross(text: string): number | null {
  const p = parsePoundsToPence(text);
  return p === null || p < 0 ? null : p;
}

/** Non-blank lines, keeping their original index for error reporting. */
function nonBlankLines(values: PayslipFormValues): { line: PayslipLineFormValues; index: number }[] {
  return values.lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => !isBlankLine(line));
}

/** Field errors for the form; empty when it can be saved. All-blank lines are ignored. */
export function payslipFormErrors(values: PayslipFormValues): PayslipFormError[] {
  const errors: PayslipFormError[] = [];
  if (parseGross(values.grossText) === null) {
    errors.push({ field: 'gross', message: PAYSLIP_FORM_MESSAGES.gross });
  }
  if (parseOptionalHours(values.hoursText) === null) {
    errors.push({ field: 'hours', message: PAYSLIP_FORM_MESSAGES.hours });
  }
  if (parseBlankAsZero(values.taxText, true) === null) {
    errors.push({ field: 'tax', message: PAYSLIP_FORM_MESSAGES.tax });
  }
  if (parseBlankAsZero(values.niText, false) === null) {
    errors.push({ field: 'ni', message: PAYSLIP_FORM_MESSAGES.ni });
  }
  if (parseBlankAsZero(values.pensionText, false) === null) {
    errors.push({ field: 'pension', message: PAYSLIP_FORM_MESSAGES.pension });
  }
  if (!isBlank(values.netText) && parsePoundsToPence(values.netText) === null) {
    errors.push({ field: 'net', message: PAYSLIP_FORM_MESSAGES.net });
  }
  for (const { line, index } of nonBlankLines(values)) {
    if (isBlank(line.label)) {
      errors.push({ field: 'lineLabel', message: PAYSLIP_FORM_MESSAGES.lineLabel, lineIndex: index });
    }
    if (parseOptionalHours(line.hoursText) === null) {
      errors.push({ field: 'lineHours', message: PAYSLIP_FORM_MESSAGES.lineHours, lineIndex: index });
    }
    if (parsePoundsToPence(line.amountText) === null) {
      errors.push({
        field: 'lineAmount',
        message: PAYSLIP_FORM_MESSAGES.lineAmount,
        lineIndex: index,
      });
    }
  }
  return errors;
}

/** Valid form -> Payslip. Throws if `payslipFormErrors(values)` is not empty. */
export function formToPayslip(values: PayslipFormValues, ids: PayslipIds): Payslip {
  const errors = payslipFormErrors(values);
  if (errors.length > 0) {
    throw new Error(`Invalid payslip form: ${errors.map((e) => e.field).join(', ')}`);
  }
  const payslip: Payslip = {
    id: ids.id,
    jobId: ids.jobId,
    periodStart: ids.periodStart,
    periodEnd: ids.periodEnd,
    grossPaidPence: parseGross(values.grossText) as number,
    taxPence: parseBlankAsZero(values.taxText, true) as number,
    niPence: parseBlankAsZero(values.niText, false) as number,
    pensionPence: parseBlankAsZero(values.pensionText, false) as number,
  };
  const hours = parseOptionalHours(values.hoursText);
  if (hours !== undefined) {
    payslip.hoursPaid = hours as number;
  }
  if (!isBlank(values.netText)) {
    payslip.netPence = parsePoundsToPence(values.netText) as number;
  }
  const lines: PayslipLine[] = nonBlankLines(values).map(({ line }) => {
    const out: PayslipLine = {
      label: line.label.trim(),
      amountPence: parsePoundsToPence(line.amountText) as number,
    };
    const lineHours = parseOptionalHours(line.hoursText);
    if (lineHours !== undefined) {
      out.hours = lineHours as number;
    }
    return out;
  });
  if (lines.length > 0) {
    payslip.lines = lines;
  }
  return payslip;
}

/**
 * Sum of the amounts on non-blank lines, in pence, for the screen's hint.
 * Null when there are no non-blank lines or any of their amounts is invalid.
 */
export function linesTotalPence(values: PayslipFormValues): number | null {
  const lines = nonBlankLines(values);
  if (lines.length === 0) return null;
  let total = 0;
  for (const { line } of lines) {
    const amount = parsePoundsToPence(line.amountText);
    if (amount === null) return null;
    total += amount;
  }
  return total;
}

/**
 * Gross − tax − NI − pension, in pence, for the screen's net hint.
 * Blank deductions count as 0. Null when any of those four fields is invalid.
 */
export function suggestedNetPence(values: PayslipFormValues): number | null {
  const gross = parseGross(values.grossText);
  const tax = parseBlankAsZero(values.taxText, true);
  const ni = parseBlankAsZero(values.niText, false);
  const pension = parseBlankAsZero(values.pensionText, false);
  if (gross === null || tax === null || ni === null || pension === null) return null;
  return gross - tax - ni - pension;
}
