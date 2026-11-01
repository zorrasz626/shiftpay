import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { StyleSheet, Text } from 'react-native';

import OnboardingJobScreen from '../../app/onboarding/job';
import OnboardingPremiumsScreen from '../../app/onboarding/premiums';
import OnboardingRotaScreen from '../../app/onboarding/rota';
import { DISCLAIMER } from '../components/Disclaimer';
import { Screen } from '../components/Screen';
import { PREMIUM_PRESETS } from '../engine/presets';
import { useProStore } from '../features/pro/proStore';
import { MESSAGES, useOnboardingStore } from '../store/onboardingStore';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
const mockPush = jest.fn();
// Step 4 imports the app DB; these tests never finish onboarding.
jest.mock('../db/client', () => ({ db: {} }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

type StyleProps = { props: { style?: unknown } };
const styleOf = (el: StyleProps): Record<string, unknown> =>
  (StyleSheet.flatten(el.props.style as never) ?? {}) as Record<string, unknown>;

describe('onboarding step 1', () => {
  beforeEach(() => {
    useOnboardingStore.getState().reset();
    mockPush.mockClear();
  });

  it('enables Continue only once the name and rate are valid', async () => {
    await render(<OnboardingJobScreen />);
    expect(screen.getByText('Step 1 of 4')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Your job' })).toBeTruthy();
    expect(screen.getByText(DISCLAIMER)).toBeTruthy();

    const cont = screen.getByRole('button', { name: 'Continue' });
    expect(cont).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText('Job name'), 'Day job');
    await fireEvent.changeText(screen.getByLabelText('Base rate per hour (£)'), '12.345');
    expect(screen.getByText(MESSAGES.rate)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText('Base rate per hour (£)'), '12.21');
    expect(screen.queryByText(MESSAGES.rate)).toBeNull();
    const enabled = screen.getByRole('button', { name: 'Continue' });
    expect(enabled).toBeEnabled();
    await fireEvent.press(enabled);
    expect(mockPush).toHaveBeenCalledWith('/onboarding/pay');
  });
});

describe('onboarding step 3', () => {
  beforeEach(() => {
    useOnboardingStore.getState().reset();
    mockPush.mockClear();
  });

  it('pre-fills the first day on and accepts the default rota', async () => {
    await render(<OnboardingRotaScreen />);
    expect(screen.getByText('Step 3 of 4')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Your rota' })).toBeTruthy();
    expect(screen.getByText(DISCLAIMER)).toBeTruthy();
    expect(useOnboardingStore.getState().firstDayOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.getByText('Next 14 days')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    expect(screen.queryByText('Mon')).toBeNull();
  });

  it('shows day chips for "Pick your days" and blocks Continue until one is picked', async () => {
    await render(<OnboardingRotaScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Pick your days' }));
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      expect(screen.getByRole('button', { name: day })).toBeTruthy();
    }
    expect(screen.getByText(MESSAGES.pickDays)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

    await fireEvent.press(screen.getByRole('button', { name: 'Wed' }));
    expect(screen.queryByText(MESSAGES.pickDays)).toBeNull();
    const enabled = screen.getByRole('button', { name: 'Continue' });
    expect(enabled).toBeEnabled();
    await fireEvent.press(enabled);
    expect(mockPush).toHaveBeenCalledWith('/onboarding/premiums');
  });

  it('labels overnight shifts and blocks bad times', async () => {
    await render(<OnboardingRotaScreen />);
    await fireEvent.changeText(screen.getByLabelText('Shift starts (HH:MM)'), '22:00');
    await fireEvent.changeText(screen.getByLabelText('Shift ends (HH:MM)'), '06:00');
    expect(screen.getByText('Ends next day')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();

    await fireEvent.changeText(screen.getByLabelText('Shift ends (HH:MM)'), '6am');
    expect(screen.getByText(MESSAGES.time)).toBeTruthy();
    expect(screen.queryByText('Next 14 days')).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });
});

describe('onboarding step 4 presets', () => {
  const chip = (label: string) => screen.getByRole('button', { name: label });
  const labels = PREMIUM_PRESETS.map((p) => p.label);
  const hint = 'More rules with Pro after setup';

  beforeEach(() => {
    useOnboardingStore.getState().reset();
    useProStore.setState({ status: 'free', source: 'unconfigured' });
    mockPush.mockClear();
  });

  it('lets a free user pick 2 presets; a third shows a hint and is not selected', async () => {
    await render(<OnboardingPremiumsScreen />);
    const [first, second, third] = labels as [string, string, string];
    await fireEvent.press(chip(first));
    await fireEvent.press(chip(second));
    expect(screen.queryByText(hint)).toBeNull();

    await fireEvent.press(chip(third));
    expect(screen.getByText(hint)).toBeTruthy();
    expect(chip(third).props.accessibilityState.selected).toBe(false);
    expect(useOnboardingStore.getState().premiums).toEqual(['nights', 'sundays']);
    expect(mockPush).not.toHaveBeenCalled();

    // Unselecting still works, and frees a slot.
    await fireEvent.press(chip(first));
    expect(screen.queryByText(hint)).toBeNull();
    await fireEvent.press(chip(third));
    expect(useOnboardingStore.getState().premiums).toEqual(['sundays', 'bank_holidays']);
  });

  it('lets a Pro user pick every preset', async () => {
    useProStore.setState({ status: 'pro', source: 'revenuecat' });
    await render(<OnboardingPremiumsScreen />);
    for (const label of labels) await fireEvent.press(chip(label));
    expect(screen.queryByText(hint)).toBeNull();
    expect(useOnboardingStore.getState().premiums).toEqual(PREMIUM_PRESETS.map((p) => p.id));
  });
});

describe('Screen bottomInset', () => {
  const insets = { top: 0, right: 0, bottom: 24, left: 0 };

  it.each([
    [false, 16],
    [true, 40],
  ])('bottomInset=%p pads the footer by %p', async (bottomInset, padding) => {
    await render(
      <SafeAreaInsetsContext.Provider value={insets}>
        <Screen bottomInset={bottomInset} footer={<Text>Continue</Text>} />
      </SafeAreaInsetsContext.Provider>,
    );
    expect(styleOf(screen.getByTestId('screen-footer')).paddingBottom).toBe(padding);
  });
});
