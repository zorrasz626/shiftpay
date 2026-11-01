import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import { darkColors, lightColors, maxFontScale, type Colors } from '../../theme/tokens';
import { BigNumber } from '../BigNumber';
import { Button } from '../Button';
import { Card } from '../Card';
import { Chip } from '../Chip';
import { DISCLAIMER, Disclaimer } from '../Disclaimer';

let mockScheme: 'light' | 'dark' = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

type StyleProps = { props: { style?: unknown } };
const styleOf = (el: StyleProps): Record<string, unknown> =>
  (StyleSheet.flatten(el.props.style as never) ?? {}) as Record<string, unknown>;

const themes: [label: 'light' | 'dark', colors: Colors][] = [
  ['light', lightColors],
  ['dark', darkColors],
];

describe.each(themes)('components in %s theme', (scheme, colors) => {
  beforeEach(() => {
    mockScheme = scheme;
  });

  describe('BigNumber', () => {
    it.each([
      [128450, '£1,284', '.50', '£1,284.50'],
      [-1230, '-£12', '.30', '-£12.30'],
      [0, '£0', '.00', '£0.00'],
    ])('splits %i pence into pounds and pence', async (pence, pounds, fraction, full) => {
      await render(<BigNumber pence={pence} />);
      const poundsEl = screen.getByText(pounds);
      const fractionEl = screen.getByText(fraction);
      expect(styleOf(poundsEl).color).toBe(colors.ink);
      expect(styleOf(fractionEl).color).toBe(colors.ink);
      expect(styleOf(poundsEl).fontVariant).toEqual(['tabular-nums']);
      expect(styleOf(fractionEl).fontVariant).toEqual(['tabular-nums']);
      expect(screen.getByLabelText(full)).toBeTruthy();
      // Fixed-size figure: capped scaling, pounds shrink to fit on one line.
      expect(poundsEl.props).toMatchObject({
        numberOfLines: 1,
        adjustsFontSizeToFit: true,
        maxFontSizeMultiplier: maxFontScale.figure,
      });
      expect(fractionEl.props.maxFontSizeMultiplier).toBe(maxFontScale.figure);
    });

    it('shows the caption in inkMuted', async () => {
      await render(<BigNumber pence={100} caption="Earned so far this period" />);
      const caption = screen.getByText('Earned so far this period');
      expect(styleOf(caption).color).toBe(colors.inkMuted);
      // Body text scales fully.
      expect(caption.props.maxFontSizeMultiplier).toBeUndefined();
      expect(caption.props.allowFontScaling).not.toBe(false);
    });
  });

  describe('Card', () => {
    it('renders a flat surface with a line border, title and children', async () => {
      await render(
        <Card title="This period">
          <Text>Body</Text>
        </Card>,
      );
      const card = styleOf(screen.getByTestId('card'));
      expect(card.backgroundColor).toBe(colors.surface);
      expect(card.borderColor).toBe(colors.line);
      expect(card.borderWidth).toBe(1);
      expect(card.borderRadius).toBe(12);
      expect(card.shadowColor).toBeUndefined();
      expect(card.elevation).toBeUndefined();
      expect(styleOf(screen.getByText('This period')).color).toBe(colors.ink);
      expect(screen.getByText('Body')).toBeTruthy();
    });

    it('renders without a title', async () => {
      await render(
        <Card>
          <Text>Only body</Text>
        </Card>,
      );
      expect(screen.getByText('Only body')).toBeTruthy();
      expect(screen.queryByRole('header')).toBeNull();
    });
  });

  describe('Button', () => {
    it('primary uses the signal fill and onSignal text, min height 48', async () => {
      const onPress = jest.fn();
      await render(<Button label="Add shift" onPress={onPress} variant="primary" />);
      const button = screen.getByRole('button', { name: 'Add shift' });
      expect(styleOf(button).backgroundColor).toBe(colors.signal);
      expect(styleOf(button).minHeight).toBe(48);
      expect(styleOf(screen.getByText('Add shift')).color).toBe(colors.onSignal);
      fireEvent.press(button);
      expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('secondary has a line border and ink text', async () => {
      await render(<Button label="Edit" onPress={jest.fn()} variant="secondary" />);
      const button = screen.getByRole('button', { name: 'Edit' });
      expect(styleOf(button).borderColor).toBe(colors.line);
      expect(styleOf(button).backgroundColor).toBeUndefined();
      expect(styleOf(screen.getByText('Edit')).color).toBe(colors.ink);
    });

    it('quiet is text only', async () => {
      await render(<Button label="Skip" onPress={jest.fn()} variant="quiet" />);
      const button = screen.getByRole('button', { name: 'Skip' });
      expect(styleOf(button).backgroundColor).toBeUndefined();
      expect(styleOf(button).borderWidth).toBeUndefined();
      expect(styleOf(screen.getByText('Skip')).color).toBe(colors.ink);
    });

    it.each(['primary', 'secondary', 'quiet'] as const)(
      'disabled %s does not fire onPress',
      async (variant) => {
        const onPress = jest.fn();
        await render(<Button label="Save" onPress={onPress} variant={variant} disabled />);
        const button = screen.getByRole('button', { name: 'Save' });
        expect(button).toBeDisabled();
        fireEvent.press(button);
        expect(onPress).not.toHaveBeenCalled();
        expect(styleOf(screen.getByText('Save')).color).toBe(colors.inkMuted);
      },
    );
  });

  describe('Chip', () => {
    it.each([
      ['neutral', 'inkMuted'],
      ['night', 'night'],
      ['positive', 'positive'],
      ['alert', 'alert'],
    ] as const)('%s tone outlines and colours the label', async (tone, token) => {
      await render(<Chip label="Night shift" tone={tone} />);
      expect(styleOf(screen.getByTestId('chip')).borderColor).toBe(colors[token]);
      expect(styleOf(screen.getByText('Night shift')).color).toBe(colors[token]);
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('selected fills with the tone colour and is pressable', async () => {
      const onPress = jest.fn();
      await render(<Chip label="Overtime" tone="night" selected onPress={onPress} />);
      const chip = screen.getByRole('button', { name: 'Overtime' });
      expect(styleOf(chip).backgroundColor).toBe(colors.night);
      expect(styleOf(screen.getByText('Overtime')).color).toBe(colors.surface);
      expect(chip).toBeSelected();
      fireEvent.press(chip);
      expect(onPress).toHaveBeenCalledTimes(1);
    });
  });

  describe('Disclaimer', () => {
    it('shows the exact disclaimer text in inkMuted, left-aligned', async () => {
      await render(<Disclaimer />);
      const text = screen.getByText(DISCLAIMER);
      expect(styleOf(text).color).toBe(colors.inkMuted);
      expect(styleOf(text).textAlign).toBe('left');
      expect(DISCLAIMER).toBe(
        'Estimates only — not financial or tax advice. Always check with your employer/payroll.',
      );
    });
  });
});
