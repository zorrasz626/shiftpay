import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import SettingsScreen from '../../app/(tabs)/settings';
import HolidaySettingsScreen from '../../app/settings/holiday';
import { db } from '../db/client';
import { type StoredJob, createJob, deleteJob, getJob } from '../db/jobRepo';
import { HOLIDAY_FORM_MESSAGES } from '../engine/holidayForm';
import { useJobsStore } from '../store/jobsStore';
import { job, resetStores } from '../store/testFixtures';

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

const ENTITLEMENT_LABEL = 'Holiday entitlement (hours)';
const YEAR_START_LABEL = 'Holiday year start';

async function seed(j: StoredJob): Promise<void> {
  await createJob(db, j);
  await useJobsStore.getState().load(db);
}

const saveButton = () => screen.getByRole('button', { name: 'Save' });
const chip = (name: string) => screen.getByRole('button', { name });

beforeEach(async () => {
  resetStores();
  await deleteJob(db, job.id);
  mockPush.mockClear();
  mockBack.mockClear();
});

describe('Settings tab: Holiday row', () => {
  it('shows fixed hours a year and opens Holiday settings', async () => {
    await seed(job);
    await render(<SettingsScreen />);

    expect(screen.getByRole('header', { name: 'Holiday' })).toBeTruthy();
    const row = screen.getByRole('button', { name: 'Holiday settings, 210 h a year' });
    await fireEvent.press(row);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/settings/holiday' });
  });

  it('shows accrual, and no Holiday card without a job', async () => {
    await render(<SettingsScreen />);
    expect(screen.queryByText('Holiday settings')).toBeNull();
    await screen.unmount();

    await seed({ ...job, holidayMode: 'accrual' });
    await render(<SettingsScreen />);
    expect(
      screen.getByRole('button', { name: 'Holiday settings, Accrual (12.07%)' }),
    ).toBeTruthy();
  });
});

describe('Holiday settings', () => {
  it('saves fixed hours and the year start to the DB and the store', async () => {
    await seed(job);
    await render(<HolidaySettingsScreen />);

    expect(chip('Fixed hours').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText(ENTITLEMENT_LABEL).props.value).toBe('210');
    expect(screen.getByLabelText(YEAR_START_LABEL).props.value).toBe('2026-04-01');
    expect(screen.getByText('Hours of paid holiday a year')).toBeTruthy();
    expect(screen.getByText(/12\.07% of the hours you work/)).toBeTruthy();
    expect(screen.getByText(/Estimates only/)).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText(ENTITLEMENT_LABEL), '168.75');
    await fireEvent.changeText(screen.getByLabelText(YEAR_START_LABEL), '2027-01-01');
    await fireEvent.press(saveButton());

    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    const expected: StoredJob = {
      ...job,
      holidayEntitlementHours: 168.75,
      holidayYearStart: '2027-01-01',
    };
    expect(await getJob(db, job.id)).toEqual(expected);
    expect(useJobsStore.getState().jobs).toEqual([expected]);
  });

  it('accrual hides the entitlement field and keeps the stored hours', async () => {
    await seed(job);
    await render(<HolidaySettingsScreen />);

    await fireEvent.changeText(screen.getByLabelText(ENTITLEMENT_LABEL), '');
    expect(screen.getByText(HOLIDAY_FORM_MESSAGES.entitlement)).toBeTruthy();
    await fireEvent.press(chip('Accrual (12.07%)'));
    expect(chip('Accrual (12.07%)').props.accessibilityState.selected).toBe(true);
    expect(screen.queryByLabelText(ENTITLEMENT_LABEL)).toBeNull();
    expect(saveButton().props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(saveButton());

    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    const expected: StoredJob = { ...job, holidayMode: 'accrual' };
    expect(await getJob(db, job.id)).toEqual(expected);
    expect(useJobsStore.getState().jobs).toEqual([expected]);
  });

  it('blocks Save on errors and Back discards edits', async () => {
    await seed(job);
    await render(<HolidaySettingsScreen />);

    await fireEvent.changeText(screen.getByLabelText(ENTITLEMENT_LABEL), '1.2.3');
    expect(screen.getByText(HOLIDAY_FORM_MESSAGES.entitlement)).toBeTruthy();
    expect(saveButton().props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByLabelText(ENTITLEMENT_LABEL), '200');
    await fireEvent.changeText(screen.getByLabelText(YEAR_START_LABEL), '2026-02-30');
    expect(screen.getByText(HOLIDAY_FORM_MESSAGES.yearStart)).toBeTruthy();
    expect(saveButton().props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(saveButton());
    expect(mockBack).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(await getJob(db, job.id)).toEqual(job);
  });

  it('shows an error when the save fails', async () => {
    await seed(job);
    useJobsStore.setState({ saveJob: jest.fn().mockRejectedValue(new Error('disk full')) });
    await render(<HolidaySettingsScreen />);

    await fireEvent.press(saveButton());
    expect(await screen.findByText("Your changes couldn't be saved. Try again.")).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
    expect(saveButton().props.accessibilityState.disabled).toBe(false);
  });

  it('says when there is no job', async () => {
    await render(<HolidaySettingsScreen />);
    expect(screen.getByText('No job set up yet.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
