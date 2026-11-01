import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import StatsScreen, { EMPTY_MESSAGE, statsMonths } from '../../app/stats';
import { bankHolidays } from '../config/bankHolidays';
import { db } from '../db/client';
import { createJob, deleteJob } from '../db/jobRepo';
import { createShift, type StoredShift } from '../db/shiftRepo';
import { formatPence } from '../engine/money';
import { monthlyStats } from '../engine/stats';
import type { PremiumRule } from '../engine/types';
import { formatHours } from '../features/pay/payView';
import { useProStore } from '../features/pro/proStore';
import { useJobsStore } from '../store/jobsStore';
import { useRulesStore } from '../store/rulesStore';
import { useShiftsStore } from '../store/shiftsStore';
import { job, resetStores, shift } from '../store/testFixtures';
import { darkColors, lightColors } from '../theme/tokens';

jest.mock('../db/client', () => ({ db: require('../db/testDb').createTestDb() }));
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
const colorOf = (el: StyleProps): unknown =>
  (StyleSheet.flatten(el.props.style as never) as Record<string, unknown> | undefined)?.color;

// Wed 17 Jun 2026, 13:00 BST. The store only holds June; earlier months come from the DB.
const NOW = '2026-06-17T12:00:00.000Z';
const STORE_RANGE = { start: '2026-06-01', end: '2026-06-30' };

