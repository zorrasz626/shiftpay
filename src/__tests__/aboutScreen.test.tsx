import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking, StyleSheet } from 'react-native';

import SettingsScreen from '../../app/(tabs)/settings';
import AboutScreen from '../../app/settings/about';
import { DISCLAIMER } from '../components/Disclaimer';
import { PRIVACY_POLICY_URL } from '../config/links';
import { resetStores } from '../store/testFixtures';
import { darkColors, lightColors, typography } from '../theme/tokens';

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));
let mockVersion: string | undefined = '1.0.0';
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { version: mockVersion };
    },
  },
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

beforeEach(() => {
  resetStores();
  mockPush.mockClear();
  mockBack.mockClear();
  mockVersion = '1.0.0';
  mockScheme = 'light';
});

describe('About screen', () => {
  it('shows the description, the full disclaimer and the version from the app config', async () => {
    await render(<AboutScreen />);

    expect(screen.getByText('About')).toBeTruthy();
    expect(screen.getByText(/Your data stays on this phone\./)).toBeTruthy();
    const disclaimer = screen.getByText(DISCLAIMER);
    expect(styleOf(disclaimer).fontSize).toBe(typography.body.fontSize);
    expect(styleOf(disclaimer).color).toBe(lightColors.ink);
    expect(screen.getByText('Version 1.0.0')).toBeTruthy();
  });

  it('takes the version from the config rather than hard-coding it', async () => {
    mockVersion = '2.3.4';
    await render(<AboutScreen />);
    expect(screen.getByText('Version 2.3.4')).toBeTruthy();
  });

  it('says the version is unknown when the config has none', async () => {
    mockVersion = undefined;
    await render(<AboutScreen />);
    expect(screen.getByText('Version unknown')).toBeTruthy();
  });

  it('opens the privacy policy in the browser and goes back', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await render(<AboutScreen />);

    const link = screen.getByRole('link', { name: 'Privacy policy' });
    expect(styleOf(link).minHeight).toBe(48);
    await fireEvent.press(link);
    expect(openURL).toHaveBeenCalledWith(PRIVACY_POLICY_URL);

    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(mockBack).toHaveBeenCalledTimes(1);
    openURL.mockRestore();
  });

  it('uses dark tokens', async () => {
    mockScheme = 'dark';
    await render(<AboutScreen />);
    expect(styleOf(screen.getByText(DISCLAIMER)).color).toBe(darkColors.ink);
    expect(styleOf(screen.getByText('Version 1.0.0')).color).toBe(darkColors.inkMuted);
  });
});

describe('Settings tab About row', () => {
  it('opens the About screen', async () => {
    await render(<SettingsScreen />);
    const row = screen.getByRole('button', {
      name: 'About ShiftPay, Disclaimer, version and privacy policy',
    });
    expect(styleOf(row).minHeight).toBe(48);
    await fireEvent.press(row);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/settings/about' });
  });
});
