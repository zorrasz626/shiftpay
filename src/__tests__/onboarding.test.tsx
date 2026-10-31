import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { StyleSheet, Text } from 'react-native';

import OnboardingJobScreen from '../../app/onboarding/job';
import { DISCLAIMER } from '../components/Disclaimer';
import { Screen } from '../components/Screen';
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
