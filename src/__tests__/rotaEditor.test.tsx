import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import SettingsScreen from '../../app/(tabs)/settings';
import RotaScreen from '../../app/settings/rota';
import TemplateEditorScreen, { TEMPLATE_IN_USE_MESSAGE } from '../../app/settings/template/[id]';
import { db } from '../db/client';
import { createJob, deleteJob } from '../db/jobRepo';
import {
  type StoredShiftTemplate,
  createRotaPattern,
  createShiftTemplate,
  getRotaPattern,
  getShiftTemplate,
} from '../db/rotaRepo';
import { getShift, updateShift } from '../db/shiftRepo';
import { ROTA_FORM_MESSAGES, nextOccurrences } from '../engine/rotaForm';
import { instantToLocal } from '../engine/time';
import type { RotaPattern } from '../engine/types';
import { formatDayDate } from '../features/home/homeView';
import { materialiseShifts, materialiseWindow } from '../services/materialise';
import { useJobsStore } from '../store/jobsStore';
import { useRotaStore } from '../store/rotaStore';
import { useShiftsStore } from '../store/shiftsStore';
import { job, resetStores } from '../store/testFixtures';
import { darkColors, lightColors } from '../theme/tokens';

jest.mock('../db/client', () => ({ db: require('../db/testDb').createTestDb() }));
const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: { id?: string } = {};
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

// Wed 4 Nov 2026, 12:00 GMT.
const NOW = '2026-11-04T12:00:00.000Z';
const TODAY = '2026-11-04';

const dayShift: StoredShiftTemplate = {
  id: 'tpl-d',
  jobId: job.id,
  name: 'Day',
  startTime: '08:00',
  endTime: '16:00',
  unpaidBreakMinutes: 30,
};
const late: StoredShiftTemplate = {
  ...dayShift,
  id: 'tpl-l',
  name: 'Late',
  startTime: '14:00',
  endTime: '22:00',
};

/** Sun 1 Nov = day 1. Day, Day, Off, Off: shifts on 1, 2, 5, 6, 9, 10 Nov… */
const pattern: RotaPattern = {
  id: 'pat-1',
  jobId: job.id,
  cycleLengthDays: 4,
  startDate: '2026-11-01',
  days: [{ shiftTemplateId: 'tpl-d' }, { shiftTemplateId: 'tpl-d' }, 'OFF', 'OFF'],
};

const shiftId = (date: string) => `pat-1:${date}`;
const storeShift = (date: string) =>
  useShiftsStore.getState().shifts.find((s) => s.id === shiftId(date));

async function seed(withPattern = true): Promise<void> {
  await createJob(db, job);
  await createShiftTemplate(db, dayShift);
  await createShiftTemplate(db, late);
  if (withPattern) await createRotaPattern(db, pattern);
  await materialiseShifts(db, TODAY);
  // 10 Nov (cycle day 2) is marked sick: an edit the rota must not touch.
  const edited = await getShift(db, shiftId('2026-11-10'));
  if (edited) await updateShift(db, { ...edited, status: 'sick', userModified: true });
  await useJobsStore.getState().load(db);
  await useRotaStore.getState().load(db);
  await useShiftsStore.getState().load(db, materialiseWindow(TODAY));
}

const button = (name: string) => screen.getByRole('button', { name });
const disabled = (name: string) => button(name).props.accessibilityState.disabled;
const dayChip = (i: number, name: string) =>
  within(screen.getByTestId(`rota-day-${i}`)).getByRole('button', { name });

