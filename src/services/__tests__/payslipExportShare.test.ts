import { File } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import type { PayslipCheckView } from '../../engine/payslipCheck';
import type { PeriodDetail } from '../../engine/periodList';
import {
  buildPayslipCsv,
  buildPayslipHtml,
  type PayslipReportInput,
} from '../../features/export/payslipReport';
import {
  CSV_MIME_TYPE,
  expoPayslipExportSharer,
  PAYSLIP_EXPORT_DIALOG_TITLE,
  PDF_MIME_TYPE,
  type PayslipExportSharer,
  sharePayslipCsv,
  sharePayslipPdf,
} from '../payslipExportShare';

const mockWrite = jest.fn(async (_contents: string) => {});
const mockMove = jest.fn();
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  File: jest.fn().mockImplementation(function (
    this: { uri: string },
    dirOrUri: { uri: string } | string,
    name?: string,
  ) {
    const file = {
      uri: typeof dirOrUri === 'string' ? dirOrUri : `${dirOrUri.uri}${name}`,
      write: (contents: string) => mockWrite(contents),
      move: async (dest: { uri: string }, options: unknown) => {
        mockMove(file.uri, dest.uri, options);
        file.uri = dest.uri;
      },
    };
    return file;
  }),
}));
jest.mock('expo-print', () => ({
  printToFileAsync: jest.fn(async () => ({ uri: 'file:///cache/Print/abc123.pdf' })),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => {}),
}));

const mockedSharing = Sharing as jest.Mocked<typeof Sharing>;
const mockedPrint = Print as jest.Mocked<typeof Print>;

const detail: PeriodDetail = {
  totalGrossPence: 10_000,
  paidHours: 8,
  payDate: '2026-12-05',
  lines: [{ key: 'base', label: 'Base', kind: 'base', hours: 8, pence: 10_000 }],
  shifts: [],
};

const check: PayslipCheckView = {
  status: 'match',
  chipLabel: 'Matches',
  chipTone: 'positive',
  expectedPence: 10_000,
  paidPence: 10_000,
  diffPence: 0,
  expectedHours: 8,
  paidHours: 8,
  diffHours: 0,
  causes: [],
};

const input: PayslipReportInput = {
  jobName: 'Ward 7',
  period: { start: '2026-11-01', end: '2026-11-30' },
  payDate: '2026-12-05',
  detail,
  check,
  generatedAt: '2026-12-06',
};

function fakeSharer(over: Partial<PayslipExportSharer> = {}): jest.Mocked<PayslipExportSharer> {
  return {
    isAvailable: jest.fn(async () => true),
    writeFile: jest.fn(async (name: string) => `file:///cache/${name}`),
    printToPdf: jest.fn(async () => 'file:///cache/Print/tmp.pdf'),
    moveFile: jest.fn(async (_uri: string, name: string) => `file:///cache/${name}`),
    share: jest.fn(async () => {}),
    ...over,
  } as jest.Mocked<PayslipExportSharer>;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('sharePayslipCsv', () => {
  it('writes the CSV under the report file name, then shares it as text/csv', async () => {
    const sharer = fakeSharer();
    const result = await sharePayslipCsv(input, sharer);

    const uri = 'file:///cache/shiftpay-payslip-check-2026-11-01.csv';
    expect(sharer.writeFile).toHaveBeenCalledWith(
      'shiftpay-payslip-check-2026-11-01.csv',
      buildPayslipCsv(input),
    );
    expect(sharer.share).toHaveBeenCalledWith(uri, 'text/csv');
    expect(CSV_MIME_TYPE).toBe('text/csv');
    expect(sharer.printToPdf).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'shared', uri });
  });

  it('returns unavailable without writing when the share sheet cannot open', async () => {
    const sharer = fakeSharer({ isAvailable: jest.fn(async () => false) });
    await expect(sharePayslipCsv(input, sharer)).resolves.toEqual({ status: 'unavailable' });
    expect(sharer.writeFile).not.toHaveBeenCalled();
    expect(sharer.share).not.toHaveBeenCalled();
  });

  it('returns failed instead of throwing when writing fails', async () => {
    const sharer = fakeSharer({
      writeFile: jest.fn(async () => Promise.reject(new Error('disk'))),
    });
    await expect(sharePayslipCsv(input, sharer)).resolves.toEqual({ status: 'failed' });
    expect(sharer.share).not.toHaveBeenCalled();
  });

  it('returns failed instead of throwing when sharing fails', async () => {
    const sharer = fakeSharer({ share: jest.fn(async () => Promise.reject(new Error('x'))) });
    await expect(sharePayslipCsv(input, sharer)).resolves.toEqual({ status: 'failed' });
  });
});

