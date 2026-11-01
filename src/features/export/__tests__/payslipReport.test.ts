import { DISCLAIMER } from '../../../config/disclaimer';
import type { PayslipCheckView } from '../../../engine/payslipCheck';
import type { PeriodDetail } from '../../../engine/periodList';
import {
  buildPayslipCsv,
  buildPayslipHtml,
  CSV_BOM,
  csvField,
  csvText,
  escapeHtml,
  payslipReportFileName,
  penceToDecimal,
  type PayslipReportInput,
} from '../payslipReport';

const detail: PeriodDetail = {
  totalGrossPence: 123_456,
  paidHours: 37.5,
  payDate: '2026-12-05',
  lines: [
    { key: 'base', label: 'Base', kind: 'base', hours: 37.5, pence: 110_000 },
    { key: 'premium:n', label: 'Nights', kind: 'premium', hours: 8, pence: 8_456 },
    { key: 'overtime:o', label: 'Overtime', kind: 'overtime', hours: 2.5, pence: 5_000 },
  ],
  shifts: [
    {
      id: 's1',
      date: '2026-11-03',
      start: '2026-11-03T09:00:00.000Z',
      end: '2026-11-03T17:30:00.000Z',
      status: 'worked',
      // 8.5 h long with a 30 min unpaid break: paid 8 h.
      paidHours: 8,
      totalGrossPence: 9_350,
    },
    {
      id: 's2',
      date: '2026-11-04',
      start: '2026-11-04T22:00:00.000Z',
      end: '2026-11-05T06:00:00.000Z',
      status: 'cancelled',
      paidHours: 0,
      totalGrossPence: 0,
    },
  ],
};

const underpaid: PayslipCheckView = {
  status: 'underpaid',
  chipLabel: 'Underpaid by £1,230.50',
  chipTone: 'alert',
  expectedPence: 123_456,
  paidPence: 406,
  diffPence: -123_050,
  expectedHours: 37.5,
  paidHours: 35,
  diffHours: -2.5,
  causes: [
    'Payslip shows 2.5 hours fewer than your shifts',
    'Nights for 3 Nov not found on payslip?',
  ],
};

function input(over: Partial<PayslipReportInput> = {}): PayslipReportInput {
  return {
    jobName: 'Ward 7',
    period: { start: '2026-11-01', end: '2026-11-30' },
    payDate: '2026-12-05',
    detail,
    check: underpaid,
    generatedAt: '2026-12-06',
    ...over,
  };
}

/** Minimal RFC 4180 parser (after the BOM) for checking what a spreadsheet would read. */
function parseCsv(csv: string): string[][] {
  const text = csv.startsWith(CSV_BOM) ? csv.slice(CSV_BOM.length) : csv;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else {
      field += ch;
    }
  }
  return rows;
}

function rowStarting(rows: string[][], first: string): string[] {
  const row = rows.find((r) => r[0] === first);
  if (row === undefined) throw new Error(`no row ${first}`);
  return row;
}

describe('payslipReportFileName', () => {
  it('names csv and pdf files by period start', () => {
    expect(payslipReportFileName('2026-11-01', 'csv')).toBe(
      'shiftpay-payslip-check-2026-11-01.csv',
    );
    expect(payslipReportFileName('2026-11-01', 'pdf')).toBe(
      'shiftpay-payslip-check-2026-11-01.pdf',
    );
  });
});

describe('penceToDecimal', () => {
  it('formats integer pence as a plain decimal', () => {
    expect(penceToDecimal(123_456)).toBe('1234.56');
    expect(penceToDecimal(-1_230)).toBe('-12.30');
    expect(penceToDecimal(5)).toBe('0.05');
    expect(penceToDecimal(0)).toBe('0.00');
    expect(penceToDecimal(123_456_789)).toBe('1234567.89');
  });

  it('rejects non-integer pence', () => {
    expect(() => penceToDecimal(1.5)).toThrow(TypeError);
  });
});

describe('csvField', () => {
  it('leaves plain text alone and quotes commas, quotes and newlines', () => {
    expect(csvField('Ward 7')).toBe('Ward 7');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('a\nb')).toBe('"a\nb"');
    expect(csvField('a\rb')).toBe('"a\rb"');
  });
});

