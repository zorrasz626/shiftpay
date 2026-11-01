import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import SettingsScreen from '../../app/(tabs)/settings';
import TaxSettingsScreen from '../../app/settings/tax';
import { db } from '../db/client';
import { deleteSetting, getSetting, setSetting } from '../db/settingsRepo';
import { useProStore } from '../features/pro/proStore';
import {
  DEFAULT_TAX_PROFILE,
  TAX_CODE_INVALID_MESSAGE,
  TAX_CODE_UNSUPPORTED_MESSAGE,
  TAX_PROFILE_KEY,
  type TaxProfile,
} from '../features/tax/taxProfile';
import { useSettingsStore } from '../store/settingsStore';
import { resetStores } from '../store/testFixtures';

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

const stored: TaxProfile = {
  taxCode: 'S1257L',
  studentLoan: 'plan2',
  postgrad: true,
  pensionPercent: 5,
  pensionMethod: 'relief_at_source',
};

async function seedProfile(value: unknown): Promise<void> {
  await setSetting(db, TAX_PROFILE_KEY, value);
  await useSettingsStore.getState().load(db);
}

const field = (name: string) => screen.getByLabelText(name);
const button = (name: string) => screen.getByRole('button', { name });
const pro = () => useProStore.setState({ status: 'pro', source: 'revenuecat' });
const free = () => useProStore.setState({ status: 'free', source: 'unconfigured' });

beforeEach(async () => {
  resetStores();
  await deleteSetting(db, TAX_PROFILE_KEY);
  mockPush.mockClear();
  mockBack.mockClear();
  useProStore.setState(useProStore.getInitialState(), true);
});

describe('Settings tab: Tax & deductions card', () => {
  it('shows the default summary and opens Tax settings', async () => {
    await render(<SettingsScreen />);
    expect(screen.getByRole('header', { name: 'Tax & deductions' })).toBeTruthy();
    await fireEvent.press(button('Tax code 1257L, No student loan · No pension'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/settings/tax' });
  });

  it('shows the stored profile', async () => {
    await seedProfile(stored);
    await render(<SettingsScreen />);
    expect(button('Tax code S1257L, Plan 2 + postgraduate · Pension 5%')).toBeTruthy();
  });
});

describe('Tax settings (Pro)', () => {
  beforeEach(pro);

  it('starts from the default, with the disclaimer', async () => {
    await render(<TaxSettingsScreen />);
    expect(field('Tax code').props.value).toBe('1257L');
    expect(field('Pension contribution (%)').props.value).toBe('0');
    expect(button('None').props.accessibilityState).toMatchObject({ selected: true });
    expect(button('Net pay').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByRole('switch', { name: 'Postgraduate loan' }).props.value).toBe(false);
    expect(screen.getByText(/Estimates only/)).toBeTruthy();
    expect(screen.queryByTestId('pro-upsell')).toBeNull();
  });

  it('loads the stored profile', async () => {
    await seedProfile(stored);
    await render(<TaxSettingsScreen />);
    expect(field('Tax code').props.value).toBe('S1257L');
    expect(field('Pension contribution (%)').props.value).toBe('5');
    expect(button('Plan 2').props.accessibilityState).toMatchObject({ selected: true });
    expect(button('Relief at source').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByRole('switch', { name: 'Postgraduate loan' }).props.value).toBe(true);
  });

  it('saves a valid profile as tax.profile, normalising the code, then goes back', async () => {
    await render(<TaxSettingsScreen />);
    await fireEvent.changeText(field('Tax code'), ' c1100l ');
    await fireEvent.press(button('Plan 1'));
    await fireEvent(screen.getByRole('switch', { name: 'Postgraduate loan' }), 'valueChange', true);
    await fireEvent.changeText(field('Pension contribution (%)'), '4.5');
    await fireEvent.press(button('Salary sacrifice'));
    await fireEvent.press(button('Save'));

    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    const expected: TaxProfile = {
      taxCode: 'C1100L',
      studentLoan: 'plan1',
      postgrad: true,
      pensionPercent: 4.5,
      pensionMethod: 'salary_sacrifice',
    };
    expect(await getSetting(db, TAX_PROFILE_KEY)).toEqual(expected);
    expect(useSettingsStore.getState().values[TAX_PROFILE_KEY]).toEqual(expected);
  });

  it('does not save an unsupported tax code', async () => {
    await render(<TaxSettingsScreen />);
    for (const code of ['K475', '1257L W1', '1257LM1']) {
      await fireEvent.changeText(field('Tax code'), code);
      await fireEvent.press(button('Save'));
      expect(screen.getByText(TAX_CODE_UNSUPPORTED_MESSAGE)).toBeTruthy();
    }
    expect(mockBack).not.toHaveBeenCalled();
    expect(await getSetting(db, TAX_PROFILE_KEY)).toBeUndefined();
  });

  it('does not save a mistyped code or a bad percentage', async () => {
    await render(<TaxSettingsScreen />);
    await fireEvent.changeText(field('Tax code'), 'hello');
    await fireEvent.press(button('Save'));
    expect(screen.getByText(TAX_CODE_INVALID_MESSAGE)).toBeTruthy();

    await fireEvent.changeText(field('Tax code'), '1257L');
    await fireEvent.changeText(field('Pension contribution (%)'), '120');
    await fireEvent.press(button('Save'));
    expect(screen.queryByText(TAX_CODE_INVALID_MESSAGE)).toBeNull();
    expect(screen.getByText('Enter a percentage from 0 to 100')).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
    expect(await getSetting(db, TAX_PROFILE_KEY)).toBeUndefined();
  });

  it('shows an error and stays when saving fails', async () => {
    const original = useSettingsStore.getState().set;
    useSettingsStore.setState({ set: jest.fn(async () => Promise.reject(new Error('disk'))) });
    await render(<TaxSettingsScreen />);
    await fireEvent.press(button('Save'));
    await waitFor(() =>
      expect(screen.getByText("Your changes couldn't be saved. Try again.")).toBeTruthy(),
    );
    expect(mockBack).not.toHaveBeenCalled();
    useSettingsStore.setState({ set: original });
  });
});

describe('Tax settings (Free)', () => {
  it('shows the Pro upsell instead of the form, and Back', async () => {
    free();
    await seedProfile(stored);
    await render(<TaxSettingsScreen />);
    expect(screen.getByTestId('pro-upsell')).toBeTruthy();
    expect(screen.queryByLabelText('Tax code')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByText(/Estimates only/)).toBeTruthy();
    await fireEvent.press(button('See ShiftPay Pro: Net pay estimates'));
    expect(mockPush).toHaveBeenCalledWith('/paywall');
    await fireEvent.press(button('Back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(await getSetting(db, TAX_PROFILE_KEY)).toEqual(stored);
  });

  it('treats a loading entitlement as Free', async () => {
    await render(<TaxSettingsScreen />);
    expect(screen.getByTestId('pro-upsell')).toBeTruthy();
    expect(DEFAULT_TAX_PROFILE.taxCode).toBe('1257L');
  });
});
