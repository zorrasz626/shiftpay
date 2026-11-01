import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import PayslipScreen from '../../app/payslip/[start]';
import { db } from '../db/client';
import { createJob, deleteJob } from '../db/jobRepo';
import { createPayslip, getPayslip } from '../db/payslipRepo';
import { PAYSLIP_FORM_MESSAGES } from '../engine/payslipForm';
import type { Payslip } from '../engine/types';
import { useProStore } from '../features/pro/proStore';
import { sharePayslipCsv, sharePayslipPdf } from '../services/payslipExportShare';
import { useJobsStore } from '../store/jobsStore';
import { usePayslipsStore } from '../store/payslipsStore';
import { useShiftsStore } from '../store/shiftsStore';
import { job, resetStores } from '../store/testFixtures';

jest.mock('../db/client', () => ({ db: require('../db/testDb').createTestDb() }));
jest.mock('../services/payslipExportShare', () => ({
  sharePayslipCsv: jest.fn(),
  sharePayslipPdf: jest.fn(),
}));
const mockCsv = sharePayslipCsv as jest.MockedFunction<typeof sharePayslipCsv>;
const mockPdf = sharePayslipPdf as jest.MockedFunction<typeof sharePayslipPdf>;
const mockPush = jest.fn();
const mockBack = jest.fn();
let mockStart = '2026-06-15';
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => ({ start: mockStart }),
}));
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

// Weekly periods Mon–Sun; loaded range 1–30 Jun holds 15–21 Jun in full.
const range = { start: '2026-06-01', end: '2026-06-30' };

const existing: Payslip = {
  id: 'ps-1',
  jobId: job.id,
  periodStart: '2026-06-15',
  periodEnd: '2026-06-21',
  grossPaidPence: 50000,
  hoursPaid: 40,
  lines: [
    { label: 'Basic pay', hours: 37.5, amountPence: 46875 },
    { label: 'Overtime', amountPence: 3125 },
  ],
  taxPence: 4560,
  niPence: 1200,
  pensionPence: 1500,
  netPence: 42740,
};

async function seed(payslips: Payslip[] = []): Promise<void> {
  await createJob(db, job);
  for (const p of payslips) await createPayslip(db, p);
  await useJobsStore.getState().load(db);
  await usePayslipsStore.getState().load(db);
  useShiftsStore.setState({ shifts: [], range, loaded: true });
}

const button = (name: string) => screen.getByRole('button', { name });
const field = (label: string, index = 0) => screen.getAllByLabelText(label)[index];
const stored = () => usePayslipsStore.getState().payslips;
const allMessages = Object.values(PAYSLIP_FORM_MESSAGES);
const shownMessages = () => allMessages.filter((m) => screen.queryAllByText(m).length > 0);
type StyleProps = { props: { style?: unknown } };
const styleOf = (el: StyleProps): Record<string, unknown> =>
  (StyleSheet.flatten(el.props.style as never) as Record<string, unknown> | undefined) ?? {};

beforeEach(async () => {
  resetStores();
  await deleteJob(db, job.id);
  mockPush.mockClear();
  mockBack.mockClear();
  mockCsv.mockReset();
  mockPdf.mockReset();
  mockStart = '2026-06-15';
  useProStore.setState({ status: 'free', source: 'unconfigured' });
});

