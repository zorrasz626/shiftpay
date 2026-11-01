import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import type { CustomerInfo, PurchasesOfferings } from 'react-native-purchases';
import type { TestInstance } from 'test-renderer';

import CalendarScreen from '../../app/(tabs)/calendar';
import HomeScreen from '../../app/(tabs)/index';
import PayScreen from '../../app/(tabs)/pay';
import SettingsScreen from '../../app/(tabs)/settings';
import { PaywallView } from '../../app/paywall';
import PeriodDetailScreen from '../../app/period/[start]';
import AboutScreen from '../../app/settings/about';
import ReminderSettingsScreen from '../../app/settings/reminders';
import PayRulesScreen from '../../app/settings/rules';
import TaxSettingsScreen from '../../app/settings/tax';
import { db } from '../db/client';
import { createJob, deleteJob } from '../db/jobRepo';
import { createShift } from '../db/shiftRepo';
import type { PremiumRule } from '../engine/types';
import { fullOffering } from '../features/pro/paywallTestFixtures';
import { useProStore } from '../features/pro/proStore';
import type { PurchasesClient } from '../features/pro/purchases';
import { useJobsStore } from '../store/jobsStore';
import { useRulesStore } from '../store/rulesStore';
import { useShiftsStore } from '../store/shiftsStore';
import { job, resetStores, shift } from '../store/testFixtures';

jest.mock('../db/client', () => ({ db: require('../db/testDb').createTestDb() }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({ start: '2026-06-15' }),
}));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.0.0' } } }));
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
}));

// Wed 17 Jun 2026, 13:00 BST.
const NOW = '2026-06-17T12:00:00.000Z';
const RANGE = { start: '2026-05-10', end: '2026-07-20' };
const SHIFTS = [
  shift('2026-06-15', { status: 'worked' }),
  shift('2026-06-16', { status: 'worked' }),
  shift('2026-06-17', { start: '2026-06-17T18:00:00.000Z', end: '2026-06-18T06:00:00.000Z' }),
  shift('2026-06-18', { id: 'p-1', source: 'pattern' }),
  shift('2026-06-19'),
];
const RULES: PremiumRule[] = [
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

/** Host props that make a node operable: Pressable/Text press, Switch, TextInput. */
const HANDLERS = ['onClick', 'onPress', 'onChange', 'onValueChange', 'onChangeText'] as const;

const isInteractive = (node: TestInstance): boolean =>
  HANDLERS.some((h) => typeof node.props[h] === 'function');

/** Explicit role; a native TextInput is announced as an edit box by TalkBack without one. */
function roleOf(node: TestInstance): string | undefined {
  const role = (node.props.role ?? node.props.accessibilityRole) as string | undefined;
  if (role !== undefined && role !== 'none') return role;
  return node.type === 'TextInput' ? 'textbox' : undefined;
}

function textOf(node: TestInstance | string): string {
  if (typeof node === 'string') return node;
  return node.children.map((c) => textOf(c as TestInstance | string)).join('');
}

function nameOf(node: TestInstance): string {
  const label = (node.props['aria-label'] ?? node.props.accessibilityLabel) as string | undefined;
  return (label ?? textOf(node)).trim();
}

function walk(node: TestInstance, out: TestInstance[]): TestInstance[] {
  if (isInteractive(node)) out.push(node);
  for (const c of node.children) if (typeof c !== 'string') walk(c as TestInstance, out);
  return out;
}

/** A name made only of symbols ("‹", "×", "+") tells a screen-reader user nothing. */
const hasWords = (name: string): boolean => /[\p{L}\p{N}]/u.test(name);

/** Every operable node under `root`, plus the offenders as `<type> role=<role> name=<name>`. */
function audit(root: TestInstance = screen.container): { count: number; unlabelled: string[] } {
  const nodes = walk(root, []);
  const unlabelled = nodes
    .filter((n) => roleOf(n) === undefined || !hasWords(nameOf(n)))
    .map((n) => `${String(n.type)} role=${String(roleOf(n))} name="${nameOf(n)}"`);
  return { count: nodes.length, unlabelled };
}

function seedStores(): void {
  useJobsStore.setState({ jobs: [job], loaded: true });
  useShiftsStore.setState({ shifts: SHIFTS, range: RANGE, loaded: true });
  useRulesStore.setState({ rules: RULES, loaded: true });
}

function fakeClient(): PurchasesClient {
  const info = { entitlements: { active: {}, all: {} } } as unknown as CustomerInfo;
  const offerings = { current: fullOffering(), all: {} } as unknown as PurchasesOfferings;
  return {
    configure: jest.fn(),
    getCustomerInfo: jest.fn(async () => info),
    addCustomerInfoUpdateListener: jest.fn(() => () => {}),
    getOfferings: jest.fn(async () => offerings),
    purchasePackage: jest.fn(),
    restorePurchases: jest.fn(async () => info),
  } as unknown as PurchasesClient;
}

beforeEach(async () => {
  resetStores();
  await deleteJob(db, job.id);
  useProStore.setState({ status: 'pro', source: 'revenuecat' });
  jest.useFakeTimers({ now: new Date(NOW) });
});

afterEach(() => {
  jest.useRealTimers();
});

const SCREENS: [string, () => ReactElement][] = [
  ['Home', () => <HomeScreen />],
  ['Calendar', () => <CalendarScreen />],
  ['Pay', () => <PayScreen />],
  ['Period detail', () => <PeriodDetailScreen />],
  ['Settings', () => <SettingsScreen />],
  ['About', () => <AboutScreen />],
  ['Reminders', () => <ReminderSettingsScreen />],
  ['Pay rules', () => <PayRulesScreen />],
  ['Tax', () => <TaxSettingsScreen />],
];

describe('No unlabelled touchables', () => {
  it.each(SCREENS)('%s: every operable element has a role and a name', async (_name, el) => {
    seedStores();
    await render(el());
    const { count, unlabelled } = audit();
    expect(count).toBeGreaterThan(0);
    expect(unlabelled).toEqual([]);
  });

  it('Paywall: every operable element has a role and a name', async () => {
    useProStore.setState({ status: 'loading', source: 'pending' });
    const client = fakeClient();
    await useProStore.getState().init(client, { apiKey: 'test_key', isDev: false });
    await render(<PaywallView client={client} apiKey="test_key" />);
    await screen.findByRole('radio', { name: /^Annual/ });
    const { count, unlabelled } = audit();
    expect(count).toBeGreaterThan(0);
    expect(unlabelled).toEqual([]);
  });

  it('Day sheet: every operable element has a role and a name', async () => {
    await createJob(db, job);
    for (const s of SHIFTS) await createShift(db, s);
    useJobsStore.setState({ jobs: [job], loaded: true });
    await useShiftsStore.getState().load(db, RANGE);
    await render(<CalendarScreen />);
    await fireEvent.press(screen.getByTestId('day-2026-06-18'));
    const { count, unlabelled } = audit(screen.getByTestId('day-sheet'));
    expect(count).toBeGreaterThan(0);
    expect(unlabelled).toEqual([]);
  });

  it('Calendar day cells expose today and the open day as state', async () => {
    seedStores();
    await render(<CalendarScreen />);
    const today = screen.getByTestId('day-2026-06-17');
    expect(today).toHaveAccessibleName(/^Wednesday 17 June, today/);
    expect(screen.getByTestId('day-2026-06-18')).not.toBeSelected();
    await fireEvent.press(screen.getByTestId('day-2026-06-18'));
    expect(screen.getByTestId('day-2026-06-18')).toBeSelected();
  });
});
