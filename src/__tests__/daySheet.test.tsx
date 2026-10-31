import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import CalendarScreen from '../../app/(tabs)/calendar';
import { db } from '../db/client';
import { createJob, deleteJob } from '../db/jobRepo';
import { createShiftTemplate } from '../db/rotaRepo';
import { type StoredShift, createShift, getShift, listShifts } from '../db/shiftRepo';
import { MANUAL_SHIFT_MESSAGES } from '../engine/manualShift';
import { daySheetTitle } from '../features/calendar/DaySheet';
import { useJobsStore } from '../store/jobsStore';
import { useShiftsStore } from '../store/shiftsStore';
import { job, resetStores, shift } from '../store/testFixtures';
import { darkColors, lightColors, spacing } from '../theme/tokens';

jest.mock('../db/client', () => ({ db: require('../db/testDb').createTestDb() }));
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

// Wed 17 Jun 2026, 13:00 BST.
const NOW = '2026-06-17T12:00:00.000Z';
const RANGE = { start: '2026-05-10', end: '2026-07-20' };

// Thu 18 Jun, 08:00–16:00 BST, from the rota.
const PATTERN = shift('2026-06-18', {
  id: 'p-1',
  start: '2026-06-18T07:00:00.000Z',
  end: '2026-06-18T15:00:00.000Z',
  source: 'pattern',
});
// Fri 19 Jun, 10:00–14:00 BST, added by hand.
const MANUAL = shift('2026-06-19', {
  id: 'm-1',
  start: '2026-06-19T09:00:00.000Z',
  end: '2026-06-19T13:00:00.000Z',
  unpaidBreakMinutes: 0,
});

let presses = 0;
async function press(el: Parameters<typeof fireEvent.press>[0]): Promise<void> {
  presses += 1;
  await fireEvent.press(el);
}

async function seed(opts: { template?: boolean } = {}): Promise<void> {
  await createJob(db, job);
  await createShift(db, PATTERN);
  await createShift(db, MANUAL);
  if (opts.template) {
    await createShiftTemplate(db, {
      id: 't-1',
      jobId: job.id,
      name: 'Early',
      startTime: '07:00',
      endTime: '15:00',
      unpaidBreakMinutes: 30,
    });
  }
  useJobsStore.setState({ jobs: [job], loaded: true });
  await useShiftsStore.getState().load(db, RANGE);
}

const dbShift = async (id: string): Promise<StoredShift | undefined> => getShift(db, id);
const storeShift = (id: string) => useShiftsStore.getState().shifts.find((s) => s.id === id);
const card = (id: string) => within(screen.getByTestId(`shift-${id}`));
const cell = (date: string) => within(screen.getByTestId(`day-${date}`));

async function openDay(date: string): Promise<void> {
  await press(screen.getByTestId(`day-${date}`));
  expect(screen.getByRole('header', { name: daySheetTitle(date) })).toBeTruthy();
}

