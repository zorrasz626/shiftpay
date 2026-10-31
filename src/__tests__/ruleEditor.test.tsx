import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import HomeScreen from '../../app/(tabs)/index';
import RuleEditorScreen from '../../app/settings/rule/[id]';
import PayRulesScreen, { ruleSummary } from '../../app/settings/rules';
import { bankHolidays } from '../config/bankHolidays';
import { db } from '../db/client';
import { createJob, createPremiumRule, deleteJob, getPremiumRule } from '../db/jobRepo';
import { homeSummary } from '../engine/homeSummary';
import { formatPence } from '../engine/money';
import { RULE_FORM_MESSAGES } from '../engine/ruleForm';
import type { PremiumRule, PremiumRuleType } from '../engine/types';
import { useJobsStore } from '../store/jobsStore';
import { useRulesStore } from '../store/rulesStore';
import { useShiftsStore } from '../store/shiftsStore';
import { job, resetStores, shift } from '../store/testFixtures';
import { darkColors, lightColors } from '../theme/tokens';

jest.mock('../db/client', () => ({ db: require('../db/testDb').createTestDb() }));
const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: { id?: string; type?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => mockParams,
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
const MULTIPLIER_LABEL = 'Multiplier (× base rate)';
const FLAT_LABEL = 'Extra (£ an hour)';

const night: PremiumRule = {
  id: 'r-night',
  jobId: job.id,
  name: 'Night',
  stacking: 'highest_only',
  priority: 2,
  type: 'time_band',
  startTime: '22:00',
  endTime: '06:00',
  multiplier: 1.25,
};
const weekend: PremiumRule = {
  id: 'r-weekend',
  jobId: job.id,
  name: 'Weekend',
  stacking: 'stack',
  priority: 1,
  type: 'day_of_week',
  daysOfWeek: [0, 6],
  flatAddPencePerHour: 150,
};
const overtime: PremiumRule = {
  id: 'r-ot',
  jobId: job.id,
  name: 'Overtime',
  stacking: 'highest_only',
  priority: 0,
  type: 'overtime_weekly',
  thresholdHours: 39,
  weekStartsOn: 1,
  multiplier: 1.5,
};

async function seed(rules: PremiumRule[] = [night, weekend, overtime]): Promise<void> {
  await createJob(db, job);
  for (const r of rules) await createPremiumRule(db, r);
  await useJobsStore.getState().load(db);
  await useRulesStore.getState().load(db);
}

const button = (name: string) => screen.getByRole('button', { name });
const saveButton = () => button('Save');
const storedRule = (id: string) => useRulesStore.getState().rules.find((r) => r.id === id);

beforeEach(async () => {
  resetStores();
  await deleteJob(db, job.id);
  mockPush.mockClear();
  mockBack.mockClear();
  mockParams = {};
  mockScheme = 'light';
});

describe('ruleSummary', () => {
  it('describes each kind of rule in plain words', () => {
    expect(ruleSummary(night)).toBe('×1.25 · 22:00–06:00');
    expect(ruleSummary({ ...night, startTime: '00:00', endTime: '00:00' })).toBe('×1.25 · all day');
    expect(ruleSummary(weekend)).toBe('+£1.50/h · Sat, Sun');
    expect(ruleSummary({ ...weekend, daysOfWeek: [0] })).toBe('+£1.50/h · Sundays');
    expect(ruleSummary({ ...weekend, type: 'bank_holiday' } as PremiumRule)).toBe(
      '+£1.50/h · bank holidays',
    );
    expect(ruleSummary(overtime)).toBe('×1.5 after 39 h a week');
    expect(ruleSummary({ ...overtime, type: 'overtime_daily', thresholdHours: 8 })).toBe(
      '×1.5 after 8 h a day',
    );
    expect(ruleSummary({ ...overtime, type: 'overtime_period', thresholdHours: 160 })).toBe(
      '×1.5 after 160 h a pay period',
    );
  });
});

describe('Pay rules list', () => {
  it('groups the seeded rules and opens the editor', async () => {
    await seed();
    await render(<PayRulesScreen />);

    expect(screen.getByRole('header', { name: 'Premiums' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Overtime' })).toBeTruthy();
    expect(screen.getByText(/Estimates only/)).toBeTruthy();
    const nightRow = button('Night, ×1.25 · 22:00–06:00');
    expect(styleOf(nightRow).minHeight).toBe(48);
    expect(styleOf(screen.getByText('Night')).color).toBe(lightColors.ink);
    expect(button('Weekend, +£1.50/h · Sat, Sun')).toBeTruthy();
    expect(button('Overtime, ×1.5 after 39 h a week')).toBeTruthy();

    await fireEvent.press(nightRow);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/settings/rule/[id]', params: { id: 'r-night' } });

    await fireEvent.press(button('Add premium'));
    expect(screen.getByText('What does it depend on?')).toBeTruthy();
    await fireEvent.press(button('Day of the week'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/settings/rule/[id]',
      params: { id: 'new', type: 'day_of_week' },
    });
    expect(screen.queryByText('What does it depend on?')).toBeNull();

    await fireEvent.press(button('Add overtime rule'));
    await fireEvent.press(button('Cancel'));
    expect(screen.queryByText('Hours in a pay period')).toBeNull();

    await fireEvent.press(button('Back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('says when there are no rules, uses dark tokens, and handles no job', async () => {
    mockScheme = 'dark';
    await render(<PayRulesScreen />);
    expect(screen.getByText('No job set up yet.')).toBeTruthy();
    await screen.unmount();

    await seed([]);
    await render(<PayRulesScreen />);
    expect(screen.getByText('No premiums yet.')).toBeTruthy();
    expect(screen.getByText('No overtime rules yet.')).toBeTruthy();
    expect(styleOf(screen.getByText('No premiums yet.')).color).toBe(darkColors.inkMuted);
  });
});

describe('Rule editor', () => {
  it('edits the Night multiplier from 1.25 to 1.5 and saves it to the DB and the store', async () => {
    await seed();
    mockParams = { id: 'r-night' };
    await render(<RuleEditorScreen />);

    expect(screen.getByText('Edit premium')).toBeTruthy();
    expect(screen.getByLabelText(MULTIPLIER_LABEL).props.value).toBe('1.25');
    expect(screen.getByLabelText('Start time').props.value).toBe('22:00');
    await fireEvent.changeText(screen.getByLabelText(MULTIPLIER_LABEL), '1.5');
    await fireEvent.press(saveButton());

    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    const expected = { ...night, multiplier: 1.5 };
    expect(await getPremiumRule(db, night.id)).toEqual(expected);
    expect(storedRule(night.id)).toEqual(expected);
  });

  it('adds a flat-add Sunday rule stored in pence', async () => {
    await seed([]);
    mockParams = { id: 'new', type: 'day_of_week' };
    await render(<RuleEditorScreen />);

    expect(screen.getByText('Add premium')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete rule' })).toBeNull();
    expect(button('Sun').props.accessibilityState.selected).toBe(true);
    await fireEvent.press(button('Extra £ per hour'));
    expect(screen.queryByLabelText(MULTIPLIER_LABEL)).toBeNull();
    await fireEvent.changeText(screen.getByLabelText(FLAT_LABEL), '1.50');
    await fireEvent.press(saveButton());

    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    const saved = useRulesStore.getState().rules;
    expect(saved).toHaveLength(1);
    const added = saved[0] as PremiumRule;
    expect(added.id).toMatch(/^rule-/);
    expect(added).toEqual({
      id: added.id,
      jobId: job.id,
      name: 'Sunday',
      stacking: 'highest_only',
      priority: 0,
      type: 'day_of_week',
      daysOfWeek: [0],
      flatAddPencePerHour: 150,
    });
    expect(await getPremiumRule(db, added.id)).toEqual(added);
  });

  it('adds a rule of every type with its defaults', async () => {
    await seed([]);
    const types: [PremiumRuleType, string][] = [
      ['time_band', 'Add premium'],
      ['day_of_week', 'Add premium'],
      ['bank_holiday', 'Add premium'],
      ['overtime_daily', 'Add overtime rule'],
      ['overtime_weekly', 'Add overtime rule'],
      ['overtime_period', 'Add overtime rule'],
    ];
    for (const [type, title] of types) {
      mockParams = { id: 'new', type };
      await render(<RuleEditorScreen />);
      expect(screen.getByText(title)).toBeTruthy();
      if (type === 'overtime_weekly') {
        expect(screen.getByLabelText('Overtime after (hours in a week)').props.value).toBe('39');
        await fireEvent.press(button('Sun'));
      }
      await fireEvent.press(saveButton());
      await waitFor(() => expect(useRulesStore.getState().rules.some((r) => r.type === type)).toBe(true));
      await screen.unmount();
    }
    const rules = useRulesStore.getState().rules;
    expect(rules).toHaveLength(6);
    expect(rules.find((r) => r.type === 'overtime_weekly')).toMatchObject({
      thresholdHours: 39,
      weekStartsOn: 0,
    });
  });

  it('edits threshold and days, and hints that a same-time band is all day', async () => {
    await seed();
    mockParams = { id: 'r-ot' };
    await render(<RuleEditorScreen />);
    expect(screen.getByText('Edit overtime rule')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Overtime after (hours in a week)'), '37.5');
    await fireEvent.press(saveButton());
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(await getPremiumRule(db, overtime.id)).toEqual({ ...overtime, thresholdHours: 37.5 });
    await screen.unmount();

    mockParams = { id: 'r-weekend' };
    await render(<RuleEditorScreen />);
    expect(screen.getByLabelText(FLAT_LABEL).props.value).toBe('1.50');
    await fireEvent.press(button('Sat'));
    await fireEvent.press(button('Mon'));
    await fireEvent.press(saveButton());
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(2));
    expect(storedRule(weekend.id)).toEqual({ ...weekend, daysOfWeek: [0, 1] });
    await screen.unmount();

    mockParams = { id: 'r-night' };
    await render(<RuleEditorScreen />);
    expect(screen.getByText(/pass midnight/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('End time'), '22:00');
    expect(screen.getByText('Same start and end time: this rule applies all day.')).toBeTruthy();
    expect(saveButton().props.accessibilityState.disabled).toBe(false);
  });

  it('deletes a rule only after confirming', async () => {
    await seed();
    mockParams = { id: 'r-weekend' };
    await render(<RuleEditorScreen />);

    await fireEvent.press(button('Delete rule'));
    expect(screen.getByText('Delete this rule?')).toBeTruthy();
    await fireEvent.press(button('Cancel'));
    expect(screen.queryByText('Delete this rule?')).toBeNull();
    expect(storedRule(weekend.id)).toEqual(weekend);

    await fireEvent.press(button('Delete rule'));
    await fireEvent.press(button('Delete'));
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(await getPremiumRule(db, weekend.id)).toBeUndefined();
    expect(storedRule(weekend.id)).toBeUndefined();
    expect(useRulesStore.getState().rules).toHaveLength(2);
  });

  it('blocks Save and shows errors under the fields while a value is invalid', async () => {
    await seed();
    mockParams = { id: 'r-night' };
    await render(<RuleEditorScreen />);

    await fireEvent.changeText(screen.getByLabelText(MULTIPLIER_LABEL), '0');
    expect(screen.getByText(RULE_FORM_MESSAGES.multiplier)).toBeTruthy();
    expect(saveButton().props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(saveButton());
    await fireEvent.changeText(screen.getByLabelText(MULTIPLIER_LABEL), 'abc');
    expect(saveButton().props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByLabelText(MULTIPLIER_LABEL), '1.5');

    await fireEvent.changeText(screen.getByLabelText('Rule name'), ' ');
    expect(screen.getByText(RULE_FORM_MESSAGES.name)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Rule name'), 'Night');
    await fireEvent.changeText(screen.getByLabelText('Start time'), '25:00');
    expect(screen.getByText(RULE_FORM_MESSAGES.startTime)).toBeTruthy();
    expect(saveButton().props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(button('Back'));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(await getPremiumRule(db, night.id)).toEqual(night);
    await screen.unmount();

    mockParams = { id: 'r-weekend' };
    await render(<RuleEditorScreen />);
    await fireEvent.changeText(screen.getByLabelText(FLAT_LABEL), '0.333');
    expect(screen.getByText(RULE_FORM_MESSAGES.flat)).toBeTruthy();
    await fireEvent.press(button('Sat'));
    await fireEvent.press(button('Sun'));
    expect(screen.getByText(RULE_FORM_MESSAGES.daysOfWeek)).toBeTruthy();
    expect(saveButton().props.accessibilityState.disabled).toBe(true);
  });

  it('says when the rule is missing or the type is unknown', async () => {
    await seed();
    mockParams = { id: 'r-gone' };
    await render(<RuleEditorScreen />);
    expect(screen.getByText('Rule not found')).toBeTruthy();
    await screen.unmount();

    mockParams = { id: 'new', type: 'nonsense' };
    await render(<RuleEditorScreen />);
    expect(screen.getByText('This rule may have been deleted.')).toBeTruthy();
    await fireEvent.press(button('Back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('shows an error and stays open if saving fails', async () => {
    await seed();
    mockParams = { id: 'r-night' };
    const spy = jest
      .spyOn(useRulesStore.getState(), 'saveRule')
      .mockRejectedValueOnce(new Error('disk full'));
    useRulesStore.setState({ saveRule: useRulesStore.getState().saveRule });
    await render(<RuleEditorScreen />);
    await fireEvent.press(saveButton());
    expect(await screen.findByText("Your changes couldn't be saved. Try again.")).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
    expect(saveButton().props.accessibilityState.disabled).toBe(false);
    spy.mockRestore();
  });
});

describe('Rule edits recalculate Home', () => {
  it('projects the new total after the Night multiplier changes', async () => {
    jest.useFakeTimers({ now: new Date(NOW) });
    try {
      await seed([night]);
      // 22:00–06:00 BST nights, all inside the band.
      const nightShift = (date: string, next: string) =>
        shift(date, { start: `${date}T21:00:00.000Z`, end: `${next}T05:00:00.000Z` });
      const shifts = [nightShift('2026-06-15', '2026-06-16'), nightShift('2026-06-18', '2026-06-19')];
      useShiftsStore.setState({ shifts, loaded: true });

      const before = homeSummary({ shifts, job, rules: [night], bankHolidays, now: NOW });
      await render(<HomeScreen />);
      expect(
        screen.getByText(`Projected for this period ${formatPence(before.projectedPence)}`),
      ).toBeTruthy();
      await screen.unmount();

      mockParams = { id: 'r-night' };
      await render(<RuleEditorScreen />);
      await fireEvent.changeText(screen.getByLabelText(MULTIPLIER_LABEL), '1.5');
      await fireEvent.press(saveButton());
      await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
      await screen.unmount();

      const edited = { ...night, multiplier: 1.5 };
      const after = homeSummary({ shifts, job, rules: [edited], bankHolidays, now: NOW });
      expect(after.projectedPence).toBeGreaterThan(before.projectedPence);
      await render(<HomeScreen />);
      expect(
        screen.getByText(`Projected for this period ${formatPence(after.projectedPence)}`),
      ).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});
