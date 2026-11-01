/**
 * Payslip-check export (SPEC §6, Pro): build the report as CSV or PDF, save it
 * in the cache directory under `payslipReportFileName` and open the share sheet
 * so the user can send it to payroll. The share functions talk only to the
 * `PayslipExportSharer` interface so they can be tested with fakes;
 * `expoPayslipExportSharer` is the one place that touches expo-file-system,
 * expo-print and expo-sharing. They never throw: every outcome is a result.
 */
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import {
  buildPayslipCsv,
  buildPayslipHtml,
  type PayslipReportInput,
  payslipReportFileName,
} from '../features/export/payslipReport';

export const CSV_MIME_TYPE = 'text/csv';
export const PDF_MIME_TYPE = 'application/pdf';
export const PAYSLIP_EXPORT_DIALOG_TITLE = 'Share your payslip check';

export interface PayslipExportSharer {
  /** True when this device can open a share sheet. */
  isAvailable(): Promise<boolean>;
  /** Writes UTF-8 `contents` to a cache file called `fileName` (replacing it) and returns its uri. */
  writeFile(fileName: string, contents: string): Promise<string>;
  /** Prints `html` to a PDF and returns its (randomly named) uri. */
  printToPdf(html: string): Promise<string>;
  /** Moves the file at `uri` to a cache file called `fileName` (replacing it) and returns the new uri. */
  moveFile(uri: string, fileName: string): Promise<string>;
  /** Opens the share sheet for the file at `uri`. */
  share(uri: string, mimeType: string): Promise<void>;
}

export type PayslipExportResult =
  | { status: 'shared'; uri: string }
  /** The share sheet can't open on this device; nothing was written. */
  | { status: 'unavailable' }
  /** Building, writing, printing or sharing failed. */
  | { status: 'failed' };

export const expoPayslipExportSharer: PayslipExportSharer = {
  isAvailable() {
    return Sharing.isAvailableAsync();
  },

  async writeFile(fileName, contents) {
    const file = new File(Paths.cache, fileName);
    await file.write(contents);
    return file.uri;
  },

  async printToPdf(html) {
    const { uri } = await Print.printToFileAsync({ html });
    return uri;
  },

  async moveFile(uri, fileName) {
    const file = new File(uri);
    await file.move(new File(Paths.cache, fileName), { overwrite: true });
    return file.uri;
  },

  async share(uri, mimeType) {
    await Sharing.shareAsync(uri, { mimeType, dialogTitle: PAYSLIP_EXPORT_DIALOG_TITLE });
  },
};

async function shareWith(
  sharer: PayslipExportSharer,
  makeFile: () => Promise<string>,
  mimeType: string,
): Promise<PayslipExportResult> {
  try {
    if (!(await sharer.isAvailable())) return { status: 'unavailable' };
    const uri = await makeFile();
    await sharer.share(uri, mimeType);
    return { status: 'shared', uri };
  } catch {
    return { status: 'failed' };
  }
}

/** Writes the CSV report to `shiftpay-payslip-check-<start>.csv` and shares it as `text/csv`. */
export function sharePayslipCsv(
  input: PayslipReportInput,
  sharer: PayslipExportSharer = expoPayslipExportSharer,
): Promise<PayslipExportResult> {
  return shareWith(
    sharer,
    () =>
      sharer.writeFile(payslipReportFileName(input.period.start, 'csv'), buildPayslipCsv(input)),
    CSV_MIME_TYPE,
  );
}

/** Prints the HTML report to PDF, renames it to `shiftpay-payslip-check-<start>.pdf` and shares it. */
export function sharePayslipPdf(
  input: PayslipReportInput,
  sharer: PayslipExportSharer = expoPayslipExportSharer,
): Promise<PayslipExportResult> {
  return shareWith(
    sharer,
    async () => {
      const printed = await sharer.printToPdf(buildPayslipHtml(input));
      return sharer.moveFile(printed, payslipReportFileName(input.period.start, 'pdf'));
    },
    PDF_MIME_TYPE,
  );
}
