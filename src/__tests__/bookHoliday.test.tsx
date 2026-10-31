import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import { Stack, router } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import TabsLayout from '../../app/(tabs)/_layout';
import CalendarScreen from '../../app/(tabs)/calendar';
import HolidayScreen from '../../app/holiday';
import BookHolidayScreen from '../../app/holiday/book';
import { db } from '../db/client';
import { createJob, deleteJob } from '../db/jobRepo';
import { createShift } from '../db/shiftRepo';
import { ONBOARDING_COMPLETE_KEY } from '../services/completeOnboarding';
import { useJobsStore } from '../store/jobsStore';
import { useSettingsStore } from '../store/settingsStore';
import { useShiftsStore } from '../store/shiftsStore';
import { job, resetStores, shift } from '../store/testFixtures';

jest.mock('../db/client', () => ({ db: require('../db/testDb').createTestDb() }));
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => {
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ name }: { name: string }) => <Text>{`icon:${name}`}</Text>,
  };
});
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

// Thu 15 Oct 2026, 13:00 BST; a planned shift on Tue 20 Oct.
const NOW = '2026-10-15T12:00:00.000Z';
const RANGE = { start: '2026-07-17', end: '2027-02-12' };
const PLANNED = shift('2026-10-20', { id: 'planned' });

// The real root shape: a Stack with the tabs below and Holiday screens above them.
const routes = {
  _layout: () => <Stack screenOptions={{ headerShown: false }} />,
  '(tabs)/_layout': TabsLayout,
  '(tabs)/index': () => <Text>Home tab</Text>,
  '(tabs)/calendar': CalendarScreen,
  holiday: HolidayScreen,
  'holiday/book': BookHolidayScreen,
};

beforeEach(async () => {
  resetStores();
  await deleteJob(db, job.id); // cascades shifts
  await createJob(db, job);
  await createShift(db, PLANNED);
  useJobsStore.setState({ jobs: [job], loaded: true });
  useSettingsStore.setState({ values: { [ONBOARDING_COMPLETE_KEY]: true } });
  await useShiftsStore.getState().load(db, RANGE);
  jest.useFakeTimers({ now: new Date(NOW) });
});

afterEach(() => {
  jest.useRealTimers();
});

async function openBookHoliday(): Promise<void> {
  await renderRouter(routes, { initialUrl: '/' });
  await act(() => router.push('/holiday'));
  await fireEvent.press(await screen.findByRole('button', { name: 'Book holiday' }));
  expect(screen).toHavePathname('/holiday/book');
  expect(await screen.findByRole('header', { name: 'Book holiday' })).toBeTruthy();
}

describe('Book holiday', () => {
  it('Back returns to the Holiday screen, not Home', async () => {
    await openBookHoliday();
    await act(() => router.back());
    expect(screen).toHavePathname('/holiday');
    expect(screen.getByRole('header', { name: 'Holiday' })).toBeTruthy();
    expect(screen.queryByText('Home tab')).toBeNull();
  });

  it('the Back button also returns to Holiday', async () => {
    await openBookHoliday();
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(screen).toHavePathname('/holiday');
  });

  it('marks a shift Holiday from the calendar it opens', async () => {
    await openBookHoliday();
    await fireEvent.press(screen.getByTestId('day-2026-10-20'));
    const sheet = within(screen.getByTestId('day-sheet'));
    await fireEvent.press(sheet.getByRole('button', { name: 'Holiday' }));
    await waitFor(() =>
      expect(useShiftsStore.getState().shifts.find((s) => s.id === 'planned')?.status).toBe(
        'holiday',
      ),
    );
  });
});
