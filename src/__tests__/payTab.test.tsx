import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import PayScreen from '../../app/(tabs)/pay';
import PeriodDetailScreen from '../../app/period/[start]';
import { bankHolidays } from '../config/bankHolidays';
import { formatPence, parsePoundsToPence, sumPence } from '../engine/money';
import { aggregatePeriod } from '../engine/payPeriods';
import type { Payslip, PremiumRule } from '../engine/types';
import { useJobsStore } from '../store/jobsStore';
import { usePayslipsStore } from '../store/payslipsStore';
import { useRulesStore } from '../store/rulesStore';
import { useShiftsStore } from '../store/shiftsStore';
import { job, resetStores, shift } from '../store/testFixtures';
import { darkColors, lightColors } from '../theme/tokens';

jest.mock('../db/client', () => ({ db: require('../db/testDb').createTestDb() }));
const mockPush = jest.fn();
const mockBack = jest.fn();
let mockStart = '2026-06-15';
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => ({ start: mockStart }),
}));
let mockScheme: 'light' | 'dark' = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

type StyleProps = { props: { style?: unknown } };
const colorOf = (el: StyleProps): unknown =>
  (StyleSheet.flatten(el.props.style as never) as Record<string, unknown> | undefined)?.color;

// Wed 17 Jun 2026, 13:00 BST. Weekly periods Mon–Sun, paid the Friday after.
// Loaded range 1–30 Jun: full periods 1–7, 8–14, 15–21 (current), 22–28 (next).
const NOW = '2026-06-17T12:00:00.000Z';
const range = { start: '2026-06-01', end: '2026-06-30' };

const shifts = [
  shift('2026-05-31'),
  shift('2026-06-02'),
  shift('2026-06-09', { status: 'worked' }),
  shift('2026-06-15', { status: 'worked' }),
  shift('2026-06-16', { status: 'worked' }),
  // Night 19:00–07:00 BST: night premium, and pushes the week past 20 h (weekly OT).
  shift('2026-06-17', { start: '2026-06-17T18:00:00.000Z', end: '2026-06-18T06:00:00.000Z' }),
  shift('2026-06-18', { status: 'sick' }),
  shift('2026-06-19'),
  shift('2026-06-20', { status: 'cancelled' }),
  shift('2026-06-23'),
];

const rules: PremiumRule[] = [
  {
    id: 'r-night',
    jobId: job.id,
    name: 'Night',
    stacking: 'highest_only',
    priority: 1,
    type: 'time_band',
    startTime: '22:00',
    endTime: '06:00',
    multiplier: 1.25,
  },
  {
    id: 'r-weekly',
    jobId: job.id,
    name: 'Overtime',
    stacking: 'highest_only',
    priority: 0,
    type: 'overtime_weekly',
    thresholdHours: 20,
    multiplier: 1.5,
  },
];

const periods = [
  { start: '2026-06-22', end: '2026-06-28' },
  { start: '2026-06-15', end: '2026-06-21' },
  { start: '2026-06-08', end: '2026-06-14' },
  { start: '2026-06-01', end: '2026-06-07' },
];

const payslip: Payslip = {
  id: 'ps-1',
  jobId: job.id,
  periodStart: '2026-06-15',
  periodEnd: '2026-06-21',
  grossPaidPence: 123456,
  taxPence: 0,
  niPence: 0,
  pensionPence: 0,
};

const enginePence = (period: { start: string; end: string }) =>
  aggregatePeriod(shifts, job, rules, bankHolidays, period).totalGrossPence;

const toPence = (text: string) => parsePoundsToPence(text) as number;

function seed(): void {
  useJobsStore.setState({ jobs: [job], loaded: true });
  useShiftsStore.setState({ shifts, range, loaded: true });
  useRulesStore.setState({ rules, loaded: true });
}

