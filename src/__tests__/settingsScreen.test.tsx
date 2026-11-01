import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Alert, type AlertButton, StyleSheet } from 'react-native';

import HomeScreen from '../../app/(tabs)/index';
import SettingsScreen, {
  BACKUP_FAILED_MESSAGE,
  BACKUP_UNAVAILABLE_MESSAGE,
  RESTORE_CONFIRM_TITLE,
  RESTORE_DONE_MESSAGE,
  RESTORE_FAILED_MESSAGE,
  RESTORE_REJECT_MESSAGES,
} from '../../app/(tabs)/settings';
import JobSettingsScreen from '../../app/settings/job';
import { bankHolidays } from '../config/bankHolidays';
import { type Backup, SCHEMA_VERSION, exportBackup } from '../db/backup';
import { importBackup } from '../db/backupImport';
import { db } from '../db/client';
import { type StoredJob, createJob, deleteJob, getJob } from '../db/jobRepo';
import { createRotaPattern, createShiftTemplate } from '../db/rotaRepo';
import { createTestDb } from '../db/testDb';
import { homeSummary } from '../engine/homeSummary';
import { formatPence } from '../engine/money';
import type { PremiumRule } from '../engine/types';
import { useProStore } from '../features/pro/proStore';
import { type BackupExportResult, exportBackupToShare } from '../services/backupShare';
import { useJobsStore } from '../store/jobsStore';
import { useRotaStore } from '../store/rotaStore';
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
const mockReadText = jest.fn(async (_uri: string) => '');
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///cache/' } },
  File: jest.fn().mockImplementation((uri: string) => ({ text: () => mockReadText(uri) })),
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
const mockGetDocument = DocumentPicker.getDocumentAsync as jest.MockedFunction<
  typeof DocumentPicker.getDocumentAsync
>;
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
  useProStore.setState({ status: 'free', source: 'unconfigured' });
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
    useProStore.setState({ status: 'pro', source: 'revenuecat' });
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

