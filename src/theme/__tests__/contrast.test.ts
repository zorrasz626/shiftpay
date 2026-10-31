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

const TEXT_TOKENS: readonly ColorName[] = ['ink', 'inkMuted', 'night', 'positive', 'alert'];
const BACKGROUNDS: readonly ColorName[] = ['board', 'surface'];
const AA = 4.5;

describe.each<[string, Colors]>([
  ['light', lightColors],
  ['dark', darkColors],
])('%s theme meets WCAG AA (4.5:1) for text', (_name, colors) => {
  const pairs = TEXT_TOKENS.flatMap((fg) =>
    BACKGROUNDS.map((bg) => [fg, bg] as [ColorName, ColorName]),
  );

  it.each(pairs)('%s on %s', (fg, bg) => {
    expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(AA);
  });

  it('onSignal on signal', () => {
    expect(contrastRatio(colors.onSignal, colors.signal)).toBeGreaterThanOrEqual(AA);
  });
});

describe('palettes', () => {
  it('light and dark have identical keys', () => {
    expect(Object.keys(darkColors).sort()).toEqual(Object.keys(lightColors).sort());
  });
});