describe('sharePayslipPdf', () => {
  it('prints the HTML, renames the PDF to the report file name, then shares it', async () => {
    const sharer = fakeSharer();
    const result = await sharePayslipPdf(input, sharer);

    const uri = 'file:///cache/shiftpay-payslip-check-2026-11-01.pdf';
    expect(sharer.printToPdf).toHaveBeenCalledWith(buildPayslipHtml(input));
    expect(sharer.moveFile).toHaveBeenCalledWith(
      'file:///cache/Print/tmp.pdf',
      'shiftpay-payslip-check-2026-11-01.pdf',
    );
    expect(sharer.share).toHaveBeenCalledWith(uri, 'application/pdf');
    expect(PDF_MIME_TYPE).toBe('application/pdf');
    expect(sharer.writeFile).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'shared', uri });
  });

  it('returns unavailable without printing when the share sheet cannot open', async () => {
    const sharer = fakeSharer({ isAvailable: jest.fn(async () => false) });
    await expect(sharePayslipPdf(input, sharer)).resolves.toEqual({ status: 'unavailable' });
    expect(sharer.printToPdf).not.toHaveBeenCalled();
  });

  it('returns failed instead of throwing when printing fails', async () => {
    const sharer = fakeSharer({
      printToPdf: jest.fn(async () => Promise.reject(new Error('print'))),
    });
    await expect(sharePayslipPdf(input, sharer)).resolves.toEqual({ status: 'failed' });
    expect(sharer.moveFile).not.toHaveBeenCalled();
    expect(sharer.share).not.toHaveBeenCalled();
  });
});

describe('expoPayslipExportSharer (default)', () => {
  it('writes the CSV to the cache directory with expo-file-system and shares it', async () => {
    const result = await sharePayslipCsv(input);

    const uri = 'file:///cache/shiftpay-payslip-check-2026-11-01.csv';
    expect(File).toHaveBeenCalledWith(
      { uri: 'file:///cache/' },
      'shiftpay-payslip-check-2026-11-01.csv',
    );
    expect(mockWrite).toHaveBeenCalledWith(buildPayslipCsv(input));
    expect(mockedSharing.shareAsync).toHaveBeenCalledWith(uri, {
      mimeType: 'text/csv',
      dialogTitle: PAYSLIP_EXPORT_DIALOG_TITLE,
    });
    expect(result).toEqual({ status: 'shared', uri });
  });

  it('prints with expo-print, moves the PDF into the cache under the report name and shares it', async () => {
    const result = await sharePayslipPdf(input);

    const uri = 'file:///cache/shiftpay-payslip-check-2026-11-01.pdf';
    expect(mockedPrint.printToFileAsync).toHaveBeenCalledWith({ html: buildPayslipHtml(input) });
    expect(mockMove).toHaveBeenCalledWith('file:///cache/Print/abc123.pdf', uri, {
      overwrite: true,
    });
    expect(mockedSharing.shareAsync).toHaveBeenCalledWith(uri, {
      mimeType: 'application/pdf',
      dialogTitle: PAYSLIP_EXPORT_DIALOG_TITLE,
    });
    expect(result).toEqual({ status: 'shared', uri });
  });

  it('reports unavailable when expo-sharing says the share sheet cannot open', async () => {
    mockedSharing.isAvailableAsync.mockResolvedValueOnce(false);
    await expect(expoPayslipExportSharer.isAvailable()).resolves.toBe(false);
  });
});