beforeEach(async () => {
  jest.useFakeTimers({ now: new Date(NOW) });
  resetStores();
  await deleteJob(db, job.id);
  mockPush.mockClear();
  mockBack.mockClear();
  mockParams = {};
  mockScheme = 'light';
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Settings tab rota row', () => {
  it('summarises the pattern and opens the rota editor', async () => {
    await seed();
    await render(<SettingsScreen />);
    await fireEvent.press(button('2 on 2 off · 4-day cycle, Shift types and cycle'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/settings/rota' });
  });

  it('counts shifts instead of "N on M off" for a pattern with several blocks', async () => {
    await seed(false);
    const d = { shiftTemplateId: 'tpl-d' };
    // On Day, Off, On, Off: two blocks on, so not "2 on 2 off".
    await useRotaStore
      .getState()
      .savePattern(db, { ...pattern, days: [d, 'OFF', d, 'OFF'] }, TODAY);
    await render(<SettingsScreen />);
    expect(screen.getByText('2 shifts · 4-day cycle')).toBeTruthy();
  });

  it('says when there is no rota yet', async () => {
    await seed(false);
    await render(<SettingsScreen />);
    expect(screen.getByText('No rota yet')).toBeTruthy();
  });
});

describe('Rota screen', () => {
  it('lists shift types, dates each cycle day and previews the engine', async () => {
    await seed();
    await render(<RotaScreen />);

    expect(screen.getByRole('header', { name: 'Shift types' })).toBeTruthy();
    const dayRow = button('Day, 08:00–16:00 · 30 min break');
    expect(styleOf(dayRow).minHeight).toBe(48);
    expect(styleOf(screen.getByText('08:00–16:00 · 30 min break')).color).toBe(
      lightColors.inkMuted,
    );
    expect(styleOf(screen.getByText('Day 1 · Sun 1 Nov')).color).toBe(lightColors.ink);
    await fireEvent.press(dayRow);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/settings/template/[id]',
      params: { id: 'tpl-d' },
    });
    await fireEvent.press(button('Add shift type'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/settings/template/[id]',
      params: { id: 'new' },
    });

    expect(screen.getByLabelText('First day of the cycle').props.value).toBe('2026-11-01');
    expect(screen.getByText('Sunday 1 November 2026')).toBeTruthy();
    expect(screen.getByText('4 days')).toBeTruthy();
    expect(screen.getByText('Day 1 · Sun 1 Nov')).toBeTruthy();
    expect(screen.getByText('Day 4 · Wed 4 Nov')).toBeTruthy();
    expect(dayChip(0, 'Day').props.accessibilityState.selected).toBe(true);
    expect(dayChip(2, 'Off').props.accessibilityState.selected).toBe(true);

    const templates = useRotaStore.getState().templates;
    for (const { date, label } of nextOccurrences(pattern, templates, TODAY, 14)) {
      expect(screen.getAllByText(formatDayDate(date)).length).toBeGreaterThan(0);
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('Thu 5 Nov')).toBeTruthy();
    expect(screen.getByText('Tue 17 Nov')).toBeTruthy();
    expect(screen.queryByText('Wed 18 Nov')).toBeNull();
    expect(
      screen.getByText(/Saving changes shifts from today on\. Past shifts and ones you.ve edited/),
    ).toBeTruthy();
    expect(screen.getByText(/Estimates only/)).toBeTruthy();

    await fireEvent.press(button('Back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('uses dark tokens', async () => {
    mockScheme = 'dark';
    await seed();
    await render(<RotaScreen />);
    expect(styleOf(screen.getByText('08:00–16:00 · 30 min break')).color).toBe(darkColors.inkMuted);
    expect(styleOf(screen.getByText('Day 1 · Sun 1 Nov')).color).toBe(darkColors.ink);
  });

  it('a day set to Off removes that future shift; past and edited shifts stay', async () => {
    await seed();
    await render(<RotaScreen />);
    await fireEvent.press(dayChip(1, 'Off'));
    await fireEvent.press(button('Save rota'));
    await waitFor(() => expect(screen.getByText('Rota saved.')).toBeTruthy());

    expect((await getRotaPattern(db, 'pat-1'))?.days[1]).toBe('OFF');
    // 6 Nov (future, cycle day 2) is gone; 5 Nov (cycle day 1) stays.
    expect(await getShift(db, shiftId('2026-11-06'))).toBeUndefined();
    expect(storeShift('2026-11-06')).toBeUndefined();
    expect(await getShift(db, shiftId('2026-11-05'))).toBeDefined();
    // 2 Nov (past, cycle day 2) stays, as does the sick day on 10 Nov.
    expect(await getShift(db, shiftId('2026-11-02'))).toBeDefined();
    expect(storeShift('2026-11-02')).toBeDefined();
    expect(await getShift(db, shiftId('2026-11-10'))).toMatchObject({
      status: 'sick',
      userModified: true,
    });
  });

  it('a new start date and longer cycle move future shifts', async () => {
    await seed();
    await render(<RotaScreen />);
    await fireEvent.press(button('Longer cycle'));
    expect(screen.getByText('5 days')).toBeTruthy();
    await fireEvent.press(dayChip(4, 'Late'));
    await fireEvent.changeText(screen.getByLabelText('First day of the cycle'), '2026-11-02');
    expect(screen.getByText('Day 1 · Mon 2 Nov')).toBeTruthy();
    await fireEvent.press(button('Save rota'));
    await waitFor(() => expect(screen.getByText('Rota saved.')).toBeTruthy());

    expect(await getRotaPattern(db, 'pat-1')).toMatchObject({
      cycleLengthDays: 5,
      startDate: '2026-11-02',
    });
    // Cycle day 5 is 6 Nov: now a Late shift.
    const late6 = await getShift(db, shiftId('2026-11-06'));
    expect(late6 && instantToLocal(late6.start).time).toBe('14:00');
    // Past 1 Nov is unchanged.
    const past = await getShift(db, shiftId('2026-11-01'));
    expect(past && instantToLocal(past.start).time).toBe('08:00');
  });

  it('blocks Save for an invalid rota', async () => {
    await seed();
    await render(<RotaScreen />);
    expect(disabled('Save rota')).toBe(false);

    await fireEvent.press(dayChip(0, 'Off'));
    await fireEvent.press(dayChip(1, 'Off'));
    expect(screen.getByText(ROTA_FORM_MESSAGES.noDayOn)).toBeTruthy();
    expect(disabled('Save rota')).toBe(true);
    expect(screen.queryByText('Thu 5 Nov')).toBeNull();
    await fireEvent.press(dayChip(0, 'Day'));
    expect(disabled('Save rota')).toBe(false);

    await fireEvent.changeText(screen.getByLabelText('First day of the cycle'), '2026-02-30');
    expect(screen.getByText(ROTA_FORM_MESSAGES.startDate)).toBeTruthy();
    expect(screen.getByText('Day 1')).toBeTruthy();
    expect(disabled('Save rota')).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('First day of the cycle'), '2026-11-01');

    for (let i = 0; i < 3; i += 1) await fireEvent.press(button('Shorter cycle'));
    expect(screen.getByText('1 day')).toBeTruthy();
    expect(disabled('Shorter cycle')).toBe(true);
    expect(disabled('Save rota')).toBe(false);
    for (let i = 0; i < 55; i += 1) await fireEvent.press(button('Longer cycle'));
    expect(screen.getByText('56 days')).toBeTruthy();
    expect(disabled('Longer cycle')).toBe(true);
    expect(screen.getByTestId('screen-scroll')).toBeTruthy();
    expect(screen.getByText('Day 56 · Sat 26 Dec')).toBeTruthy();
    // Renders a 56-day cycle: ~4.5 s alone, past Jest's 5 s default under load.
  }, 15000);

  it('creates the pattern when there is none yet', async () => {
    await seed(false);
    await render(<RotaScreen />);
    expect(screen.getByLabelText('First day of the cycle').props.value).toBe(TODAY);
    expect(screen.getByText('7 days')).toBeTruthy();
    expect(disabled('Save rota')).toBe(true);

    await fireEvent.press(dayChip(1, 'Day'));
    await fireEvent.press(button('Save rota'));
    await waitFor(() => expect(screen.getByText('Rota saved.')).toBeTruthy());

    const created = useRotaStore.getState().patterns;
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ jobId: job.id, startDate: TODAY, cycleLengthDays: 7 });
    expect(await getRotaPattern(db, created[0]!.id)).toEqual(created[0]);
    // Cycle day 2 = Thu 5 Nov.
    const thu = useShiftsStore.getState().shifts.find((s) => s.date === '2026-11-05');
    expect(thu && instantToLocal(thu.start).time).toBe('08:00');
  });
});

