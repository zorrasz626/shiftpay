import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import CalendarScreen from '../../app/(tabs)/calendar';
import { useJobsStore } from '../store/jobsStore';
import { useShiftsStore } from '../store/shiftsStore';
import { job, resetStores, shift } from '../store/testFixtures';
import { contrastRatio } from '../theme/contrast';
import { darkColors, lightColors, maxFontScale } from '../theme/tokens';

let mockScheme: 'light' | 'dark' = 'light';
// The day sheet imports the app db; expo-sqlite does not run in Jest.
jest.mock('../db/client', () => ({ db: require('../db/testDb').createTestDb() }));
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

const shifts = [
  shift('2026-05-15'),
  shift('2026-06-10'),
  // Tonight 19:00–07:00 BST.
  shift('2026-06-17', { start: '2026-06-17T18:00:00.000Z', end: '2026-06-18T06:00:00.000Z' }),
  shift('2026-06-19', { overtimeFlag: true }),
  shift('2026-06-20', { status: 'cancelled' }),
  shift('2026-06-22', { status: 'holiday' }),
  shift('2026-06-24', {
    id: 'a',
    start: '2026-06-24T05:00:00.000Z',
    end: '2026-06-24T09:00:00.000Z',
  }),
  shift('2026-06-24', {
    id: 'b',
    start: '2026-06-24T10:00:00.000Z',
    end: '2026-06-24T14:00:00.000Z',
  }),
  shift('2026-06-24', {
    id: 'c',
    start: '2026-06-24T15:00:00.000Z',
    end: '2026-06-24T17:00:00.000Z',
  }),
  shift('2026-07-03', { status: 'sick' }),
];

function seed(range: typeof RANGE | null = RANGE): void {
  useJobsStore.setState({ jobs: [job], loaded: true });
  useShiftsStore.setState({ shifts, range, loaded: true });
}

const cell = (date: string) => within(screen.getByTestId(`day-${date}`));
const title = (text: string) => screen.getByRole('header', { name: text });

