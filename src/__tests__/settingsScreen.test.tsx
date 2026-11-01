import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import HomeScreen from '../../app/(tabs)/index';
import SettingsScreen, {
  BACKUP_FAILED_MESSAGE,
  BACKUP_UNAVAILABLE_MESSAGE,
} from '../../app/(tabs)/settings';
import JobSettingsScreen from '../../app/settings/job';
import { bankHolidays } from '../config/bankHolidays';
import { db } from '../db/client';
import { type StoredJob, createJob, deleteJob, getJob } from '../db/jobRepo';
import { homeSummary } from '../engine/homeSummary';
import { formatPence } from '../engine/money';
import type { PremiumRule } from '../engine/types';
import { type BackupExportResult, exportBackupToShare } from '../services/backupShare';
import { useJobsStore } from '../store/jobsStore';
import { MESSAGES } from '../store/onboardingStore';
import { useRulesStore } from '../store/rulesStore';
import { useShiftsStore } from '../store/shiftsStore';
import { job, resetStores, shift } from '../store/testFixtures';
import { darkColors, lightColors } from '../theme/tokens';

jest.mock('../db/client', () => ({ db: require('../db/testDb').createTestDb() }));
jest.mock('../services/backupShare', () => ({
  ...jest.requireActual('../services/backupShare'),
  exportBackupToShare: jest.fn(),
}));
const mockExport = exportBackupToShare as jest.MockedFunction<typeof exportBackupToShare>;
const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
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
const styleOf = (el: StyleProps): Record<string, unknown> =>
  (StyleSheet.flatten(el.props.style as never) as Record<string, unknown> | undefined) ?? {};

// Wed 17 Jun 2026, 13:00 BST: inside the fixture's weekly period 15–21 Jun.
const NOW = '2026-06-17T12:00:00.000Z';
const CUTOFF_LABEL = 'Cut-off day of the month (1–31)';
const RATE_LABEL = 'Base rate (£ an hour)';

const monthlyJob: StoredJob = {
  ...job,
  payFrequency: 'monthly',
  payPeriodAnchorDate: '2026-05-26',
  payDayOffsetDays: 3,
  periodCutoffDay: 25,
};

const rule: PremiumRule = {
  id: 'r-night',
  jobId: job.id,
  name: 'Nights',
  stacking: 'highest_only',
  priority: 1,
  type: 'time_band',
  startTime: '22:00',
  endTime: '06:00',
  multiplier: 1.25,
};

async function seed(j: StoredJob): Promise<void> {
  await createJob(db, j);
  await useJobsStore.getState().load(db);
}

const saveButton = () => screen.getByRole('button', { name: 'Save' });

beforeEach(async () => {
  resetStores();
  await deleteJob(db, job.id);
  mockPush.mockClear();
  mockBack.mockClear();
  mockScheme = 'light';
});