const SHIFTS: StoredShift[] = [
  shift('2025-08-12', { status: 'worked' }), // in the last 12 months only
  shift('2026-03-10', { status: 'worked' }),
  shift('2026-04-14', { status: 'worked' }),
  shift('2026-05-05', { status: 'worked' }),
  shift('2026-05-06', { status: 'worked' }),
  shift('2026-05-07', { status: 'worked' }),
  // Night 19:00–07:00 BST on Monday: night premium; the next days push the week past 20 h (weekly OT).
  shift('2026-05-04', { start: '2026-05-04T18:00:00.000Z', end: '2026-05-05T06:00:00.000Z' }),
  shift('2026-06-02', { status: 'worked' }),
  shift('2026-06-30'), // not ended yet: not counted
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

const expected = (from: string, to: string) =>
  monthlyStats({ shifts: SHIFTS, job, rules, bankHolidays, from, to, now: NOW });

async function seed(shifts: StoredShift[] = SHIFTS): Promise<void> {
  await createJob(db, job);
  for (const s of shifts) await createShift(db, s);
  useJobsStore.setState({ jobs: [job], loaded: true });
  useRulesStore.setState({ rules, loaded: true });
  await useShiftsStore.getState().load(db, STORE_RANGE);
}

const monthLabels = () =>
  screen.getAllByTestId('bar').map((b) => b.props.accessibilityLabel as string);

beforeEach(async () => {
  resetStores();
  useProStore.setState(useProStore.getInitialState(), true);
  await deleteJob(db, job.id); // cascades shifts
  mockPush.mockClear();
  mockBack.mockClear();
  mockScheme = 'light';
  jest.useFakeTimers({ now: new Date(NOW) });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('statsMonths', () => {
  it('ends in the current month', () => {
    expect(statsMonths('last6', '2026-06-17')).toEqual({ from: '2026-01', to: '2026-06' });
    expect(statsMonths('last12', '2026-06-17')).toEqual({ from: '2025-07', to: '2026-06' });
    expect(statsMonths('taxYear', '2026-06-17')).toEqual({ from: '2026-04', to: '2026-06' });
    expect(statsMonths('taxYear', '2026-04-05')).toEqual({ from: '2026-04', to: '2026-04' });
    expect(statsMonths('taxYear', '2026-03-31')).toEqual({ from: '2025-04', to: '2026-03' });
    expect(statsMonths('taxYear', '2026-04-06')).toEqual({ from: '2026-04', to: '2026-04' });
    expect(statsMonths('last6', '2026-02-01')).toEqual({ from: '2025-09', to: '2026-02' });
  });
});

describe('Stats screen', () => {
  beforeEach(() => {
    useProStore.setState({ status: 'pro', source: 'revenuecat' });
  });

  it('Pro: totals, months with accessible bars, and premiums by rule (last 6 months)', async () => {
    await seed();
    const stats = expected('2026-01', '2026-06');
    expect(stats.totals.premiumPence).toBeGreaterThan(0);
    expect(stats.totals.overtimeHours).toBeGreaterThan(0);

    await render(<StatsScreen />);

    expect(await screen.findByText('Totals')).toBeTruthy();
    expect(screen.getByLabelText(formatPence(stats.totals.grossPence))).toBeTruthy();
    expect(screen.getByText('Earned, January 2026 – June 2026')).toBeTruthy();
    expect(
      within(screen.getByTestId('total-ot-hours')).getByText(
        formatHours(stats.totals.overtimeHours),
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId('total-ot-pay')).getByText(formatPence(stats.totals.overtimePence)),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId('total-premiums')).getByText(
        formatPence(stats.totals.premiumPence),
      ),
    ).toBeTruthy();

    const earnings = within(screen.getByTestId('earnings-chart')).getAllByTestId('bar');
    expect(earnings.map((b) => b.props.accessibilityLabel)).toEqual(
      stats.months.map(
        (m, i) =>
          `${['January', 'February', 'March', 'April', 'May', 'June'][i]} 2026, ${formatPence(m.grossPence)}`,
      ),
    );
    expect(within(earnings[2]).getByText('Mar 2026')).toBeTruthy();
    const overtime = within(screen.getByTestId('overtime-chart')).getAllByTestId('bar');
    expect(overtime[4].props.accessibilityLabel).toBe(
      `May 2026, ${formatHours(stats.months[4].overtimeHours)}`,
    );

    const ruleRows = screen.getAllByTestId('rule-row');
    expect(ruleRows).toHaveLength(stats.totals.byRule.length);
    stats.totals.byRule.forEach((r, i) => {
      expect(within(ruleRows[i]).getByText(r.ruleName)).toBeTruthy();
      expect(within(ruleRows[i]).getByText(formatPence(r.pence))).toBeTruthy();
    });
    expect(screen.getByText('Night')).toBeTruthy();
    expect(screen.getByText(/Estimates only/)).toBeTruthy();
  });

  it('range chips change the months shown', async () => {
    await seed();
    await render(<StatsScreen />);
    await screen.findByText('Totals');
    expect(monthLabels()).toHaveLength(12); // 6 earnings + 6 overtime

    await fireEvent.press(screen.getByText('Last 12 months'));
    await screen.findByText('Earned, July 2025 – June 2026');
    const twelve = expected('2025-07', '2026-06');
    const earnings = within(screen.getByTestId('earnings-chart')).getAllByTestId('bar');
    expect(earnings).toHaveLength(12);
    expect(earnings[1].props.accessibilityLabel).toBe(
      `August 2025, ${formatPence(twelve.months[1].grossPence)}`,
    );
    expect(twelve.months[1].grossPence).toBeGreaterThan(0);
    expect(screen.getByLabelText(formatPence(twelve.totals.grossPence))).toBeTruthy();

    await fireEvent.press(screen.getByText('Since April'));
    await screen.findByText('Earned, April 2026 – June 2026');
    expect(
      within(screen.getByTestId('earnings-chart'))
        .getAllByTestId('bar')
        .map((b) => b.props.accessibilityLabel),
    ).toEqual(
      expected('2026-04', '2026-06').months.map((m) =>
        expect.stringContaining(formatPence(m.grossPence)),
      ),
    );
  });

  it('works with a single bar', async () => {
    jest.setSystemTime(new Date('2026-04-20T12:00:00.000Z'));
    await seed();
    await render(<StatsScreen />);
    await fireEvent.press(await screen.findByText('Since April'));
    await screen.findByText('Earned, April 2026 – April 2026');
    expect(within(screen.getByTestId('earnings-chart')).getAllByTestId('bar')).toHaveLength(1);
  });

  it('empty state when nothing was earned', async () => {
    await seed([shift('2026-06-30')]);
    await render(<StatsScreen />);
    expect(await screen.findByText(EMPTY_MESSAGE)).toBeTruthy();
    expect(screen.queryByTestId('bar')).toBeNull();
    expect(screen.getByText(/Estimates only/)).toBeTruthy();
  });

  it('no job: says so', async () => {
    await render(<StatsScreen />);
    expect(screen.getByText(/No job set up yet/)).toBeTruthy();
  });

  it('back goes back', async () => {
    await seed();
    await render(<StatsScreen />);
    await fireEvent.press(screen.getByText('Back'));
    expect(mockBack).toHaveBeenCalled();
  });

  it.each([
    ['light', lightColors],
    ['dark', darkColors],
  ] as const)('bar values use the %s ink', async (scheme, colors) => {
    mockScheme = scheme;
    await seed();
    await render(<StatsScreen />);
    await screen.findByText('Totals');
    const value = screen.getAllByTestId('bar-value')[0];
    expect(colorOf(value)).toBe(colors.ink);
    const fill = StyleSheet.flatten(screen.getAllByTestId('bar-fill')[0].props.style) as Record<
      string,
      unknown
    >;
    expect(fill.backgroundColor).toBe(colors.signal);
  });
});

describe('Stats screen (free)', () => {
  it('shows the upsell and no data', async () => {
    useProStore.setState({ status: 'free', source: 'unconfigured' });
    await seed();
    await render(<StatsScreen />);
    expect(screen.getByTestId('pro-upsell')).toBeTruthy();
    expect(screen.queryByText('Totals')).toBeNull();
    expect(screen.queryByTestId('bar')).toBeNull();
    await fireEvent.press(screen.getByText('See Pro'));
    expect(mockPush).toHaveBeenCalledWith('/paywall');
  });
});
