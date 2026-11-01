import { contrastRatio, relativeLuminance } from '../contrast';
import { darkColors, lightColors, type ColorName, type Colors } from '../tokens';

describe('contrastRatio', () => {
  it('gives known WCAG values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
    // #767676 on white is the classic just-passing AA grey (~4.54:1).
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it('computes relative luminance at the extremes', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10);
  });

  it('rejects malformed colours', () => {
    expect(() => contrastRatio('#FFF', '#000000')).toThrow('Invalid hex colour');
    expect(() => contrastRatio('red', '#000000')).toThrow('Invalid hex colour');
  });
});

type Pair = readonly [fg: ColorName, bg: ColorName];

// Every text-on-background pair the screens use (all text is normal size, so 4.5:1).
const TEXT_PAIRS: readonly Pair[] = [
  // Body, captions, chips (outline), codes, figures and messages on the screen board and cards.
  ...(['ink', 'inkMuted', 'night', 'positive', 'alert'] as const).flatMap((fg) =>
    (['board', 'surface'] as const).map((bg): Pair => [fg, bg]),
  ),
  // Primary button, selected segment, overtime code, today's date.
  ['onSignal', 'signal'],
  // Disabled primary button.
  ['inkMuted', 'line'],
  // Selected chip: surface-coloured label on the tone fill.
  ['surface', 'inkMuted'],
  ['surface', 'night'],
  ['surface', 'positive'],
  ['surface', 'alert'],
];
const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

describe.each<[string, Colors]>([
  ['light', lightColors],
  ['dark', darkColors],
])('%s theme', (_name, colors) => {
  it.each(TEXT_PAIRS)('text: %s on %s meets AA (4.5:1)', (fg, bg) => {
    expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(AA_TEXT);
  });

  // Non-colour state cues that stand in for the signal fill: the ink ring on today's
  // calendar date and the ink underline on the active tab label (WCAG 1.4.11, 3:1).
  it.each<Pair>([
    ['ink', 'board'],
    ['ink', 'surface'],
  ])('state cue: %s on %s meets 3:1', (fg, bg) => {
    expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
});

// The light `signal` yellow is deliberately below 3:1 against board/surface (about 1.5-1.8:1).
// WCAG 1.4.11 does not require it where the fill is not needed to identify the control:
// buttons are identified by their text labels, and the two places where the fill marks a
// state (today, active tab) carry the ink cue tested above. Dark theme does meet 3:1.
describe('dark theme signal fill', () => {
  it.each<ColorName>(['board', 'surface'])('signal on %s meets 3:1', (bg) => {
    expect(contrastRatio(darkColors.signal, darkColors[bg])).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
});

describe('palettes', () => {
  it('light and dark have identical keys', () => {
    expect(Object.keys(darkColors).sort()).toEqual(Object.keys(lightColors).sort());
  });
});
