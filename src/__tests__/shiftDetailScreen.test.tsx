import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import ShiftDetailScreen from '../../app/shift/[id]';
import { bankHolidays } from '../config/bankHolidays';
import { formatPence, parsePoundsToPence, sumPence } from '../engine/money';
import { periodContaining } from '../engine/payPeriods';
import { calculateShifts } from '../engine/shiftPay';
import type { PremiumRule } from '../engine/types';
import { DaySheet } from '../features/calendar/DaySheet';
import { useJobsStore } from '../store/jobsStore';
import { useRulesStore } from '../store/rulesStore';
import { useShiftsStore } from '../store/shiftsStore';
import { job, resetStores, shift } from '../store/testFixtures';
import { darkColors, lightColors } from '../theme/tokens';

jest.mock('../db/client', () => ({ db: require('../db/testDb').createTestDb() }));
const mockPush = jest.fn();
const mockBack = jest.fn();
let mockId = 'sun-night';
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => ({ id: mockId }),
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

// After the clocks go back (25 Oct 2026), London = UTC. Weekly periods Mon-Sun.
// Mon + Tue are 7.5h each (30 min break), so the last 2.5h of Sunday night are weekly OT.
const sunNight = shift('2026-10-25', {
  id: 'sun-night',
  start: '2026-10-25T20:00:00.000Z',
  end: '2026-10-26T04:00:00.000Z',
});
const shifts = [shift('2026-10-19'), shift('2026-10-20'), sunNight];

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
    id: 'r-sunday',
    jobId: job.id,
    name: 'Sunday',
    stacking: 'stack',
    priority: 0,
    type: 'day_of_week',
    daysOfWeek: [0],
    flatAddPencePerHour: 150,
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

function seed(): void {
  useJobsStore.setState({ jobs: [job], loaded: true });
  useShiftsStore.setState({ shifts, loaded: true });
  useRulesStore.setState({ rules, loaded: true });
}

const enginePence = () =>
  calculateShifts(shifts, job, rules, bankHolidays, periodContaining(sunNight.date, job)).find(
    (b) => b.shiftId === sunNight.id,
  )?.totalGrossPence;

/** The £ amounts shown in a card's rows, as pence. */
const rowPence = (testID: string) =>
  within(screen.getByTestId(testID))
    .getAllByTestId('breakdown-row')
    .map((row) => within(row).getByText(/£/).props.children as string)
    .map((text) => parsePoundsToPence(text) as number);

beforeEach(() => {
  resetStores();
  mockPush.mockClear();
  mockBack.mockClear();
  mockId = 'sun-night';
  mockScheme = 'light';
});

describe('Shift detail screen', () => {
  it('shows the breakdown lines, which sum to the shown total and the engine total', async () => {
    seed();
    await render(<ShiftDetailScreen />);

    expect(screen.getByRole('header', { name: 'Sun 25 Oct' })).toBeTruthy();
    expect(screen.getByText('20:00–04:00')).toBeTruthy();
    expect(screen.getByText('Planned')).toBeTruthy();

    const card = within(screen.getByTestId('breakdown'));
    expect(card.getByText('Base')).toBeTruthy();
    expect(card.getByText('Night')).toBeTruthy();
    expect(card.getByText('Sunday')).toBeTruthy();
    expect(card.getByText('Overtime')).toBeTruthy();

    const total = enginePence() as number;
    expect(total).toBeGreaterThan(0);
    const lines = rowPence('breakdown');
    expect(lines).toHaveLength(4);
    expect(sumPence(lines)).toBe(total);
    expect(screen.getByTestId('breakdown-total').props.children).toBe(formatPence(total));
    // Time slices add up to the same total.
    expect(sumPence(rowPence('slices'))).toBe(total);
    expect(screen.getByText(/Estimates only/)).toBeTruthy();
  });

  it('Back returns to the previous screen', async () => {
    seed();
    await render(<ShiftDetailScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('uses the dark tokens in dark mode', async () => {
    seed();
    mockScheme = 'dark';
    await render(<ShiftDetailScreen />);
    expect(colorOf(screen.getByTestId('breakdown-total'))).toBe(darkColors.ink);
    mockScheme = 'light';
  });

  it('uses the light tokens in light mode', async () => {
    seed();
    await render(<ShiftDetailScreen />);
    expect(colorOf(screen.getByTestId('breakdown-total'))).toBe(lightColors.ink);
  });

  it('a cancelled shift shows £0.00 and no time slices', async () => {
    seed();
    useShiftsStore.setState({ shifts: [{ ...sunNight, status: 'cancelled' }], loaded: true });
    await render(<ShiftDetailScreen />);
    expect(screen.getByText('Cancelled')).toBeTruthy();
    expect(screen.getByText('No pay for this shift.')).toBeTruthy();
    expect(screen.getByTestId('breakdown-total').props.children).toBe('£0.00');
    expect(screen.queryByTestId('slices')).toBeNull();
  });

  it('unknown id: "Shift not found" with Back', async () => {
    seed();
    mockId = 'nope';
    await render(<ShiftDetailScreen />);
    expect(screen.getByRole('header', { name: 'Shift not found' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('the day sheet "Pay breakdown" button closes the sheet and opens the shift', async () => {
    seed();
    const onClose = jest.fn();
    await render(<DaySheet date="2026-10-25" onClose={onClose} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Pay breakdown' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/shift/[id]', params: { id: 'sun-night' } });
  });
});
