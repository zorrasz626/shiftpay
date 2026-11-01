import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import HomeScreen from '../../app/(tabs)/index';
import { bankHolidays } from '../config/bankHolidays';
import { db } from '../db/client';
import { createJob, deleteJob } from '../db/jobRepo';
import { createShift } from '../db/shiftRepo';
import { homeSummary } from '../engine/homeSummary';
import { formatPence } from '../engine/money';
import { estimateNetPay } from '../engine/netPay';
import type { PremiumRule } from '../engine/types';
import { useProStore } from '../features/pro/proStore';
import { buildNetPayInput } from '../features/tax/netPayInput';
import { DEFAULT_TAX_PROFILE } from '../features/tax/taxProfile';
import { useJobsStore } from '../store/jobsStore';
import { useRulesStore } from '../store/rulesStore';
import { useShiftsStore } from '../store/shiftsStore';
import { job, resetStores, shift } from '../store/testFixtures';
import { darkColors, lightColors } from '../theme/tokens';

jest.mock('../db/client', () => ({ db: require('../db/testDb').createTestDb() }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
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

// Wed 17 Jun 2026, 13:00 BST. The weekly period is Mon 15 Jun – Sun 21 Jun;
// the next pay day is Fri 19 Jun (for 8–14 Jun).
const NOW = '2026-06-17T12:00:00.000Z';

const shifts = [
  shift('2026-06-10'),
  shift('2026-06-15'),
  shift('2026-06-16'),
  // Night shift tonight: 19:00–07:00 BST.
  shift('2026-06-17', { start: '2026-06-17T18:00:00.000Z', end: '2026-06-18T06:00:00.000Z' }),
  shift('2026-06-19'),
];

const rules: PremiumRule[] = [
  {
    id: 'r-night',
    jobId: job.id,
    name: 'Nights',
    stacking: 'highest_only',
    priority: 1,
    type: 'time_band',
    startTime: '22:00',
    endTime: '06:00',
    multiplier: 1.25,
  },
];

function seed(withShifts = true): void {
  useJobsStore.setState({ jobs: [job], loaded: true });
  useShiftsStore.setState({ shifts: withShifts ? shifts : [], loaded: true });
}

beforeEach(async () => {
  resetStores();
  await deleteJob(db, job.id); // cascades shifts
  mockPush.mockClear();
  mockScheme = 'light';
  useProStore.setState(useProStore.getInitialState(), true);
  jest.useFakeTimers({ now: new Date(NOW) });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Home screen', () => {
  it('shows the same pence the engine returns for the seeded fixture', async () => {
    seed();
    const expected = homeSummary({ shifts, job, rules: [], bankHolidays, now: NOW });
    expect(expected.earnedSoFarPence).toBeGreaterThan(0);
    const next = expected.nextShift;
    if (next === null) throw new Error('fixture needs a next shift');
    expect(expected.nextPayDay.expectedPence).toBeGreaterThan(0);

    await render(<HomeScreen />);

    expect(screen.getByLabelText(formatPence(expected.earnedSoFarPence))).toBeTruthy();
    expect(screen.getByText('Earned so far this period')).toBeTruthy();
    expect(screen.getByText(`Projected for this period ${formatPence(expected.projectedPence)}`)).toBeTruthy();
    expect(screen.getByText('15 Jun – 21 Jun')).toBeTruthy();
    expect(screen.getByText('Tonight 19:00–07:00')).toBeTruthy();
    expect(screen.getByText(job.name)).toBeTruthy();
    expect(screen.getByText(`${formatPence(next.totalGrossPence)} expected`)).toBeTruthy();
    expect(screen.getByText('Pay day in 2 days · Fri 19 Jun')).toBeTruthy();
    expect(screen.getByText(`${formatPence(expected.nextPayDay.expectedPence)} expected`)).toBeTruthy();
    expect(screen.getByText(/Estimates only/)).toBeTruthy();
  });

  it('uses the job premium rules from the rules store', async () => {
    seed();
    useRulesStore.setState({ rules: rules, loaded: true });
    const withRules = homeSummary({ shifts, job, rules: rules, bankHolidays, now: NOW });
    const without = homeSummary({ shifts, job, rules: [], bankHolidays, now: NOW });
    expect(withRules.projectedPence).toBeGreaterThan(without.projectedPence);

    await render(<HomeScreen />);

    expect(screen.getByText(`Projected for this period ${formatPence(withRules.projectedPence)}`)).toBeTruthy();
  });

  it('refreshes "now" every minute: the night shift becomes on now', async () => {
    seed();
    await render(<HomeScreen />);
    expect(screen.getByText('Tonight 19:00–07:00')).toBeTruthy();

    // 18:00Z is 19:00 BST: the shift starts.
    jest.setSystemTime(new Date('2026-06-17T18:00:30.000Z'));
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('On now, ends 07:00')).toBeTruthy();
  });

  it('shows remaining holiday from the DB and opens the Holiday screen', async () => {
    seed();
    await createJob(db, job);
    // Taken 2 Apr and booked 25 Jun, both only in the DB; 7.5 h paid each.
    await createShift(db, shift('2026-04-02', { id: 'h-taken', status: 'holiday' }));
    await createShift(db, shift('2026-06-25', { id: 'h-booked', status: 'holiday' }));

    await render(<HomeScreen />);

    expect(await screen.findByText('195 h left')).toBeTruthy();
    expect(screen.getByText('Taken 7.5 h · Booked 7.5 h')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^Holiday: 195 h left/ }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/holiday' });
  });

  it('says no shifts coming up when there are none', async () => {
    seed(false);
    await render(<HomeScreen />);
    expect(screen.getByText('No shifts coming up')).toBeTruthy();
    expect(screen.getByLabelText('£0.00')).toBeTruthy();
  });

  it('Pro: shows the estimated take-home for the projected period total', async () => {
    useProStore.setState({ status: 'pro', source: 'revenuecat' });
    seed();
    const expected = homeSummary({ shifts, job, rules: [], bankHolidays, now: NOW });
    // Weekly period 15–21 Jun is paid Fri 26 Jun.
    const net = estimateNetPay(
      buildNetPayInput({
        profile: DEFAULT_TAX_PROFILE,
        grossPence: expected.projectedPence,
        frequency: job.payFrequency,
        payDate: '2026-06-26',
      }),
    );
    await render(<HomeScreen />);

    const card = within(screen.getByTestId('net-pay-card'));
    expect(card.getByLabelText(formatPence(net.netPence))).toBeTruthy();
    expect(card.getByText('Using 2026/27 tax year')).toBeTruthy();
    // Disclaimer exactly once on the screen, outside the card.
    expect(card.queryByText(/Estimates only/)).toBeNull();
    expect(screen.getAllByText(/Estimates only/)).toHaveLength(1);
    expect(screen.queryByTestId('pro-upsell')).toBeNull();
  });

  it('Free: shows the take-home upsell and no net figure', async () => {
    useProStore.setState({ status: 'free', source: 'unconfigured' });
    seed();
    await render(<HomeScreen />);

    expect(screen.queryByTestId('net-pay-card')).toBeNull();
    expect(screen.queryByText(/take-home \(rough estimate\)/)).toBeNull();
    expect(
      screen.getByText('See your estimated take-home — available with ShiftPay Pro'),
    ).toBeTruthy();
  });

  it('shows an empty state and the disclaimer before a job exists', async () => {
    await render(<HomeScreen />);
    expect(screen.getByText('No job set up yet. Add one to see what you have earned.')).toBeTruthy();
    expect(screen.getByText(/Estimates only/)).toBeTruthy();
    expect(screen.queryByText('Earned so far this period')).toBeNull();
    expect(screen.queryByText('Next shift')).toBeNull();
  });

  it.each([
    ['light', lightColors],
    ['dark', darkColors],
  ] as const)('uses theme ink in %s mode', async (scheme, colors) => {
    mockScheme = scheme;
    seed();
    await render(<HomeScreen />);
    expect(colorOf(screen.getByText('Tonight 19:00–07:00'))).toBe(colors.ink);
    expect(colorOf(screen.getByText('15 Jun – 21 Jun'))).toBe(colors.inkMuted);
  });
});