describe('Shift type editor', () => {
  it('moves future shifts to the new times; past ones stay', async () => {
    await seed();
    mockParams = { id: 'tpl-d' };
    await render(<TemplateEditorScreen />);
    expect(screen.getByLabelText('Name').props.value).toBe('Day');
    await fireEvent.changeText(screen.getByLabelText('Starts (HH:MM)'), '09:00');
    await fireEvent.changeText(screen.getByLabelText('Ends (HH:MM)'), '17:30');
    await fireEvent.press(button('Save'));
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));

    expect(await getShiftTemplate(db, 'tpl-d')).toMatchObject({
      startTime: '09:00',
      endTime: '17:30',
    });
    const future = await getShift(db, shiftId('2026-11-05'));
    expect(future && instantToLocal(future.start).time).toBe('09:00');
    expect(future && instantToLocal(future.end).time).toBe('17:30');
    const inStore = storeShift('2026-11-05');
    expect(inStore && instantToLocal(inStore.start).time).toBe('09:00');
    const past = await getShift(db, shiftId('2026-11-02'));
    expect(past && instantToLocal(past.start).time).toBe('08:00');
  });

  it('adds a shift type, with the next-day hint and field errors', async () => {
    await seed();
    mockParams = { id: 'new' };
    await render(<TemplateEditorScreen />);
    expect(screen.getByText('Add shift type')).toBeTruthy();
    expect(screen.queryByText('Delete shift type')).toBeNull();

    expect(disabled('Save')).toBe(true);
    expect(screen.getByText(ROTA_FORM_MESSAGES.name)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Night');
    await fireEvent.changeText(screen.getByLabelText('Starts (HH:MM)'), '19:00');
    await fireEvent.changeText(screen.getByLabelText('Ends (HH:MM)'), '07:00');
    expect(screen.getByText('Ends next day')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Ends (HH:MM)'), '19:00');
    expect(screen.getByText('Same start and end time: a 24-hour shift.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Ends (HH:MM)'), '07:00');
    await fireEvent.changeText(screen.getByLabelText('Unpaid break (minutes)'), 'x');
    expect(screen.getByText(ROTA_FORM_MESSAGES.breakNotWhole)).toBeTruthy();
    expect(disabled('Save')).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Unpaid break (minutes)'), '45');
    await fireEvent.press(button('Save'));
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));

    const added = useRotaStore.getState().templates.find((t) => t.name === 'Night');
    expect(added).toMatchObject({
      jobId: job.id,
      startTime: '19:00',
      endTime: '07:00',
      unpaidBreakMinutes: 45,
    });
    expect(await getShiftTemplate(db, added!.id)).toEqual(added);
  });

  it('refuses to delete a shift type the rota uses', async () => {
    await seed();
    mockParams = { id: 'tpl-d' };
    await render(<TemplateEditorScreen />);
    await fireEvent.press(button('Delete shift type'));
    expect(screen.getByText('Delete this shift type?')).toBeTruthy();
    await fireEvent.press(button('Delete'));
    await waitFor(() => expect(screen.getByText(TEMPLATE_IN_USE_MESSAGE)).toBeTruthy());
    expect(TEMPLATE_IN_USE_MESSAGE).toBe(
      'This shift type is used in your rota. Change those days first.',
    );
    expect(styleOf(screen.getByText(TEMPLATE_IN_USE_MESSAGE)).color).toBe(lightColors.alert);
    expect(mockBack).not.toHaveBeenCalled();
    expect(await getShiftTemplate(db, 'tpl-d')).toBeDefined();
  });

  it('deletes an unused shift type after confirming', async () => {
    await seed();
    mockParams = { id: 'tpl-l' };
    await render(<TemplateEditorScreen />);
    await fireEvent.press(button('Delete shift type'));
    await fireEvent.press(button('Cancel'));
    expect(screen.queryByText('Delete this shift type?')).toBeNull();
    await fireEvent.press(button('Delete shift type'));
    await fireEvent.press(button('Delete'));
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(await getShiftTemplate(db, 'tpl-l')).toBeUndefined();
    expect(useRotaStore.getState().templates.map((t) => t.id)).toEqual(['tpl-d']);
  });

  it('says when the shift type is missing', async () => {
    await seed();
    mockParams = { id: 'nope' };
    await render(<TemplateEditorScreen />);
    expect(screen.getByText('This shift type may have been deleted.')).toBeTruthy();
  });
});
