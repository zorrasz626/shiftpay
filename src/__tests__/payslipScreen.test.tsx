import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import PayslipScreen from '../../app/payslip/[start]';
import { db } from '../db/client';
import { createJob, deleteJob } from '../db/jobRepo';
import { createPayslip, getPayslip } from '../db/payslipRepo';
import { PAYSLIP_FORM_MESSAGES } from '../engine/payslipForm';
import type { Payslip } from '../engine/types';
import { useJobsStore } from '../store/jobsStore';
import { usePayslipsStore } from '../store/payslipsStore';
import { useShiftsStore } from '../store/shiftsStore';
import { job, resetStores } from '../store/testFixtures';

jest.mock('../db/client', () => ({ db: require('../db/testDb').createTestDb() }));
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

beforeEach(async () => {
  resetStores();
  await deleteJob(db, job.id);
  mockPush.mockClear();
  mockBack.mockClear();
  mockStart = '2026-06-15';
});

describe('Payslip screen', () => {
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
    await fireEvent.press(within(second).getByRole('button', { name: 'Remove line' }));
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

  it('shows errors once a field has text or after Save, and never saves bad input', async () => {
    await seed();
    await render(<PayslipScreen />);

    await fireEvent.changeText(field('National Insurance (£)'), '-5');
    expect(shownMessages()).toEqual([PAYSLIP_FORM_MESSAGES.ni]);
    await fireEvent.changeText(field('Hours paid (optional)'), '800');
    expect(screen.getByText(PAYSLIP_FORM_MESSAGES.hours)).toBeTruthy();
    await fireEvent.press(button('Add line'));
    await fireEvent.changeText(field('Amount (£)'), '1.234');
    expect(screen.getByText(PAYSLIP_FORM_MESSAGES.lineAmount)).toBeTruthy();
    expect(screen.queryByText(PAYSLIP_FORM_MESSAGES.lineLabel)).toBeNull();
    expect(screen.queryByText(PAYSLIP_FORM_MESSAGES.gross)).toBeNull();
    expect(screen.queryByText(/^Lines add up to/)).toBeNull();

    expect(button('Save').props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(button('Save'));
    expect(screen.getByText(PAYSLIP_FORM_MESSAGES.gross)).toBeTruthy();
    expect(screen.getByText(PAYSLIP_FORM_MESSAGES.lineLabel)).toBeTruthy();

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
});