beforeEach(() => {
  resetStores();
  mockPush.mockClear();
  mockBack.mockClear();
  mockStart = '2026-06-15';
  mockScheme = 'light';
  jest.useFakeTimers({ now: new Date(NOW) });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Pay tab', () => {
  it('lists the fully loaded periods newest first, with the engine totals', async () => {
    seed();
    await render(<PayScreen />);

    const rows = screen.getAllByTestId('period-row');
    expect(rows).toHaveLength(periods.length);
    rows.forEach((row, i) => {
      const { start, end } = periods[i];
      const label = `${Number(start.slice(8))} Jun – ${Number(end.slice(8))} Jun`;
      expect(within(row).getByText(label)).toBeTruthy();
      expect(within(row).getByTestId('period-total').props.children).toBe(
        formatPence(enginePence(periods[i])),
      );
    });
    expect(enginePence(periods[1])).toBeGreaterThan(0);

    expect(within(rows[0]).getByText('Next period')).toBeTruthy();
    expect(within(rows[0]).getByText('Pay day Fri 3 Jul')).toBeTruthy();
    expect(within(rows[1]).getByText('This period')).toBeTruthy();
    expect(within(rows[1]).getByText('Pay day Fri 26 Jun')).toBeTruthy();
    // Sick counts, cancelled does not.
    expect(within(rows[1]).getByText(/· 5 shifts$/)).toBeTruthy();
    expect(within(rows[3]).getByText('Paid Fri 12 Jun')).toBeTruthy();
    expect(within(rows[3]).getByText('7.5 h · 1 shift')).toBeTruthy();
    expect(within(rows[3]).queryByTestId('chip')).toBeNull();
    expect(screen.getByText(/Estimates only/)).toBeTruthy();
  });

  it('a row opens the period detail', async () => {
    seed();
    await render(<PayScreen />);
    await fireEvent.press(screen.getAllByTestId('period-row')[1]);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/period/[start]',
      params: { start: '2026-06-15' },
    });
  });

  it('no job: empty state with the disclaimer', async () => {
    await render(<PayScreen />);
    expect(screen.getByText(/No job set up yet/)).toBeTruthy();
    expect(screen.queryByTestId('period-row')).toBeNull();
    expect(screen.getByText(/Estimates only/)).toBeTruthy();
  });

  it('a job with nothing loaded yet shows no periods', async () => {
    useJobsStore.setState({ jobs: [job], loaded: true });
    await render(<PayScreen />);
    expect(screen.getByText('No pay periods to show yet.')).toBeTruthy();
  });

  it.each([
    ['light', lightColors],
    ['dark', darkColors],
  ] as const)('uses the %s tokens', async (scheme, colors) => {
    seed();
    mockScheme = scheme;
    await render(<PayScreen />);
    expect(colorOf(screen.getAllByTestId('period-total')[0])).toBe(colors.ink);
  });
});