beforeEach(async () => {
  resetStores();
  await deleteJob(db, job.id); // cascades shifts and templates
  presses = 0;
  mockScheme = 'light';
  jest.useFakeTimers({ now: new Date(NOW) });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Day sheet', () => {
  it('formats the title as a short London date', () => {
    expect(daySheetTitle('2026-10-25')).toBe('Sun 25 Oct');
    expect(daySheetTitle('2026-06-18')).toBe('Thu 18 Jun');
  });

  it('marks a shift worked in two taps from the calendar and saves it', async () => {
    await seed();
    await render(<CalendarScreen />);

    await openDay('2026-06-18');
    await press(card('p-1').getByRole('button', { name: 'Worked' }));
    await waitFor(() => expect(storeShift('p-1')?.status).toBe('worked'));
    expect(presses).toBe(2);
    expect((await dbShift('p-1'))?.status).toBe('worked');
    expect((await dbShift('p-1'))?.userModified).toBe(true);
    expect(card('p-1').getByText('08:00–16:00')).toBeTruthy();
    expect(card('p-1').getByRole('button', { name: 'Worked' })).toBeSelected();
    expect(within(screen.getByTestId('day-sheet')).getByText(/Estimates only/)).toBeTruthy();
  });

  it('pads the sheet bottom by the safe-area inset so the disclaimer clears the gesture bar', async () => {
    await seed();
    await render(
      <SafeAreaInsetsContext.Provider value={{ top: 0, right: 0, bottom: 24, left: 0 }}>
        <CalendarScreen />
      </SafeAreaInsetsContext.Provider>,
    );
    await openDay('2026-06-18');
    expect(styleOf(screen.getByTestId('day-sheet')).paddingBottom).toBe(spacing.lg + 24);
  });

  it('sets sick, holiday and cancelled; a pattern shift has no delete', async () => {
    await seed();
    await render(<CalendarScreen />);
    await openDay('2026-06-18');

    expect(card('p-1').getByText('Planned')).toBeTruthy();
    expect(card('p-1').queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(card('p-1').queryByRole('button', { name: 'Edit' })).toBeNull();

    for (const [label, status] of [
      ['Sick', 'sick'],
      ['Holiday', 'holiday'],
      ['Cancel shift', 'cancelled'],
    ] as const) {
      await press(card('p-1').getByRole('button', { name: label }));
      await waitFor(() => expect(storeShift('p-1')?.status).toBe(status));
      expect((await dbShift('p-1'))?.status).toBe(status);
    }
    expect(card('p-1').getByText('Cancelled')).toBeTruthy();

    // Tapping the current status again restores planned.
    await press(card('p-1').getByRole('button', { name: 'Cancel shift' }));
    await waitFor(() => expect(storeShift('p-1')?.status).toBe('planned'));

    await press(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('day-sheet')).toBeNull();
    expect(await dbShift('p-1')).toBeDefined();
  });

  it('toggles overtime and shows it on the calendar', async () => {
    await seed();
    await render(<CalendarScreen />);
    await openDay('2026-06-18');

    const toggle = card('p-1').getByRole('switch', { name: 'Overtime' });
    expect(toggle).not.toBeChecked();
    await press(toggle);
    await waitFor(() => expect(storeShift('p-1')?.overtimeFlag).toBe(true));
    expect((await dbShift('p-1'))?.overtimeFlag).toBe(true);
    expect(card('p-1').getByRole('switch', { name: 'Overtime' })).toBeChecked();

    await press(screen.getByRole('button', { name: 'Close' }));
    expect(cell('2026-06-18').getByText('OT')).toBeTruthy();
  });

  it('adds an overnight manual shift that appears on the calendar', async () => {
    await seed({ template: true });
    await render(<CalendarScreen />);
    await openDay('2026-06-23');
    expect(screen.getByText('No shifts on this day.')).toBeTruthy();

    await press(screen.getByRole('button', { name: 'Add shift' }));
    // Defaults from the job's first rota template.
    const start = await screen.findByLabelText('Start time');
    expect(start.props.value).toBe('07:00');
    expect(screen.getByLabelText('End time').props.value).toBe('15:00');
    expect(screen.getByLabelText('Unpaid break (minutes)').props.value).toBe('30');

    await fireEvent.changeText(start, '19:00');
    await fireEvent.changeText(screen.getByLabelText('End time'), '07:00');
    expect(screen.getByText('Ends the next day')).toBeTruthy();
    await press(screen.getByRole('button', { name: 'Save shift' }));

    await waitFor(() => expect(screen.queryByTestId('manual-shift-form')).toBeNull());
    const saved = (await listShifts(db, '2026-06-23', '2026-06-23'))[0];
    expect(saved).toMatchObject({
      date: '2026-06-23',
      start: '2026-06-23T18:00:00.000Z',
      end: '2026-06-24T06:00:00.000Z',
      unpaidBreakMinutes: 30,
      source: 'manual',
      status: 'planned',
      overtimeFlag: false,
    });
    expect(card(saved.id).getByText('19:00–07:00')).toBeTruthy();

    await press(screen.getByRole('button', { name: 'Close' }));
    expect(cell('2026-06-23').getByText('N')).toBeTruthy();
    expect(cell('2026-06-24').queryByText('N')).toBeNull();
  });

  it('defaults to 09:00–17:00 with no break without a rota template', async () => {
    await seed();
    await render(<CalendarScreen />);
    await openDay('2026-06-23');
    await press(screen.getByRole('button', { name: 'Add shift' }));

    expect((await screen.findByLabelText('Start time')).props.value).toBe('09:00');
    expect(screen.getByLabelText('End time').props.value).toBe('17:00');
    expect(screen.getByLabelText('Unpaid break (minutes)').props.value).toBe('0');

    await press(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('No shifts on this day.')).toBeTruthy();
    expect(await listShifts(db, '2026-06-23', '2026-06-23')).toHaveLength(0);
  });

  it('edits and deletes a manual shift', async () => {
    await seed();
    await render(<CalendarScreen />);
    await openDay('2026-06-19');

    await press(card('m-1').getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Start time').props.value).toBe('10:00');
    expect(screen.getByLabelText('End time').props.value).toBe('14:00');
    await fireEvent.changeText(screen.getByLabelText('End time'), '15:30');
    await fireEvent.changeText(screen.getByLabelText('Unpaid break (minutes)'), '15');
    await press(screen.getByRole('button', { name: 'Save shift' }));

    await waitFor(() => expect(storeShift('m-1')?.end).toBe('2026-06-19T14:30:00.000Z'));
    expect(await dbShift('m-1')).toMatchObject({
      start: '2026-06-19T09:00:00.000Z',
      end: '2026-06-19T14:30:00.000Z',
      unpaidBreakMinutes: 15,
      userModified: true,
    });
    expect(card('m-1').getByText('10:00–15:30')).toBeTruthy();

    await press(card('m-1').getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(storeShift('m-1')).toBeUndefined());
    expect(await dbShift('m-1')).toBeUndefined();
    expect(screen.getByText('No shifts on this day.')).toBeTruthy();
    await press(screen.getByRole('button', { name: 'Close' }));
    expect(cell('2026-06-19').queryByText('D')).toBeNull();
  });

  it('shows validation errors and disables save for bad input', async () => {
    await seed();
    await render(<CalendarScreen />);
    await openDay('2026-06-19');
    await press(card('m-1').getByRole('button', { name: 'Edit' }));

    const save = screen.getByRole('button', { name: 'Save shift' });
    expect(save).toBeEnabled();
    await fireEvent.changeText(screen.getByLabelText('Start time'), '25:00');
    expect(screen.getByText(MANUAL_SHIFT_MESSAGES.startTime)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save shift' })).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText('Start time'), '10:00');
    await fireEvent.changeText(screen.getByLabelText('Unpaid break (minutes)'), 'abc');
    expect(screen.getByText(MANUAL_SHIFT_MESSAGES.breakNotWhole)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Unpaid break (minutes)'), '240');
    expect(screen.getByText(MANUAL_SHIFT_MESSAGES.breakTooLong)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save shift' })).toBeDisabled();

    await press(screen.getByRole('button', { name: 'Save shift' }));
    expect((await dbShift('m-1'))?.unpaidBreakMinutes).toBe(0);
  });

  it.each([
    ['light', lightColors],
    ['dark', darkColors],
  ] as const)('uses theme tokens for the selected status in %s mode', async (scheme, colors) => {
    mockScheme = scheme;
    await seed();
    await render(<CalendarScreen />);
    await openDay('2026-06-18');
    await press(card('p-1').getByRole('button', { name: 'Worked' }));
    await waitFor(() => expect(storeShift('p-1')?.status).toBe('worked'));

    const worked = card('p-1').getByRole('button', { name: 'Worked' });
    expect(styleOf(worked).backgroundColor).toBe(colors.signal);
    expect(styleOf(worked).minHeight).toBe(48);
    expect(styleOf(card('p-1').getByRole('button', { name: 'Sick' })).backgroundColor).toBe(
      colors.surface,
    );
    expect(styleOf(screen.getByTestId('day-sheet')).backgroundColor).toBe(colors.surface);
  });
});