describe('Payslip screen', () => {
  beforeEach(() => {
    useProStore.setState({ status: 'pro', source: 'revenuecat' });
  });

  it('enters a new payslip with two lines and stores exact pence', async () => {
    await seed();
    await render(<PayslipScreen />);

    expect(screen.getByRole('header', { name: 'Payslip' })).toBeTruthy();
    expect(screen.getByText('15 Jun – 21 Jun')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete payslip' })).toBeNull();
    expect(screen.getByText(/Estimates only/)).toBeTruthy();
    expect(shownMessages()).toEqual([]);
    expect(field('Gross pay (£)').props.keyboardType).toBe('decimal-pad');
    expect(field('Hours paid (optional)').props.keyboardType).toBe('decimal-pad');
    expect(field('Tax (£)').props.keyboardType).toBe('numeric');
    expect(field('National Insurance (£)').props.keyboardType).toBe('decimal-pad');
    expect(field('Pension (£)').props.keyboardType).toBe('decimal-pad');
    expect(field('Net pay (£, optional)').props.keyboardType).toBe('numeric');

    await fireEvent.changeText(field('Gross pay (£)'), '500.00');
    await fireEvent.press(button('Add line'));
    await fireEvent.press(button('Add line'));
    expect(screen.getAllByTestId('payslip-line')).toHaveLength(2);
    expect(field('Hours').props.keyboardType).toBe('decimal-pad');
    expect(field('Amount (£)').props.keyboardType).toBe('numeric');

    await fireEvent.changeText(field('Label', 0), 'Basic pay');
    await fireEvent.changeText(field('Hours', 0), '37.5');
    await fireEvent.changeText(field('Amount (£)', 0), '468.75');
    await fireEvent.changeText(field('Label', 1), 'Overtime');
    await fireEvent.changeText(field('Amount (£)', 1), '30');
    expect(screen.getByText('Lines add up to £498.75, gross is £500.00')).toBeTruthy();
    await fireEvent.changeText(field('Amount (£)', 1), '31.25');
    expect(screen.getByText('Lines add up to £500.00')).toBeTruthy();

    await fireEvent.changeText(field('Tax (£)'), '45.60');
    expect(screen.getByText('Gross minus deductions: £454.40')).toBeTruthy();
    expect(shownMessages()).toEqual([]);
    await fireEvent.press(button('Save'));

    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(stored()).toHaveLength(1);
    const saved = stored()[0] as Payslip;
    expect(saved.id).toMatch(/^payslip-/);
    const expected: Payslip = {
      id: saved.id,
      jobId: job.id,
      periodStart: '2026-06-15',
      periodEnd: '2026-06-21',
      grossPaidPence: 50000,
      lines: [
        { label: 'Basic pay', hours: 37.5, amountPence: 46875 },
        { label: 'Overtime', amountPence: 3125 },
      ],
      taxPence: 4560,
      niPence: 0,
      pensionPence: 0,
    };
    expect(saved).toEqual(expected);
    expect(await getPayslip(db, saved.id)).toEqual(expected);
  });

  it('opens an existing payslip prefilled and saves edits in place', async () => {
    await seed([existing]);
    await render(<PayslipScreen />);

    expect(field('Gross pay (£)').props.value).toBe('500.00');
    expect(field('Hours paid (optional)').props.value).toBe('40');
    expect(field('Tax (£)').props.value).toBe('45.60');
    expect(field('National Insurance (£)').props.value).toBe('12.00');
    expect(field('Pension (£)').props.value).toBe('15.00');
    expect(field('Net pay (£, optional)').props.value).toBe('427.40');
    expect(field('Label', 1).props.value).toBe('Overtime');
    expect(field('Hours', 1).props.value).toBe('');
    expect(field('Amount (£)', 0).props.value).toBe('468.75');

    await fireEvent.changeText(field('Gross pay (£)'), '468.75');
    const second = screen.getAllByTestId('payslip-line')[1];
    const remove = within(second).getByRole('button', { name: 'Remove line' });
    // Secondary variant: an outlined button, not plain text.
    expect(styleOf(remove)).toMatchObject({ borderWidth: 1, minHeight: 48 });
    await fireEvent.press(remove);
    expect(screen.getAllByTestId('payslip-line')).toHaveLength(1);
    await fireEvent.changeText(field('Net pay (£, optional)'), '');
    await fireEvent.press(button('Save'));

    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    const expected: Payslip = {
      ...existing,
      grossPaidPence: 46875,
      lines: [{ label: 'Basic pay', hours: 37.5, amountPence: 46875 }],
    };
    delete expected.netPence;
    expect(stored()).toEqual([expected]);
    expect(await getPayslip(db, existing.id)).toEqual(expected);
  });

  it('deletes the payslip only after confirming', async () => {
    await seed([existing]);
    await render(<PayslipScreen />);

    await fireEvent.press(button('Delete payslip'));
    expect(screen.getByText('Delete this payslip?')).toBeTruthy();
    await fireEvent.press(button('Cancel'));
    expect(screen.queryByText('Delete this payslip?')).toBeNull();
    expect(stored()).toHaveLength(1);

    await fireEvent.press(button('Delete payslip'));
    await fireEvent.press(button('Delete'));
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(stored()).toEqual([]);
    expect(await getPayslip(db, existing.id)).toBeUndefined();
  });

  it('shows errors only after Save, and never saves bad input', async () => {
    await seed();
    await render(<PayslipScreen />);

    // No errors while typing, even mid-entry ("12." before the pence), so the
    // fields below never jump as error lines come and go.
    await fireEvent.changeText(field('Gross pay (£)'), '12.');
    await fireEvent.changeText(field('National Insurance (£)'), '-5');
    await fireEvent.changeText(field('Hours paid (optional)'), '800');
    await fireEvent.press(button('Add line'));
    await fireEvent.changeText(field('Amount (£)'), '1.234');
    expect(shownMessages()).toEqual([]);
    // No valid total yet: a placeholder holds the hint row's space.
    expect(screen.getByText('Lines add up to —')).toBeTruthy();

    expect(button('Save').props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(button('Save'));
    expect(shownMessages()).toEqual([
      PAYSLIP_FORM_MESSAGES.gross,
      PAYSLIP_FORM_MESSAGES.hours,
      PAYSLIP_FORM_MESSAGES.ni,
      PAYSLIP_FORM_MESSAGES.lineLabel,
      PAYSLIP_FORM_MESSAGES.lineAmount,
    ]);

    await fireEvent.changeText(field('Tax (£)'), 'abc');
    await fireEvent.changeText(field('Pension (£)'), '1.5.0');
    await fireEvent.changeText(field('Net pay (£, optional)'), 'x');
    await fireEvent.changeText(field('Hours'), 'lots');
    expect(shownMessages()).toEqual(allMessages);
    expect(screen.queryByText(/^Gross minus deductions/)).toBeNull();
    await fireEvent.press(button('Save'));

    expect(mockBack).not.toHaveBeenCalled();
    expect(stored()).toEqual([]);
  });

  it('keeps the lines hint row while an amount is mid-entry, and drops it with no lines', async () => {
    await seed();
    await render(<PayslipScreen />);
    const hints = () => screen.queryAllByText(/^Lines add up to/);

    expect(hints()).toHaveLength(0);
    await fireEvent.press(button('Add line'));
    expect(screen.getByText('Lines add up to —')).toBeTruthy();
    await fireEvent.changeText(field('Label'), 'Basic pay');
    await fireEvent.changeText(field('Amount (£)'), '447');
    expect(screen.getByText('Lines add up to £447.00')).toBeTruthy();
    // "447." does not parse yet: the last valid hint stays, so nothing below moves.
    await fireEvent.changeText(field('Amount (£)'), '447.');
    expect(hints().map((h) => h.props.children)).toEqual(['Lines add up to £447.00']);
    await fireEvent.changeText(field('Amount (£)'), '447.5');
    expect(screen.getByText('Lines add up to £447.50')).toBeTruthy();

    await fireEvent.press(button('Remove line'));
    expect(hints()).toHaveLength(0);
    // A fresh line starts from the placeholder, not the old total.
    await fireEvent.press(button('Add line'));
    expect(hints().map((h) => h.props.children)).toEqual(['Lines add up to —']);
  });

  it('ignores an all-blank line and saves a refund', async () => {
    await seed();
    await render(<PayslipScreen />);
    await fireEvent.changeText(field('Gross pay (£)'), '0');
    await fireEvent.changeText(field('Tax (£)'), '-20');
    await fireEvent.press(button('Add line'));
    await fireEvent.press(button('Save'));
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(stored()).toEqual([
      expect.objectContaining({ grossPaidPence: 0, taxPence: -2000, niPence: 0, pensionPence: 0 }),
    ]);
    expect(stored()[0]?.lines).toBeUndefined();
  });

  it('shows an error and stays open if saving fails', async () => {
    await seed();
    const spy = jest
      .spyOn(usePayslipsStore.getState(), 'savePayslip')
      .mockRejectedValueOnce(new Error('disk full'));
    usePayslipsStore.setState({ savePayslip: usePayslipsStore.getState().savePayslip });
    await render(<PayslipScreen />);
    await fireEvent.changeText(field('Gross pay (£)'), '100');
    await fireEvent.press(button('Save'));
    expect(await screen.findByText("Your payslip couldn't be saved. Try again.")).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
    expect(button('Save').props.accessibilityState.disabled).toBe(false);
    spy.mockRestore();
  });

  it.each(['2026-06-16', '2026-07-06', 'nope'])(
    'unknown or unloaded period %s: "Period not found" with Back',
    async (start) => {
      await seed();
      mockStart = start;
      await render(<PayslipScreen />);
      expect(screen.getByRole('header', { name: 'Period not found' })).toBeTruthy();
      await fireEvent.press(button('Back'));
      expect(mockBack).toHaveBeenCalledTimes(1);
    },
  );

  it('no job: "Period not found"', async () => {
    await render(<PayslipScreen />);
    expect(screen.getByRole('header', { name: 'Period not found' })).toBeTruthy();
  });

  it('hides export until a payslip is saved', async () => {
    await seed();
    await render(<PayslipScreen />);
    expect(screen.queryByTestId('payslip-export')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export PDF' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull();
    expect(screen.queryByText(/Export for payroll/)).toBeNull();
  });

  it('exports the saved check as PDF and CSV', async () => {
    mockPdf.mockResolvedValue({ status: 'shared', uri: 'file:///x.pdf' });
    mockCsv.mockResolvedValue({ status: 'shared', uri: 'file:///x.csv' });
    await seed([existing]);
    await render(<PayslipScreen />);

    await fireEvent.press(button('Export PDF'));
    await waitFor(() => expect(mockPdf).toHaveBeenCalledTimes(1));
    const input = mockPdf.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      jobName: job.name,
      period: { start: '2026-06-15', end: '2026-06-21' },
      check: { paidPence: 50000, expectedPence: 0 },
    });
    expect(input?.detail.payDate).toBe(input?.payDate);
    expect(input?.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await fireEvent.press(button('Export CSV'));
    await waitFor(() => expect(mockCsv).toHaveBeenCalledTimes(1));
    expect(mockCsv.mock.calls[0]?.[0]).toEqual(input);
    expect(screen.getByText(/Estimates only/)).toBeTruthy();
  });

  it('disables both buttons while exporting', async () => {
    let finish: (r: { status: 'shared'; uri: string }) => void = () => {};
    mockCsv.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await seed([existing]);
    await render(<PayslipScreen />);

    await fireEvent.press(button('Export CSV'));
    await waitFor(() => expect(button('Export PDF').props.accessibilityState?.disabled).toBe(true));
    expect(button('Export CSV').props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(button('Export CSV'));
    expect(mockCsv).toHaveBeenCalledTimes(1);

    finish({ status: 'shared', uri: 'file:///x.csv' });
    await waitFor(() =>
      expect(button('Export PDF').props.accessibilityState?.disabled).toBe(false),
    );
  });

  it('says when sharing is unavailable, and when the export fails', async () => {
    mockPdf.mockResolvedValue({ status: 'unavailable' });
    mockCsv.mockResolvedValue({ status: 'failed' });
    await seed([existing]);
    await render(<PayslipScreen />);

    await fireEvent.press(button('Export PDF'));
    expect(await screen.findByText("Sharing isn't available on this device.")).toBeTruthy();
    await fireEvent.press(button('Export CSV'));
    expect(await screen.findByText("The export couldn't be created. Try again.")).toBeTruthy();
    expect(screen.queryByText("Sharing isn't available on this device.")).toBeNull();
  });

  it('reports a failure if the export throws', async () => {
    mockCsv.mockRejectedValue(new Error('boom'));
    await seed([existing]);
    await render(<PayslipScreen />);

    await fireEvent.press(button('Export CSV'));
    expect(await screen.findByText("The export couldn't be created. Try again.")).toBeTruthy();
    expect(button('Export CSV').props.accessibilityState?.disabled).toBe(false);
  });
});

describe('Payslip screen (free)', () => {
  it('shows an upsell instead of lines and saves a gross-only payslip', async () => {
    await seed();
    await render(<PayslipScreen />);

    expect(screen.queryByTestId('payslip-lines')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add line' })).toBeNull();
    expect(screen.queryAllByLabelText('Label')).toHaveLength(0);
    expect(screen.getByText('Line-by-line check — available with ShiftPay Pro')).toBeTruthy();
    expect(screen.getByText(/Estimates only/)).toBeTruthy();
    await fireEvent.press(button('See ShiftPay Pro: Line-by-line check'));
    expect(mockPush).toHaveBeenCalledWith('/paywall');

    await fireEvent.changeText(field('Gross pay (£)'), '500');
    await fireEvent.changeText(field('Hours paid (optional)'), '40');
    await fireEvent.press(button('Save'));

    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    const saved = stored()[0] as Payslip;
    const expected: Payslip = {
      id: saved.id,
      jobId: job.id,
      periodStart: '2026-06-15',
      periodEnd: '2026-06-21',
      grossPaidPence: 50000,
      hoursPaid: 40,
      taxPence: 0,
      niPence: 0,
      pensionPence: 0,
    };
    expect(saved).toEqual(expected);
    expect(await getPayslip(db, saved.id)).toEqual(expected);
  });

  it('keeps lines already stored on the payslip when saving edits', async () => {
    await seed([existing]);
    await render(<PayslipScreen />);

    expect(screen.queryAllByTestId('payslip-line')).toHaveLength(0);
    expect(field('Gross pay (£)').props.value).toBe('500.00');
    await fireEvent.changeText(field('Gross pay (£)'), '510');
    await fireEvent.press(button('Save'));

    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    const expected: Payslip = { ...existing, grossPaidPence: 51000 };
    expect(stored()).toEqual([expected]);
    expect(await getPayslip(db, existing.id)).toEqual(expected);
  });

  it('shows an export upsell instead of the export buttons for a saved payslip', async () => {
    await seed([existing]);
    await render(<PayslipScreen />);

    expect(screen.queryByTestId('payslip-export')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export PDF' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull();
    expect(screen.getByText('Export for payroll — available with ShiftPay Pro')).toBeTruthy();
    await fireEvent.press(button('See ShiftPay Pro: Export for payroll'));
    expect(mockPush).toHaveBeenCalledWith('/paywall');
    expect(mockCsv).not.toHaveBeenCalled();
    expect(mockPdf).not.toHaveBeenCalled();
  });

  it('treats loading as free', async () => {
    useProStore.setState({ status: 'loading', source: 'pending' });
    await seed();
    await render(<PayslipScreen />);
    expect(screen.queryByTestId('payslip-lines')).toBeNull();
    expect(screen.getByTestId('pro-upsell')).toBeTruthy();
  });
});