beforeEach(() => {
  resetStores();
  mockScheme = 'light';
  jest.useFakeTimers({ now: new Date(NOW) });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Calendar screen', () => {
  it('shows the current month with shift codes on their start dates', async () => {
    seed();
    await render(<CalendarScreen />);

    expect(title('June 2026')).toBeTruthy();
    expect(screen.getByText('Mon')).toBeTruthy();
    expect(screen.getByText('Sun')).toBeTruthy();
    expect(cell('2026-06-10').getByText('D')).toBeTruthy();
    expect(cell('2026-06-17').getByText('N')).toBeTruthy();
    expect(cell('2026-06-18').queryByText('N')).toBeNull();
    expect(cell('2026-06-19').getByText('OT')).toBeTruthy();
    expect(cell('2026-06-20').getByText('X')).toBeTruthy();
    expect(cell('2026-06-22').getByText('H')).toBeTruthy();
    // Three shifts: two codes, then +1.
    expect(cell('2026-06-24').getAllByText('D')).toHaveLength(2);
    expect(cell('2026-06-24').getByText('+1')).toBeTruthy();
    expect(cell('2026-06-17').getByTestId('today-marker')).toBeTruthy();
    expect(screen.getAllByTestId('today-marker')).toHaveLength(1);
    expect(
      screen.getByLabelText('Wednesday 17 June, today, Night shift 19:00–07:00, planned'),
    ).toBeTruthy();
    // Padded July days belong to the grid but are muted.
    expect(styleOf(cell('2026-07-03').getByText('3')).color).toBe(lightColors.inkMuted);
    expect(cell('2026-07-03').getByText('S')).toBeTruthy();

    expect(within(screen.getByTestId('legend')).getByText('Night')).toBeTruthy();
    expect(within(screen.getByTestId('legend')).getByText('Bank holiday')).toBeTruthy();
    expect(screen.getByText(/Estimates only/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Today' })).toBeNull();
  });

  it('navigates to the next month, stops at the end of the loaded range and returns to today', async () => {
    seed();
    await render(<CalendarScreen />);

    await fireEvent.press(screen.getByLabelText('Next month'));
    expect(title('July 2026')).toBeTruthy();
    expect(screen.queryByTestId('day-2026-06-10')).toBeNull();
    expect(cell('2026-07-03').getByText('S')).toBeTruthy();
    expect(screen.queryAllByTestId('today-marker')).toHaveLength(0);
    expect(screen.getByLabelText('Next month')).toBeDisabled();
    expect(screen.getByLabelText('Previous month')).toBeEnabled();

    await fireEvent.press(screen.getByRole('button', { name: 'Today' }));
    expect(title('June 2026')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Today' })).toBeNull();
  });

  it('navigates to the previous month, marks bank holidays and stops at the range start', async () => {
    seed();
    await render(<CalendarScreen />);

    await fireEvent.press(screen.getByLabelText('Previous month'));
    expect(title('May 2026')).toBeTruthy();
    expect(cell('2026-05-15').getByText('D')).toBeTruthy();
    // Spring bank holiday, England and Wales.
    expect(cell('2026-05-25').getByText('BH')).toBeTruthy();
    expect(cell('2026-05-26').queryByText('BH')).toBeNull();
    expect(screen.getByLabelText('Monday 25 May, bank holiday, no shifts')).toBeTruthy();
    expect(screen.getByLabelText('Previous month')).toBeDisabled();
    expect(screen.getByLabelText('Next month')).toBeEnabled();
  });

  it('disables both directions before the shifts range is loaded', async () => {
    seed(null);
    await render(<CalendarScreen />);
    expect(screen.getByLabelText('Previous month')).toBeDisabled();
    expect(screen.getByLabelText('Next month')).toBeDisabled();
  });

  it('shows an empty state and the disclaimer before a job exists', async () => {
    await render(<CalendarScreen />);
    expect(screen.getByText('No job set up yet. Add one to see your shifts.')).toBeTruthy();
    expect(screen.getByText(/Estimates only/)).toBeTruthy();
    expect(screen.queryByText('June 2026')).toBeNull();
    expect(screen.queryByTestId('legend')).toBeNull();
  });

  it.each([
    ['light', lightColors],
    ['dark', darkColors],
  ] as const)('colours each kind with theme tokens in %s mode', async (scheme, colors) => {
    mockScheme = scheme;
    seed();
    await render(<CalendarScreen />);
    expect(styleOf(cell('2026-06-10').getByText('D')).color).toBe(colors.ink);
    expect(styleOf(cell('2026-06-17').getByText('N')).color).toBe(colors.night);
    expect(styleOf(cell('2026-06-22').getByText('H')).color).toBe(colors.positive);
    // Adjacent-month (July) codes are muted in the June grid; in-month they keep their colour.
    expect(styleOf(cell('2026-07-03').getByText('S')).color).toBe(colors.inkMuted);
    const cancelled = styleOf(cell('2026-06-20').getByText('X'));
    expect(cancelled.color).toBe(colors.inkMuted);
    expect(cancelled.textDecorationLine).toBe('line-through');
    const overtime = styleOf(cell('2026-06-19').getByText('OT'));
    expect(overtime.backgroundColor).toBe(colors.signal);
    expect(overtime.color).toBe(colors.onSignal);
    expect(styleOf(cell('2026-06-17').getByText('17')).color).toBe(colors.onSignal);
    expect(styleOf(cell('2026-06-10').getByText('10')).color).toBe(colors.ink);

    await fireEvent.press(screen.getByLabelText('Next month'));
    expect(styleOf(cell('2026-07-03').getByText('S')).color).toBe(colors.alert);
  });

  it.each([
    ['light', lightColors],
    ['dark', darkColors],
  ] as const)('mutes the whole adjacent-month cell in %s mode', async (scheme, colors) => {
    mockScheme = scheme;
    useJobsStore.setState({ jobs: [job], loaded: true });
    useShiftsStore.setState({
      shifts: [
        shift('2026-06-19', { overtimeFlag: true }),
        shift('2026-07-01', { overtimeFlag: true }),
        shift('2026-07-02', { status: 'cancelled' }),
        shift('2026-07-03', { status: 'holiday' }),
      ],
      range: RANGE,
      loaded: true,
    });
    await render(<CalendarScreen />);

    const overtime = styleOf(cell('2026-07-01').getByText('OT'));
    expect(overtime.color).toBe(colors.inkMuted);
    expect(overtime.backgroundColor).toBeUndefined();
    const cancelled = styleOf(cell('2026-07-02').getByText('X'));
    expect(cancelled.color).toBe(colors.inkMuted);
    expect(cancelled.textDecorationLine).toBe('line-through');
    expect(styleOf(cell('2026-07-03').getByText('H')).color).toBe(colors.inkMuted);
    expect(styleOf(cell('2026-07-01').getByText('1')).color).toBe(colors.inkMuted);
    // In-month look unchanged.
    const inMonth = styleOf(cell('2026-06-19').getByText('OT'));
    expect(inMonth.backgroundColor).toBe(colors.signal);
    expect(inMonth.color).toBe(colors.onSignal);
  });

  it.each([
    ['light', lightColors],
    ['dark', darkColors],
  ] as const)(
    'rings today in ink so the signal fill is not the only cue (%s)',
    async (scheme, colors) => {
      mockScheme = scheme;
      seed();
      await render(<CalendarScreen />);
      const marker = styleOf(screen.getByTestId('today-marker'));
      expect(marker.backgroundColor).toBe(colors.signal);
      expect(marker.borderColor).toBe(colors.ink);
      expect(marker.borderWidth).toBeGreaterThanOrEqual(2);
      expect(contrastRatio(colors.ink, colors.board)).toBeGreaterThanOrEqual(3);
    },
  );

  it('caps font scaling in the fixed-size grid but not in body text', async () => {
    seed();
    await render(<CalendarScreen />);
    const capped = [
      screen.getByText('Mon'),
      cell('2026-06-10').getByText('10'),
      cell('2026-06-10').getByText('D'),
      cell('2026-06-24').getByText('+1'),
    ];
    for (const el of capped) expect(el.props.maxFontSizeMultiplier).toBe(maxFontScale.cell);

    await fireEvent.press(screen.getByLabelText('Previous month'));
    expect(cell('2026-05-25').getByText('BH').props.maxFontSizeMultiplier).toBe(maxFontScale.cell);

    const body = [
      title('May 2026'),
      within(screen.getByTestId('legend')).getByText('Night'),
      screen.getByText(/Estimates only/),
    ];
    for (const el of body) {
      expect(el.props.maxFontSizeMultiplier).toBeUndefined();
      expect(el.props.allowFontScaling).not.toBe(false);
    }
  });
});