describe('Period detail screen', () => {
  it('breakdown lines sum to the shown total and the engine total', async () => {
    seed();
    await render(<PeriodDetailScreen />);

    expect(screen.getByRole('header', { name: '15 Jun – 21 Jun' })).toBeTruthy();
    expect(screen.getByText('Pay day Fri 26 Jun')).toBeTruthy();

    const total = enginePence(periods[1]);
    const card = within(screen.getByTestId('breakdown'));
    expect(card.getByText('Base')).toBeTruthy();
    expect(card.getByText('Night')).toBeTruthy();
    expect(card.getByText('Overtime')).toBeTruthy();
    const lines = card
      .getAllByTestId('breakdown-row')
      .map((row) => toPence(within(row).getByText(/£/).props.children as string));
    expect(sumPence(lines)).toBe(total);
    expect(screen.getByTestId('breakdown-total').props.children).toBe(formatPence(total));
    expect(screen.getByLabelText(formatPence(total))).toBeTruthy();
    expect(screen.getByText(/Estimates only/)).toBeTruthy();
  });

  it('lists the shifts with status chips and opens a shift', async () => {
    seed();
    await render(<PeriodDetailScreen />);
    const rows = within(screen.getByTestId('shifts')).getAllByTestId('shift-row');
    expect(rows).toHaveLength(6);
    expect(within(rows[0]).getByText('Mon 15 Jun')).toBeTruthy();
    expect(within(rows[0]).getByText('Worked')).toBeTruthy();
    expect(within(rows[2]).getByText('19:00–07:00')).toBeTruthy();
    expect(within(rows[2]).queryByTestId('chip')).toBeNull();
    expect(within(rows[3]).getByText('Sick')).toBeTruthy();
    expect(within(rows[5]).getByText('Cancelled')).toBeTruthy();
    expect(within(rows[5]).getByText('£0.00')).toBeTruthy();

    await fireEvent.press(rows[2]);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/shift/[id]',
      params: { id: 's-2026-06-17' },
    });
  });

  it('"Check payslip" opens the payslip screen when none is saved', async () => {
    seed();
    await render(<PeriodDetailScreen />);
    const button = screen.getByRole('button', { name: 'Check payslip' });
    expect(button.props.accessibilityState).toMatchObject({ disabled: false });
    expect(screen.queryByTestId('payslip-check')).toBeNull();
    expect(screen.queryByText('Payslip check')).toBeNull();
    expect(screen.queryByText('Coming soon')).toBeNull();
    await fireEvent.press(button);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/payslip/[start]',
      params: { start: '2026-06-15' },
    });
  });

  it('"Edit payslip" and the check card when a payslip is saved', async () => {
    seed();
    usePayslipsStore.setState({
      payslips: [
        { ...payslip, id: 'ps-other', periodStart: '2026-06-08', periodEnd: '2026-06-14' },
        payslip,
      ],
      loaded: true,
    });
    await render(<PeriodDetailScreen />);
    expect(screen.queryByRole('button', { name: 'Check payslip' })).toBeNull();
    expect(screen.queryByText(/Payslip entered/)).toBeNull();

    const expected = enginePence(periods[1]);
    const card = within(screen.getByTestId('payslip-check'));
    expect(card.getByRole('header', { name: 'Payslip check' })).toBeTruthy();
    expect(within(card.getByTestId('check-expected')).getByText(formatPence(expected))).toBeTruthy();
    expect(within(card.getByTestId('check-paid')).getByText('£1,234.56')).toBeTruthy();
    expect(card.getByTestId('chip')).toBeTruthy();
    expect(card.queryByTestId('check-paid-hours')).toBeNull();
    expect(screen.getByText(/Estimates only/)).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Edit payslip' }));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/payslip/[start]',
      params: { start: '2026-06-15' },
    });
  });

  it('the check card updates when the payslip or shifts change', async () => {
    seed();
    await render(<PeriodDetailScreen />);
    expect(screen.queryByTestId('payslip-check')).toBeNull();

    const expected = enginePence(periods[1]);
    await act(async () => {
      usePayslipsStore.setState({
        payslips: [{ ...payslip, grossPaidPence: expected }],
        loaded: true,
      });
    });
    expect(screen.getByText('Match')).toBeTruthy();
    expect(within(screen.getByTestId('check-difference')).getByText('£0.00')).toBeTruthy();

    await act(async () => {
      useShiftsStore.setState({
        shifts: shifts.filter((s) => s.date !== '2026-06-19'),
        range,
        loaded: true,
      });
    });
    expect(screen.queryByText('Match')).toBeNull();
    expect(screen.getByText(/^Overpaid by £/)).toBeTruthy();
    expect(within(screen.getByTestId('check-difference')).getByText(/^\+£/)).toBeTruthy();
    expect(screen.getByText('Edit payslip')).toBeTruthy();
  });

  it('a past period with no pay shows the empty lines', async () => {
    seed();
    useShiftsStore.setState({ shifts: [], range, loaded: true });
    mockStart = '2026-06-01';
    await render(<PeriodDetailScreen />);
    expect(screen.getByText('Paid Fri 12 Jun')).toBeTruthy();
    expect(screen.getByText('No pay for this period.')).toBeTruthy();
    expect(screen.getByText('No shifts in this period.')).toBeTruthy();
    expect(screen.getByTestId('breakdown-total').props.children).toBe('£0.00');
  });

  it.each(['2026-06-16', '2026-07-06', '2026-05-25', 'nope'])(
    'unknown or unloaded period %s: "Period not found" with Back',
    async (start) => {
      seed();
      mockStart = start;
      await render(<PeriodDetailScreen />);
      expect(screen.getByRole('header', { name: 'Period not found' })).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
      expect(mockBack).toHaveBeenCalledTimes(1);
    },
  );

  it('no job: "Period not found"', async () => {
    await render(<PeriodDetailScreen />);
    expect(screen.getByRole('header', { name: 'Period not found' })).toBeTruthy();
  });
});
