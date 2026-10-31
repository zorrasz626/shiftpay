import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import HolidayScreen from '../../app/holiday';
import { db } from '../db/client';
import { createJob, deleteJob, type StoredJob } from '../db/jobRepo';
import { createShift, type StoredShift } from '../db/shiftRepo';
import { holidaySummary } from '../engine/holiday';
import { formatHolidayHours } from '../engine/holidayView';
import { useJobsStore } from '../store/jobsStore';
import { useShiftsStore } from '../store/shiftsStore';
import { job, resetStores, shift } from '../store/testFixtures';

jest.mock('../db/client', () => ({ db: require('../db/testDb').createTestDb() }));
const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

// Thu 15 Oct 2026, 13:00 BST (08:00 in New York): still the same local date.
// Holiday year 1 Apr 2026 – 31 Mar 2027. Each fixture shift is 7.5 h paid.
const NOW = '2026-10-15T12:00:00.000Z';
const TODAY = '2026-10-15';
// What the app loads into the store (−90/+120 days): 5 May is outside it.
const RANGE = { start: '2026-07-17', end: '2027-02-12' };

const OLD_HOLIDAY = shift('2026-05-05', { id: 'old-hol', status: 'holiday' });
const PAST_HOLIDAY = shift('2026-10-01', { id: 'past-hol', status: 'holiday' });
const BOOKED = shift('2026-11-10', { id: 'booked', status: 'holiday' });
const PLANNED = shift('2026-12-01', { id: 'planned' });
const LAST_YEAR = shift('2026-03-20', { id: 'last-year', status: 'holiday' });
const WORKED = shift('2026-09-01', { id: 'worked', status: 'worked' });
const ALL = [OLD_HOLIDAY, PAST_HOLIDAY, BOOKED, PLANNED, LAST_YEAR, WORKED];

async function seed(j: StoredJob = job, shifts: StoredShift[] = ALL): Promise<void> {
  await createJob(db, j);
  for (const s of shifts) await createShift(db, s);
  useJobsStore.setState({ jobs: [j], loaded: true });
  await useShiftsStore.getState().load(db, RANGE);
}

const row = (key: string) => within(screen.getByTestId(`holiday-row-${key}`));

beforeEach(async () => {
  resetStores();
  await deleteJob(db, job.id); // cascades shifts
  mockPush.mockClear();
  mockBack.mockClear();
  jest.useFakeTimers({ now: new Date(NOW) });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Holiday screen', () => {
  it('shows taken (incl. a holiday older than the store range) and booked for a fixed job', async () => {
    await seed();
    expect(useShiftsStore.getState().shifts.some((s) => s.id === OLD_HOLIDAY.id)).toBe(false);
    const expected = holidaySummary(job, ALL, TODAY);
    expect(expected.taken).toBe(15);

    await render(<HolidayScreen />);

    expect(await screen.findByText('1 Apr 2026 – 31 Mar 2027')).toBeTruthy();
    expect(screen.getByText('Fixed entitlement')).toBeTruthy();
    expect(row('entitled').getByText('210 h')).toBeTruthy();
    expect(row('accrued').getByText(formatHolidayHours(expected.accrued))).toBeTruthy();
    expect(row('taken').getByText('15 h')).toBeTruthy();
    expect(row('booked').getByText('7.5 h')).toBeTruthy();
    expect(row('remaining').getByText('187.5 h')).toBeTruthy();
    expect(screen.getByText('187.5 h left')).toBeTruthy();
    expect(
      screen.getByLabelText('Holiday: 187.5 h left. Entitled 210 h, taken 15 h, booked 7.5 h.'),
    ).toBeTruthy();
    expect(screen.getByText(/Estimates only/)).toBeTruthy();
  });

  it('updates booked and remaining after a shift is marked Holiday in the store', async () => {
    await seed();
    await render(<HolidayScreen />);
    expect(await screen.findByText('187.5 h left')).toBeTruthy();

    await act(async () => {
      await useShiftsStore.getState().setStatus(db, PLANNED.id, 'holiday');
    });

    expect(await screen.findByText('180 h left')).toBeTruthy();
    expect(row('booked').getByText('15 h')).toBeTruthy();
    expect(row('remaining').getByText('180 h')).toBeTruthy();
  });

  it('shows the accrual labels and no accrued row in accrual mode', async () => {
    const accrualJob: StoredJob = { ...job, holidayMode: 'accrual' };
    await seed(accrualJob);
    const expected = holidaySummary(accrualJob, ALL, TODAY);

    await render(<HolidayScreen />);

    expect(await screen.findByText('Accrues at 12.07% of hours worked')).toBeTruthy();
    expect(screen.queryByTestId('holiday-row-accrued')).toBeNull();
    expect(row('entitled').getByText(formatHolidayHours(expected.entitled))).toBeTruthy();
    expect(screen.getByText(`${formatHolidayHours(-expected.remaining)} over`)).toBeTruthy();
  });

  it('navigates to the Calendar, Holiday settings and back', async () => {
    await seed();
    await render(<HolidayScreen />);

    await fireEvent.press(await screen.findByText('Book holiday'));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/calendar' });
    await fireEvent.press(screen.getByText('Holiday settings'));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/settings/holiday' });
    await fireEvent.press(screen.getByText('Back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('asks for a job first when there is none', async () => {
    await render(<HolidayScreen />);
    expect(screen.getByText('Set up your job first')).toBeTruthy();
    expect(screen.queryByText('Book holiday')).toBeNull();
    await fireEvent.press(screen.getByText('Back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