describe('csvText', () => {
  it('prefixes an apostrophe to text starting with = + - @, tab or CR', () => {
    expect(csvText('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(csvText('+44 123')).toBe("'+44 123");
    expect(csvText('-2+3')).toBe("'-2+3");
    expect(csvText('@cmd')).toBe("'@cmd");
    expect(csvText('\tx')).toBe("'\tx");
    expect(csvText('\rx')).toBe("'\rx");
  });

  it('leaves other text alone', () => {
    expect(csvText('Ward 7')).toBe('Ward 7');
    expect(csvText('a=b')).toBe('a=b');
    expect(csvText('')).toBe('');
  });
});

describe('buildPayslipCsv', () => {
  it('starts with a UTF-8 BOM, exactly once', () => {
    const csv = buildPayslipCsv(input());
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.indexOf(CSV_BOM, 1)).toBe(-1);
    expect(csv.slice(1).startsWith('ShiftPay payslip check\r\n')).toBe(true);
  });

  it('guards text cells against formula injection but not numeric cells', () => {
    const lines = [
      { key: 'premium:x', label: '@Nights', kind: 'premium' as const, hours: 1, pence: -500 },
    ];
    const check: PayslipCheckView = {
      ...underpaid,
      chipLabel: '+odd',
      causes: ['=HYPERLINK("x")'],
    };
    const rows = parseCsv(
      buildPayslipCsv(input({ jobName: '=1+1', detail: { ...detail, lines }, check })),
    );
    expect(rowStarting(rows, 'Job')).toEqual(['Job', "'=1+1"]);
    expect(rowStarting(rows, 'Status')).toEqual(['Status', "'+odd"]);
    expect(rowStarting(rows, "'@Nights")).toEqual(["'@Nights", 'Premium', '1', '-5.00']);
    expect(rowStarting(rows, 'Difference')).toEqual(['Difference', '-1230.50', '-2.5']);
    const at = rows.findIndex((r) => r[0] === 'Likely causes');
    expect(rows[at + 1]).toEqual(['\'=HYPERLINK("x")']);
  });

  it('uses CRLF line endings throughout, ending with one', () => {
    const csv = buildPayslipCsv(input());
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('quotes a job name with a comma, quote and newline so it round-trips', () => {
    const jobName = 'Ward 7, "Nights"\nBlock B';
    const csv = buildPayslipCsv(input({ jobName }));
    expect(csv).toContain('Job,"Ward 7, ""Nights""\nBlock B"\r\n');
    expect(rowStarting(parseCsv(csv), 'Job')).toEqual(['Job', jobName]);
  });

  it('writes header rows', () => {
    const rows = parseCsv(buildPayslipCsv(input()));
    expect(rows[0]).toEqual(['ShiftPay payslip check']);
    expect(rowStarting(rows, 'Period start')).toEqual(['Period start', '2026-11-01']);
    expect(rowStarting(rows, 'Period end')).toEqual(['Period end', '2026-11-30']);
    expect(rowStarting(rows, 'Pay date')).toEqual(['Pay date', '2026-12-05']);
    expect(rowStarting(rows, 'Generated')).toEqual(['Generated', '2026-12-06']);
    expect(rowStarting(rows, 'Status')).toEqual(['Status', 'Underpaid by £1,230.50']);
  });

  it('writes the summary with numeric money (no £) and a negative difference', () => {
    const rows = parseCsv(buildPayslipCsv(input()));
    expect(rowStarting(rows, 'Summary')).toEqual(['Summary', 'Amount (GBP)', 'Hours']);
    expect(rowStarting(rows, 'Expected')).toEqual(['Expected', '1234.56', '37.5']);
    expect(rowStarting(rows, 'Paid')).toEqual(['Paid', '4.06', '35']);
    expect(rowStarting(rows, 'Difference')).toEqual(['Difference', '-1230.50', '-2.5']);
    for (const r of [rowStarting(rows, 'Expected'), rowStarting(rows, 'Difference')]) {
      expect(Number.isNaN(Number(r[1]))).toBe(false);
    }
  });

  it('leaves the hours cells empty when the payslip has no hours', () => {
    const check: PayslipCheckView = { ...underpaid, paidHours: undefined, diffHours: undefined };
    const rows = parseCsv(buildPayslipCsv(input({ check })));
    expect(rowStarting(rows, 'Paid')).toEqual(['Paid', '4.06', '']);
    expect(rowStarting(rows, 'Difference')).toEqual(['Difference', '-1230.50', '']);
  });

  it('writes breakdown lines, total and shifts with London times', () => {
    const rows = parseCsv(buildPayslipCsv(input()));
    expect(rowStarting(rows, 'Breakdown')).toEqual(['Breakdown', 'Type', 'Hours', 'Amount (GBP)']);
    expect(rowStarting(rows, 'Base')).toEqual(['Base', 'Base', '37.5', '1100.00']);
    expect(rowStarting(rows, 'Nights')).toEqual(['Nights', 'Premium', '8', '84.56']);
    expect(rowStarting(rows, 'Overtime')).toEqual(['Overtime', 'Overtime', '2.5', '50.00']);
    expect(rowStarting(rows, 'Total')).toEqual(['Total', '', '37.5', '1234.56']);
    expect(rowStarting(rows, 'Date')).toEqual([
      'Date',
      'Start',
      'End',
      'Status',
      'Paid hours',
      'Amount (GBP)',
    ]);
    expect(rowStarting(rows, '2026-11-03')).toEqual([
      '2026-11-03',
      '09:00',
      '17:30',
      'Worked',
      '8',
      '93.50',
    ]);
    expect(rowStarting(rows, '2026-11-04')).toEqual([
      '2026-11-04',
      '22:00',
      '06:00',
      'Cancelled',
      '0',
      '0.00',
    ]);
  });

  it('writes the causes and ends with the disclaimer', () => {
    const rows = parseCsv(buildPayslipCsv(input()));
    const at = rows.findIndex((r) => r[0] === 'Likely causes');
    expect(rows[at + 1]).toEqual(['Payslip shows 2.5 hours fewer than your shifts']);
    expect(rows[at + 2]).toEqual(['Nights for 3 Nov not found on payslip?']);
    expect(rows[rows.length - 1]).toEqual([DISCLAIMER]);
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML-special characters', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;',
    );
  });
});

describe('buildPayslipHtml', () => {
  it('is a self-contained A4 document: inline CSS, no external resources, no scripts', () => {
    const html = buildPayslipHtml(input());
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('size: A4');
    expect(html).not.toMatch(/<link|<img|<script|@import|url\(|https?:/i);
  });

  it('escapes <script> and & in the job name and a rule name', () => {
    const jobName = '<script>alert(1)</script> & Co';
    const lines = [
      {
        key: 'premium:x',
        label: 'Nights & <b>Weekends</b>',
        kind: 'premium' as const,
        hours: 1,
        pence: 100,
      },
    ];
    const html = buildPayslipHtml(input({ jobName, detail: { ...detail, lines } }));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; Co');
    expect(html).toContain('Nights &amp; &lt;b&gt;Weekends&lt;/b&gt;');
  });

  it('contains header, totals with £, the status chip, causes and the disclaimer last', () => {
    const html = buildPayslipHtml(input());
    expect(html).toContain('<td>Ward 7</td>');
    expect(html).toContain('2026-11-01 to 2026-11-30');
    expect(html).toContain('<td>2026-12-05</td>');
    expect(html).toContain('<span class="chip chip-alert">Underpaid by £1,230.50</span>');
    expect(html).toContain('<td class="num">£1,234.56</td>');
    expect(html).toContain('<td class="num">£4.06</td>');
    expect(html).toContain('<td class="num">£1,100.00</td>');
    expect(html).toContain('<th class="num">Paid hours</th>');
    // Paid hours after the unpaid break, not the 8.5 h length; cancelled is 0 h.
    expect(html).toContain(
      '<td>09:00–17:30</td><td>Worked</td><td class="num">8 h</td><td class="num">£93.50</td>',
    );
    expect(html).toContain('<td>Cancelled</td><td class="num">0 h</td>');
    expect(html).toContain('<td>Cancelled</td>');
    expect(html).toContain('<li>Payslip shows 2.5 hours fewer than your shifts</li>');
    expect(html).toContain('<li>Nights for 3 Nov not found on payslip?</li>');
    const disclaimerAt = html.indexOf(DISCLAIMER);
    expect(disclaimerAt).toBeGreaterThan(html.indexOf('Likely causes'));
    expect(html.indexOf('</body>')).toBeGreaterThan(disclaimerAt);
  });

  it('formats a negative difference with a minus sign, and hours difference', () => {
    const html = buildPayslipHtml(input());
    expect(html).toContain('<td class="num">−£1,230.50</td>');
    expect(html).toContain('<td class="num">−2.5 h</td>');
    expect(html).toContain('<td class="num">35 h</td>');
  });

  it('formats a positive and a zero difference; no hours when the payslip has none', () => {
    const over: PayslipCheckView = {
      ...underpaid,
      status: 'overpaid',
      chipLabel: 'Overpaid by £1.20',
      chipTone: 'neutral',
      diffPence: 120,
      diffHours: 1.5,
    };
    const overHtml = buildPayslipHtml(input({ check: over }));
    expect(overHtml).toContain('<td class="num">+£1.20</td>');
    expect(overHtml).toContain('<td class="num">+1.5 h</td>');
    expect(overHtml).toContain('chip-neutral');

    const match: PayslipCheckView = {
      status: 'match',
      chipLabel: 'Match',
      chipTone: 'positive',
      expectedPence: 1000,
      paidPence: 1000,
      diffPence: 0,
      expectedHours: 8,
      causes: [],
    };
    const matchHtml = buildPayslipHtml(input({ check: match }));
    expect(matchHtml).toContain(
      '<tr class="total"><td>Difference</td><td class="num">£0.00</td><td class="num"></td></tr>',
    );
    expect(matchHtml).toContain('<p>None.</p>');

    const zeroHours = buildPayslipHtml(input({ check: { ...match, paidHours: 8, diffHours: 0 } }));
    expect(zeroHours).toContain('<td class="num">0 h</td>');
  });
});