describe('Settings tab', () => {
  it('shows the job name and rate and the pay rule count, and opens each screen', async () => {
    await seed(job);
    useRulesStore.setState({ rules: [rule], loaded: true });
    await render(<SettingsScreen />);

    expect(screen.getByRole('header', { name: 'Job' })).toBeTruthy();
    expect(screen.getByText('Warehouse')).toBeTruthy();
    expect(screen.getByText('£12.50/h')).toBeTruthy();
    expect(screen.getByText('1 pay rule')).toBeTruthy();
    expect(screen.getByText(/Estimates only/)).toBeTruthy();

    const jobRow = screen.getByRole('button', { name: 'Warehouse, £12.50/h' });
    expect(styleOf(jobRow).minHeight).toBe(48);
    expect(styleOf(screen.getByText('Warehouse')).color).toBe(lightColors.ink);
    await fireEvent.press(jobRow);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/settings/job' });

    await fireEvent.press(screen.getByRole('button', { name: '1 pay rule, Premiums and overtime' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/settings/rules' });
  });

  it('counts rules in the plural and uses dark tokens', async () => {
    mockScheme = 'dark';
    await seed(job);
    useRulesStore.setState({ rules: [rule, { ...rule, id: 'r-2' }], loaded: true });
    await render(<SettingsScreen />);

    expect(screen.getByText('2 pay rules')).toBeTruthy();
    expect(styleOf(screen.getByText('Warehouse')).color).toBe(darkColors.ink);
    expect(styleOf(screen.getByText('£12.50/h')).color).toBe(darkColors.inkMuted);
  });

  it('says when there is no job or no rules', async () => {
    await render(<SettingsScreen />);
    expect(screen.getByText('No job set up yet.')).toBeTruthy();
    expect(screen.queryByText('Pay rules')).toBeNull();

    await act(() => seed(job));
    expect(screen.getByText('No pay rules yet')).toBeTruthy();
  });
});

describe('Settings tab backup', () => {
  const exportButton = () => screen.getByRole('button', { name: 'Export backup' });
  const isDisabled = () => exportButton().props.accessibilityState?.disabled === true;

  beforeEach(() => {
    mockExport.mockReset();
  });

  it('shows the Backup card between Reminders and About, and disables Export while it runs', async () => {
    let finish: (r: BackupExportResult) => void = () => {};
    mockExport.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await render(<SettingsScreen />);

    const headers = screen.getAllByRole('header').map((h) => h.props.children as unknown);
    expect(headers.indexOf('Backup')).toBe(headers.indexOf('Reminders') + 1);
    expect(headers.indexOf('About')).toBe(headers.indexOf('Backup') + 1);
    expect(screen.getByText('Save a copy of all your data')).toBeTruthy();
    expect(isDisabled()).toBe(false);

    await fireEvent.press(exportButton());
    expect(mockExport).toHaveBeenCalledTimes(1);
    expect(mockExport.mock.calls[0][0]).toBe(db);
    expect(new Date(mockExport.mock.calls[0][1]).toISOString()).toBe(mockExport.mock.calls[0][1]);
    expect(isDisabled()).toBe(true);
    await fireEvent.press(exportButton());
    expect(mockExport).toHaveBeenCalledTimes(1);

    await act(async () => finish({ status: 'shared', uri: 'file:///cache/x.json' }));
    expect(isDisabled()).toBe(false);
    expect(screen.queryByText(BACKUP_UNAVAILABLE_MESSAGE)).toBeNull();
    expect(screen.queryByText(BACKUP_FAILED_MESSAGE)).toBeNull();
  });

  it('says when sharing is unavailable, and clears the message on the next try', async () => {
    mockExport.mockResolvedValueOnce({ status: 'unavailable' });
    await render(<SettingsScreen />);

    await fireEvent.press(exportButton());
    await waitFor(() => expect(screen.getByText(BACKUP_UNAVAILABLE_MESSAGE)).toBeTruthy());
    expect(isDisabled()).toBe(false);

    mockExport.mockResolvedValueOnce({ status: 'shared', uri: 'file:///cache/x.json' });
    await fireEvent.press(exportButton());
    await waitFor(() => expect(screen.queryByText(BACKUP_UNAVAILABLE_MESSAGE)).toBeNull());
  });

  it('shows an error and re-enables the button when the export fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockExport.mockRejectedValueOnce(new Error('disk full'));
      await render(<SettingsScreen />);

      await fireEvent.press(exportButton());
      await waitFor(() => expect(screen.getByText(BACKUP_FAILED_MESSAGE)).toBeTruthy());
      expect(isDisabled()).toBe(false);
      expect(warn).toHaveBeenCalledWith('Backup export failed.', expect.any(Error));
    } finally {
      warn.mockRestore();
    }
  });
});

describe('Job settings', () => {
  it('saves rate, region, cut-off and overtime mode to the DB and the store', async () => {
    await seed(monthlyJob);
    await render(<JobSettingsScreen />);

    expect(screen.getByLabelText(RATE_LABEL).props.value).toBe('12.50');
    expect(screen.getByLabelText(CUTOFF_LABEL).props.value).toBe('25');
    expect(screen.getByText('Overtime on a premium hour pays whichever rate is higher.')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Job name'), '  Depot  ');
    await fireEvent.changeText(screen.getByLabelText(RATE_LABEL), '13.75');
    await fireEvent.changeText(screen.getByLabelText(CUTOFF_LABEL), '20');
    await fireEvent.press(screen.getByRole('button', { name: 'Scotland' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Add them together' }));
    expect(screen.getByRole('button', { name: 'Scotland' }).props.accessibilityState.selected).toBe(true);
    await fireEvent.press(saveButton());

    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    const expected: StoredJob = {
      ...monthlyJob,
      name: 'Depot',
      baseRatePence: 1375,
      bankHolidayRegion: 'scotland',
      periodCutoffDay: 20,
      overtimePremiumMode: 'stack',
    };
    expect(await getJob(db, job.id)).toEqual(expected);
    expect(useJobsStore.getState().jobs).toEqual([expected]);
  });

  it('blocks Save and shows errors under the fields while a value is invalid', async () => {
    await seed(monthlyJob);
    await render(<JobSettingsScreen />);

    await fireEvent.changeText(screen.getByLabelText(RATE_LABEL), 'abc');
    expect(screen.getByText(MESSAGES.rate)).toBeTruthy();
    expect(saveButton().props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(saveButton());

    await fireEvent.changeText(screen.getByLabelText(RATE_LABEL), '13');
    await fireEvent.changeText(screen.getByLabelText(CUTOFF_LABEL), '32');
    expect(screen.getByText(MESSAGES.cutoff)).toBeTruthy();
    expect(saveButton().props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByLabelText(CUTOFF_LABEL), 'x');
    expect(screen.getByText(MESSAGES.cutoff)).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText(CUTOFF_LABEL), '31');
    await fireEvent.changeText(screen.getByLabelText('Job name'), ' ');
    expect(screen.getByText(MESSAGES.nameRequired)).toBeTruthy();
    expect(saveButton().props.accessibilityState.disabled).toBe(true);

    expect(mockBack).not.toHaveBeenCalled();
    expect(await getJob(db, job.id)).toEqual(monthlyJob);
  });

  it('discards edits on Back', async () => {
    await seed(monthlyJob);
    await render(<JobSettingsScreen />);

    await fireEvent.changeText(screen.getByLabelText(RATE_LABEL), '20');
    await fireEvent.press(screen.getByRole('button', { name: 'Overtime rate only' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(await getJob(db, job.id)).toEqual(monthlyJob);
    expect(useJobsStore.getState().jobs).toEqual([monthlyJob]);
  });

  it('hides the cut-off day for a weekly job, and Home reflects a new base rate', async () => {
    jest.useFakeTimers({ now: new Date(NOW) });
    try {
      await seed(job);
      const shifts = [shift('2026-06-15'), shift('2026-06-16'), shift('2026-06-19')];
      useShiftsStore.setState({ shifts, loaded: true });
      await render(<JobSettingsScreen />);

      expect(screen.queryByLabelText(CUTOFF_LABEL)).toBeNull();
      await fireEvent.changeText(screen.getByLabelText(RATE_LABEL), '£15');
      await fireEvent.press(saveButton());
      await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));

      const saved = { ...job, baseRatePence: 1500 };
      expect(await getJob(db, job.id)).toEqual(saved);
      const before = homeSummary({ shifts, job, rules: [], bankHolidays, now: NOW });
      const after = homeSummary({ shifts, job: saved, rules: [], bankHolidays, now: NOW });
      expect(after.projectedPence).toBeGreaterThan(before.projectedPence);

      await screen.unmount();
      await render(<HomeScreen />);
      expect(
        screen.getByText(`Projected for this period ${formatPence(after.projectedPence)}`),
      ).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('says when there is no job', async () => {
    await render(<JobSettingsScreen />);
    expect(screen.getByText('No job set up yet.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
