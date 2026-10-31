import {
  PAYSLIP_FORM_MESSAGES,
  PAYSLIP_HOURS_MAX,
  type PayslipFormValues,
  type PayslipLineFormValues,
  formToPayslip,
  linesTotalPence,
  newPayslipForm,
  payslipFormErrors,
  payslipToForm,
  suggestedNetPence,
} from '../payslipForm';
import type { Payslip } from '../types';

const IDS = { id: 'ps1', jobId: 'j1', periodStart: '2026-04-01', periodEnd: '2026-04-30' };

function form(overrides: Partial<PayslipFormValues> = {}): PayslipFormValues {
  return { ...newPayslipForm(), grossText: '1000', ...overrides };
}

function line(overrides: Partial<PayslipLineFormValues> = {}): PayslipLineFormValues {
  return { label: 'Basic', hoursText: '', amountText: '100', ...overrides };
}

function fields(values: PayslipFormValues): string[] {
  return payslipFormErrors(values).map((e) => e.field);
}

const MINIMAL: Payslip = {
  ...IDS,
  grossPaidPence: 123450,
  taxPence: 0,
  niPence: 0,
  pensionPence: 0,
};

const FULL: Payslip = {
  ...IDS,
  grossPaidPence: 234567,
  hoursPaid: 162.5,
  lines: [
    { label: 'Basic', hours: 150, amountPence: 180000 },
    { label: 'Night premium', hours: 12.5, amountPence: 4567 },
    { label: 'Overpayment adjustment', amountPence: -1205 },
    { label: 'Bonus', amountPence: 50000 },
  ],
  taxPence: -4321,
  niPence: 9876,
  pensionPence: 5,
  netPence: 210000,
};

describe('newPayslipForm', () => {
  it('is all empty with no lines', () => {
    expect(newPayslipForm()).toEqual({
      grossText: '',
      hoursText: '',
      taxText: '',
      niText: '',
      pensionText: '',
      netText: '',
      lines: [],
    });
  });
});

describe('payslipToForm', () => {
  it('writes plain pounds text without £ or commas, and blanks absent optionals', () => {
    expect(payslipToForm(MINIMAL)).toEqual({
      grossText: '1234.50',
      hoursText: '',
      taxText: '0.00',
      niText: '0.00',
      pensionText: '0.00',
      netText: '',
      lines: [],
    });
  });

  it('writes negative amounts, hours and lines', () => {
    expect(payslipToForm(FULL)).toEqual({
      grossText: '2345.67',
      hoursText: '162.5',
      taxText: '-43.21',
      niText: '98.76',
      pensionText: '0.05',
      netText: '2100.00',
      lines: [
        { label: 'Basic', hoursText: '150', amountText: '1800.00' },
        { label: 'Night premium', hoursText: '12.5', amountText: '45.67' },
        { label: 'Overpayment adjustment', hoursText: '', amountText: '-12.05' },
        { label: 'Bonus', hoursText: '', amountText: '500.00' },
      ],
    });
  });
});

describe('round-trip', () => {
  it.each([
    ['minimal', MINIMAL],
    ['full', FULL],
    ['net only', { ...MINIMAL, netPence: -500 }],
    ['hours only', { ...MINIMAL, hoursPaid: 0 }],
  ])('%s payslip survives form -> payslip exactly', (_name, p) => {
    expect(formToPayslip(payslipToForm(p), IDS)).toEqual(p);
    const back = formToPayslip(payslipToForm(p), IDS);
    expect(Object.keys(back).sort()).toEqual(Object.keys(p).sort());
  });

  it('omits hours on lines that have none', () => {
    const back = formToPayslip(payslipToForm(FULL), IDS);
    expect(back.lines?.[2]).not.toHaveProperty('hours');
  });
});

