import { render, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import type { ComponentType } from 'react';
import { StyleSheet } from 'react-native';

import TabsLayout from '../../app/(tabs)/_layout';
import CalendarScreen from '../../app/(tabs)/calendar';
import HomeScreen from '../../app/(tabs)/index';
import PayScreen from '../../app/(tabs)/pay';
import SettingsScreen from '../../app/(tabs)/settings';
import { darkColors, fontFamily, lightColors, type Colors } from '../theme/tokens';

let mockScheme: 'light' | 'dark' = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => {
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ name }: { name: string }) => <Text>{`icon:${name}`}</Text>,
  };
});
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

type StyleProps = { props: { style?: unknown } };
const styleOf = (el: StyleProps): Record<string, unknown> =>
  (StyleSheet.flatten(el.props.style as never) ?? {}) as Record<string, unknown>;

const themes: [label: 'light' | 'dark', colors: Colors][] = [
  ['light', lightColors],
  ['dark', darkColors],
];

const screens: [title: string, Screen: ComponentType][] = [
  ['Calendar', CalendarScreen],
  ['Pay', PayScreen],
  ['Settings', SettingsScreen],
];

describe.each(themes)('tab screens in %s theme', (scheme, colors) => {
  beforeEach(() => {
    mockScheme = scheme;
  });

  it.each(screens)('%s renders its title in the title style', async (title, Screen) => {
    await render(<Screen />);
    const titleEl = screen.getByText(title);
    expect(styleOf(titleEl).color).toBe(colors.ink);
    expect(styleOf(titleEl).fontFamily).toBe(fontFamily.condensedSemiBold);
    expect(screen.getByText(/will appear here/)).toBeTruthy();
  });

  it('only Settings shows the disclaimer among the placeholders', async () => {
    await render(<SettingsScreen />);
    expect(screen.getByText(/Estimates only/)).toBeTruthy();
    await render(<PayScreen />);
    expect(screen.queryByText(/Estimates only/)).toBeNull();
  });

  it('opens on Home with the four labelled tabs', async () => {
    await renderRouter(
      {
        '(tabs)/_layout': TabsLayout,
        '(tabs)/index': HomeScreen,
        '(tabs)/calendar': CalendarScreen,
        '(tabs)/pay': PayScreen,
        '(tabs)/settings': SettingsScreen,
      },
      { initialUrl: '/' },
    );
    expect(screen.getByText('ShiftPay')).toBeTruthy();
    for (const label of ['Home', 'Calendar', 'Pay', 'Settings']) {
      const labelEl = screen.getByText(label);
      expect(styleOf(labelEl).fontFamily).toBe(fontFamily.medium);
    }
    expect(styleOf(screen.getByText('Home')).color).toBe(colors.ink);
    expect(styleOf(screen.getByText('Pay')).color).toBe(colors.inkMuted);
  });
});