describe('Settings tab backup gating (free)', () => {
  beforeEach(() => {
    mockExport.mockReset();
    mockGetDocument.mockReset();
  });

  it('shows a Pro upsell instead of Export, and keeps Import available', async () => {
    await render(<SettingsScreen />);

    expect(screen.queryByRole('button', { name: 'Export backup' })).toBeNull();
    expect(screen.getByText('Backup to file — available with ShiftPay Pro')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'See ShiftPay Pro: Backup to file' }));
    expect(mockPush).toHaveBeenCalledWith('/paywall');
    expect(mockExport).not.toHaveBeenCalled();

    mockGetDocument.mockResolvedValueOnce({ canceled: true, assets: null });
    await fireEvent.press(screen.getByRole('button', { name: 'Import backup' }));
    await waitFor(() => expect(mockGetDocument).toHaveBeenCalledTimes(1));
  });

  it('treats loading as free', async () => {
    useProStore.setState({ status: 'loading', source: 'pending' });
    await render(<SettingsScreen />);
    expect(screen.queryByRole('button', { name: 'Export backup' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Import backup' })).toBeTruthy();
  });
});

describe('Settings tab backup import', () => {
  const FILE_URI = 'file:///cache/picked.json';
  const importButton = () => screen.getByRole('button', { name: 'Import backup' });
  const exportButton = () => screen.getByRole('button', { name: 'Export backup' });
  const disabled = (b: { props: { accessibilityState?: { disabled?: boolean } } }) =>
    b.props.accessibilityState?.disabled === true;
  let alert: jest.SpyInstance;

  /** The picked file: job "Depot" with a 1-on-1-off rota, exported 1 Nov 2026. */
  async function backupFile(): Promise<Backup> {
    const src = createTestDb();
    await createJob(src, { ...job, name: 'Depot' });
    await createShiftTemplate(src, {
      id: 'tpl-d',
      jobId: job.id,
      name: 'Day',
      startTime: '08:00',
      endTime: '16:00',
      unpaidBreakMinutes: 30,
    });
    await createRotaPattern(src, {
      id: 'pat-1',
      jobId: job.id,
      cycleLengthDays: 2,
      startDate: '2026-06-01',
      days: [{ shiftTemplateId: 'tpl-d' }, 'OFF'],
    });
    return exportBackup(src, '2026-11-01T09:30:00.000Z');
  }

  function pick(text: string): void {
    mockGetDocument.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: FILE_URI, name: 'picked.json', lastModified: 0 }],
    });
    mockReadText.mockResolvedValueOnce(text);
  }

  type DialogOptions = { onDismiss?: () => void };

  /** Waits for the confirm dialog and returns its buttons and options. */
  async function dialog(): Promise<{ buttons: AlertButton[]; options: DialogOptions }> {
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    const [, , buttons, options] = alert.mock.calls[0] as [
      string,
      string,
      AlertButton[],
      DialogOptions,
    ];
    return { buttons, options };
  }

  const pressButton = (buttons: AlertButton[], text: string) =>
    act(async () => buttons.find((b) => b.text === text)?.onPress?.());

  const dbTables = async () => (await exportBackup(db, '2026-01-01T00:00:00.000Z')).tables;

  beforeEach(async () => {
    mockGetDocument.mockReset();
    mockReadText.mockReset();
    alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    useProStore.setState({ status: 'pro', source: 'revenuecat' });
    await seed(job);
  });

  afterEach(async () => {
    alert.mockRestore();
    await importBackup(db, await exportBackup(createTestDb(), '2026-01-01T00:00:00.000Z'));
  });

  it('confirms, replaces all data and shows the restored data', async () => {
    const file = await backupFile();
    pick(JSON.stringify(file));
    await render(<SettingsScreen />);
    expect(screen.getByText('Warehouse')).toBeTruthy();

    await fireEvent.press(importButton());
    const { buttons } = await dialog();
    expect(mockGetDocument).toHaveBeenCalledWith({ type: '*/*', copyToCacheDirectory: true });
    expect(mockReadText).toHaveBeenCalledWith(FILE_URI);
    expect(alert.mock.calls[0][0]).toBe(RESTORE_CONFIRM_TITLE);
    expect(alert.mock.calls[0][1]).toBe(
      "The backup from 1 Nov 2026 will replace everything in the app. This can't be undone.",
    );
    expect(buttons.map((b) => [b.text, b.style])).toEqual([
      ['Cancel', 'cancel'],
      ['Replace', 'destructive'],
    ]);
    expect(disabled(importButton())).toBe(true);
    expect(disabled(exportButton())).toBe(true);

    await pressButton(buttons, 'Replace');
    await waitFor(() => expect(screen.getByText(RESTORE_DONE_MESSAGE)).toBeTruthy());
    expect(disabled(importButton())).toBe(false);
    expect(disabled(exportButton())).toBe(false);

    expect(screen.getByText('Depot')).toBeTruthy();
    expect(screen.getByText('1 on 1 off · 2-day cycle')).toBeTruthy();
    expect(await getJob(db, job.id)).toEqual({ ...job, name: 'Depot' });
    const tables = await dbTables();
    expect(tables.rotaPatterns).toEqual(file.tables.rotaPatterns);
    expect(tables.shifts.length).toBeGreaterThan(0);
    expect(useRotaStore.getState().patterns.map((p) => p.id)).toEqual(['pat-1']);
    expect(useShiftsStore.getState().shifts.some((s) => s.patternId === 'pat-1')).toBe(true);
  });

  it.each(['Cancel', 'dismiss'])('changes nothing when the dialog ends with %s', async (how) => {
    pick(JSON.stringify(await backupFile()));
    const before = await dbTables();
    await render(<SettingsScreen />);

    await fireEvent.press(importButton());
    const { buttons, options } = await dialog();
    if (how === 'Cancel') await pressButton(buttons, 'Cancel');
    else await act(async () => options.onDismiss?.());

    await waitFor(() => expect(disabled(importButton())).toBe(false));
    expect(await dbTables()).toEqual(before);
    expect(screen.getByText('Warehouse')).toBeTruthy();
    expect(screen.queryByText(RESTORE_DONE_MESSAGE)).toBeNull();
  });

  it('changes nothing and says nothing when the picker is cancelled', async () => {
    mockGetDocument.mockResolvedValueOnce({ canceled: true, assets: null });
    await render(<SettingsScreen />);

    await fireEvent.press(importButton());
    await waitFor(() => expect(mockGetDocument).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(disabled(importButton())).toBe(false));
    expect(alert).not.toHaveBeenCalled();
    expect(mockReadText).not.toHaveBeenCalled();
    expect(screen.queryByText(RESTORE_DONE_MESSAGE)).toBeNull();
  });

  const head = { app: 'shiftpay', formatVersion: 1, schemaVersion: SCHEMA_VERSION };
  it.each([
    ['not-shiftpay', { ...head, app: 'other' }],
    ['newer-format', { ...head, formatVersion: 2 }],
    ['newer-schema', { ...head, schemaVersion: SCHEMA_VERSION + 1 }],
    ['older-schema', { ...head, schemaVersion: SCHEMA_VERSION - 1 }],
    ['invalid', { ...head, exportedAt: '2026-11-01T09:30:00.000Z' }],
  ] as const)('shows the %s message and leaves the DB untouched', async (reason, file) => {
    pick(JSON.stringify(file));
    const before = await dbTables();
    await render(<SettingsScreen />);

    await fireEvent.press(importButton());
    await waitFor(() => expect(screen.getByText(RESTORE_REJECT_MESSAGES[reason])).toBeTruthy());
    expect(alert).not.toHaveBeenCalled();
    expect(disabled(importButton())).toBe(false);
    expect(await dbTables()).toEqual(before);
  });

  it('maps each reason to a plain message', () => {
    expect(RESTORE_REJECT_MESSAGES).toEqual({
      'not-shiftpay': "This file isn't a ShiftPay backup.",
      'newer-format':
        'This backup was made by a newer version of ShiftPay. Update the app and try again.',
      'newer-schema':
        'This backup was made by a newer version of ShiftPay. Update the app and try again.',
      invalid: 'This backup file is damaged or incomplete.',
      'older-schema': "This backup uses an older format that isn't supported yet.",
    });
  });

  it('treats a file that is not JSON as damaged', async () => {
    pick('{ not json');
    await render(<SettingsScreen />);
    await fireEvent.press(importButton());
    await waitFor(() => expect(screen.getByText(RESTORE_REJECT_MESSAGES.invalid)).toBeTruthy());
  });

  it('shows an error and re-enables the buttons when the file cannot be read', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockGetDocument.mockResolvedValueOnce({
        canceled: false,
        assets: [{ uri: FILE_URI, name: 'picked.json', lastModified: 0 }],
      });
      mockReadText.mockRejectedValueOnce(new Error('no access'));
      await render(<SettingsScreen />);

      await fireEvent.press(importButton());
      await waitFor(() => expect(screen.getByText(RESTORE_FAILED_MESSAGE)).toBeTruthy());
      expect(disabled(importButton())).toBe(false);
      expect(disabled(exportButton())).toBe(false);
      expect(warn).toHaveBeenCalledWith('Backup import failed.', expect.any(Error));
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
