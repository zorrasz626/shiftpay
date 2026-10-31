import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import { darkColors, fontFamily, lightColors, type Colors } from '../../theme/tokens';
import { Screen } from '../Screen';
import { TextField } from '../TextField';

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
  (StyleSheet.flatten(el.props.style as never) ?? {}) as Record<string, unknown>;

const themes: [label: 'light' | 'dark', colors: Colors][] = [
  ['light', lightColors],
  ['dark', darkColors],
];

describe.each(themes)('form components in %s theme', (scheme, colors) => {
  beforeEach(() => {
    mockScheme = scheme;
  });

  describe('Screen', () => {
    it('renders the board background, gutter, title header and children', async () => {
      await render(
        <Screen title="Your job">
          <Text>Body</Text>
        </Screen>,
      );
      expect(styleOf(screen.getByTestId('screen')).backgroundColor).toBe(colors.board);
      expect(styleOf(screen.getByTestId('screen-content')).padding).toBe(16);
      const title = screen.getByRole('header', { name: 'Your job' });
      expect(styleOf(title).color).toBe(colors.ink);
      expect(styleOf(title).fontFamily).toBe(fontFamily.condensedSemiBold);
      expect(screen.getByText('Body')).toBeTruthy();
      expect(screen.queryByTestId('screen-scroll')).toBeNull();
      expect(screen.queryByTestId('screen-footer')).toBeNull();
    });

    it('renders without a title', async () => {
      await render(
        <Screen>
          <Text>Only body</Text>
        </Screen>,
      );
      expect(screen.getByText('Only body')).toBeTruthy();
      expect(screen.queryByRole('header')).toBeNull();
    });

    it('scroll wraps the title and content in a ScrollView that keeps taps', async () => {
      await render(
        <Screen title="Pay rates" scroll>
          <Text>Scrolled body</Text>
        </Screen>,
      );
      const scroll = screen.getByTestId('screen-scroll');
      expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
      expect(StyleSheet.flatten(scroll.props.contentContainerStyle).padding).toBe(16);
      expect(screen.getByText('Scrolled body')).toBeTruthy();
      expect(screen.getByText('Pay rates')).toBeTruthy();
      expect(screen.queryByTestId('screen-content')).toBeNull();
    });

    it('pins the footer after the content', async () => {
      await render(
        <Screen title="Step 1" footer={<Text>Continue</Text>}>
          <Text>Body</Text>
        </Screen>,
      );
      const footer = screen.getByTestId('screen-footer');
      expect(screen.getByText('Continue')).toBeTruthy();
      expect(footer).toContainElement(screen.getByText('Continue'));
      expect(screen.getByTestId('screen-content')).not.toContainElement(
        screen.getByText('Continue'),
      );
    });
  });

  describe('TextField', () => {
    it('labels the input, styles it on surface with a line border, and reports typing', async () => {
      const onChangeText = jest.fn();
      await render(
        <TextField
          label="Hourly rate"
          value=""
          onChangeText={onChangeText}
          keyboardType="decimal-pad"
          placeholder="12.50"
          accessibilityHint="Your basic rate before premiums"
        />,
      );
      const input = screen.getByLabelText('Hourly rate');
      const style = styleOf(input);
      expect(style.minHeight).toBe(48);
      expect(style.backgroundColor).toBe(colors.surface);
      expect(style.borderColor).toBe(colors.line);
      expect(style.borderWidth).toBe(1);
      expect(style.borderRadius).toBe(10);
      expect(style.fontSize).toBe(16);
      expect(style.color).toBe(colors.ink);
      expect(style.fontVariant).toEqual(['tabular-nums']);
      expect(input.props.keyboardType).toBe('decimal-pad');
      expect(input.props.placeholder).toBe('12.50');
      expect(input.props.accessibilityHint).toBe('Your basic rate before premiums');
      expect(styleOf(screen.getByText('Hourly rate')).color).toBe(colors.ink);

      fireEvent.changeText(input, '13.75');
      expect(onChangeText).toHaveBeenCalledWith('13.75');
    });

    it('shows the helper in inkMuted caption', async () => {
      await render(
        <TextField label="Job name" value="" onChangeText={jest.fn()} helper="Only you see this" />,
      );
      const helper = styleOf(screen.getByText('Only you see this'));
      expect(helper.color).toBe(colors.inkMuted);
      expect(helper.fontSize).toBe(13);
    });

    it('shows the error in alert and turns the border alert', async () => {
      await render(
        <TextField
          label="Hourly rate"
          value="abc"
          onChangeText={jest.fn()}
          helper="Before premiums"
          error="Enter an amount like 12.50"
        />,
      );
      expect(styleOf(screen.getByText('Enter an amount like 12.50')).color).toBe(colors.alert);
      expect(styleOf(screen.getByLabelText('Hourly rate')).borderColor).toBe(colors.alert);
      expect(screen.queryByText('Before premiums')).toBeNull();
    });

    it('treats an empty error as no error', async () => {
      await render(<TextField label="Hourly rate" value="" onChangeText={jest.fn()} error="" />);
      expect(styleOf(screen.getByLabelText('Hourly rate')).borderColor).toBe(colors.line);
    });
  });
});