describe('payslipFormErrors', () => {
  it('accepts a minimal valid form', () => {
    expect(payslipFormErrors(form())).toEqual([]);
  });

  it.each(['', '  ', 'abc', '-1', '1.234'])('gross %p is an error', (grossText) => {
    expect(payslipFormErrors(form({ grossText }))).toEqual([
      { field: 'gross', message: PAYSLIP_FORM_MESSAGES.gross },
    ]);
  });

  it.each(['0', '£1,234.56', ' 12.3 '])('gross %p is accepted', (grossText) => {
    expect(fields(form({ grossText }))).toEqual([]);
  });

  it.each(['-1', 'abc', '1.', '1e2', String(PAYSLIP_HOURS_MAX + 0.5)])(
    'hours %p is an error',
    (hoursText) => {
      expect(payslipFormErrors(form({ hoursText }))).toEqual([
        { field: 'hours', message: PAYSLIP_FORM_MESSAGES.hours },
      ]);
    },
  );

  it.each(['', '0', '37.5', String(PAYSLIP_HOURS_MAX)])('hours %p is accepted', (hoursText) => {
    expect(fields(form({ hoursText }))).toEqual([]);
  });

  it('allows negative tax (refund) but not negative NI or pension', () => {
    expect(fields(form({ taxText: '-12.30' }))).toEqual([]);
    expect(fields(form({ niText: '-1' }))).toEqual(['ni']);
    expect(fields(form({ pensionText: '-1' }))).toEqual(['pension']);
  });

  it('reports malformed tax, NI and pension with their messages', () => {
    expect(payslipFormErrors(form({ taxText: '1.234', niText: 'x', pensionText: '£' }))).toEqual([
      { field: 'tax', message: PAYSLIP_FORM_MESSAGES.tax },
      { field: 'ni', message: PAYSLIP_FORM_MESSAGES.ni },
      { field: 'pension', message: PAYSLIP_FORM_MESSAGES.pension },
    ]);
  });

  it('allows net blank or of any sign, rejects malformed net', () => {
    expect(fields(form({ netText: '' }))).toEqual([]);
    expect(fields(form({ netText: '-5.00' }))).toEqual([]);
    expect(payslipFormErrors(form({ netText: '1,23' }))).toEqual([
      { field: 'net', message: PAYSLIP_FORM_MESSAGES.net },
    ]);
  });

  it('ignores lines with every field blank', () => {
    const values = form({ lines: [line({ label: ' ', hoursText: '', amountText: '  ' })] });
    expect(payslipFormErrors(values)).toEqual([]);
  });

  it('reports line errors with the original line index', () => {
    const values = form({
      lines: [
        line({ label: '', hoursText: '', amountText: '' }),
        line({ label: '  ', hoursText: '2', amountText: '' }),
        line({ hoursText: '745', amountText: '-1.234' }),
      ],
    });
    expect(payslipFormErrors(values)).toEqual([
      { field: 'lineLabel', message: PAYSLIP_FORM_MESSAGES.lineLabel, lineIndex: 1 },
      { field: 'lineAmount', message: PAYSLIP_FORM_MESSAGES.lineAmount, lineIndex: 1 },
      { field: 'lineHours', message: PAYSLIP_FORM_MESSAGES.lineHours, lineIndex: 2 },
      { field: 'lineAmount', message: PAYSLIP_FORM_MESSAGES.lineAmount, lineIndex: 2 },
    ]);
  });

  it('accepts a line with only a label and amount, and negative amounts', () => {
    expect(fields(form({ lines: [line({ amountText: '-£1,000.00' })] }))).toEqual([]);
  });

  it('flags a line with only hours as missing label and amount', () => {
    expect(fields(form({ lines: [line({ label: '', hoursText: '3', amountText: '' })] }))).toEqual([
      'lineLabel',
      'lineAmount',
    ]);
  });
});

describe('formToPayslip', () => {
  it('treats blank tax, NI and pension as 0 and omits blank optionals', () => {
    expect(formToPayslip(form({ grossText: '£1,234.56' }), IDS)).toEqual({
      ...IDS,
      grossPaidPence: 123456,
      taxPence: 0,
      niPence: 0,
      pensionPence: 0,
    });
  });

  it('trims labels and drops all-blank lines', () => {
    const p = formToPayslip(
      form({
        lines: [
          line({ label: '', amountText: '' }),
          line({ label: '  Basic  ', hoursText: ' 7.5 ', amountText: '90' }),
        ],
      }),
      IDS,
    );
    expect(p.lines).toEqual([{ label: 'Basic', hours: 7.5, amountPence: 9000 }]);
  });

  it('omits lines when every line is blank', () => {
    const p = formToPayslip(form({ lines: [line({ label: '', amountText: '' })] }), IDS);
    expect(p).not.toHaveProperty('lines');
  });

  it('throws listing the fields in error', () => {
    expect(() => formToPayslip(form({ grossText: '', niText: '-1' }), IDS)).toThrow(
      'Invalid payslip form: gross, ni',
    );
  });
});

describe('linesTotalPence', () => {
  it('is null with no lines or only blank lines', () => {
    expect(linesTotalPence(form())).toBeNull();
    expect(linesTotalPence(form({ lines: [line({ label: '', amountText: '' })] }))).toBeNull();
  });

  it('sums non-blank line amounts, including negatives', () => {
    const values = form({
      lines: [
        line({ amountText: '1,000.10' }),
        line({ label: '', amountText: '' }),
        line({ amountText: '-0.15' }),
      ],
    });
    expect(linesTotalPence(values)).toBe(99995);
  });

  it('is null when any non-blank line amount is invalid', () => {
    expect(linesTotalPence(form({ lines: [line(), line({ amountText: '' })] }))).toBeNull();
  });
});

describe('suggestedNetPence', () => {
  it('is gross - tax - NI - pension, blanks counting as 0', () => {
    expect(suggestedNetPence(form({ grossText: '2000' }))).toBe(200000);
    expect(
      suggestedNetPence(
        form({ grossText: '2000', taxText: '-10', niText: '150.50', pensionText: '60' }),
      ),
    ).toBe(200000 + 1000 - 15050 - 6000);
  });

  it.each([
    { grossText: '' },
    { taxText: 'x' },
    { niText: '-1' },
    { pensionText: '1.001' },
  ])('is null when inputs are invalid: %p', (overrides) => {
    expect(suggestedNetPence(form(overrides))).toBeNull();
  });
});
