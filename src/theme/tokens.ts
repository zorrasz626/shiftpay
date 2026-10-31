// Design tokens for the "clock card" visual direction (see design.md, task 3.1).
// Light and dark palettes share one key set, enforced by the `Colors` type.

export type ColorName =
  | 'board'
  | 'surface'
  | 'line'
  | 'ink'
  | 'inkMuted'
  | 'signal'
  | 'onSignal'
  | 'night'
  | 'positive'
  | 'alert';

export type Colors = Readonly<Record<ColorName, string>>;

export const lightColors: Colors = {
  board: '#E9EDF1',
  surface: '#FFFFFF',
  line: '#C9D1D9',
  ink: '#15212C',
  inkMuted: '#4A5866',
  // Fill only (primary button, active tab marker, today marker); text on it is `onSignal`.
  signal: '#F5B700',
  onSignal: '#15212C',
  night: '#4338A0',
  positive: '#1E7346',
  alert: '#B42318',
};

export const darkColors: Colors = {
  board: '#0E1621',
  surface: '#172230',
  line: '#2A3847',
  ink: '#E7EDF3',
  inkMuted: '#9AA8B6',
  signal: '#F7C02B',
  onSignal: '#15212C',
  night: '#A9A3F5',
  positive: '#5CCB8C',
  alert: '#FF8A80',
};

/** Spacing scale (dp). `gutter` is the screen edge padding. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  gutter: 16,
} as const;

/** Radius by hierarchy; chips are fully round. */
export const radius = {
  card: 12,
  button: 10,
  chip: 999,
} as const;

/** Font family names as registered by `useFonts` in app/_layout.tsx. */
export const fontFamily = {
  regular: 'Barlow_400Regular',
  medium: 'Barlow_500Medium',
  condensedSemiBold: 'BarlowCondensed_600SemiBold',
} as const;

export type TextStyleToken = {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly lineHeight: number;
};

/** Type scale (px). Body styles use ~1.35x line height; condensed styles are tighter. */
export const typography = {
  caption: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 18 },
  body: { fontFamily: fontFamily.regular, fontSize: 16, lineHeight: 22 },
  bodyMedium: { fontFamily: fontFamily.medium, fontSize: 16, lineHeight: 22 },
  bodyLarge: { fontFamily: fontFamily.regular, fontSize: 18, lineHeight: 24 },
  title: { fontFamily: fontFamily.condensedSemiBold, fontSize: 24, lineHeight: 30 },
  display: { fontFamily: fontFamily.condensedSemiBold, fontSize: 34, lineHeight: 40 },
  money: { fontFamily: fontFamily.condensedSemiBold, fontSize: 64, lineHeight: 70 },
} as const satisfies Record<string, TextStyleToken>;

/** All numbers use tabular figures. */
export const tabularNums = ['tabular-nums'] as const;

export type Theme = {
  readonly scheme: 'light' | 'dark';
  readonly colors: Colors;
  readonly spacing: typeof spacing;
  readonly radius: typeof radius;
  readonly typography: typeof typography;
};

export const lightTheme: Theme = {
  scheme: 'light',
  colors: lightColors,
  spacing,
  radius,
  typography,
};

export const darkTheme: Theme = {
  scheme: 'dark',
  colors: darkColors,
  spacing,
  radius,
  typography,
};
