/**
 * Money helpers for the pay engine.
 *
 * Money is integer pence. Rates, hours and multipliers are decimals (D3).
 * `roundPence()` is the ONLY place an amount is rounded; `segmentPence()` is
 * the only caller that turns a decimal amount into pence. Totals are sums of
 * rounded segment amounts (`sumPence()`), never re-rounded.
 */

/** Significant digits kept when clearing float noise (safe for amounts below ~£100m). */
const NOISE_PRECISION = 12;

/** Clear float noise without rounding (0.1 + 0.2 -> 0.3). Use before comparing decimal amounts. */
export function clearNoise(x: number): number {
  return Number(x.toPrecision(NOISE_PRECISION));
}

/**
 * Round a decimal pence amount to whole pence.
 * Float noise is cleared first (0.285 * 100 = 28.499999999999996 -> 28.5),
 * then exact halves round away from zero (28.5 -> 29, -28.5 -> -29).
 * Throws RangeError on NaN or +/-Infinity. Never returns -0.
 */
export function roundPence(x: number): number {
  if (!Number.isFinite(x)) {
    throw new RangeError(`roundPence: expected a finite number, got ${x}`);
  }
  const cleaned = clearNoise(x);
  const rounded = Math.sign(cleaned) * Math.floor(Math.abs(cleaned) + 0.5);
  return rounded + 0; // turns -0 into 0
}

/**
 * Pay for one segment, in whole pence:
 * `roundPence(ratePencePerHour * minutes / 60 * multiplier)`.
 */
export function segmentPence(ratePencePerHour: number, minutes: number, multiplier = 1): number {
  return roundPence(((ratePencePerHour * minutes) / 60) * multiplier);
}

/** Sum integer pence values. Throws TypeError if any value is not an integer. */
export function sumPence(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isInteger(value)) {
      throw new TypeError(`sumPence: expected integer pence, got ${value}`);
    }
    total += value;
  }
  return total;
}

/** Format integer pence as `£1,234.56` / `-£12.30` / `£0.00` (no Intl). */
export function formatPence(p: number): string {
  if (!Number.isInteger(p)) {
    throw new TypeError(`formatPence: expected integer pence, got ${p}`);
  }
  const sign = p < 0 ? '-' : '';
  const abs = Math.abs(p);
  const pounds = Math.floor(abs / 100);
  const pence = abs % 100;
  const groupedPounds = String(pounds).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const pencePart = pence < 10 ? `0${pence}` : String(pence);
  return `${sign}£${groupedPounds}.${pencePart}`;
}

/** Typographic minus (U+2212) for signed differences; `formatPence` keeps the ASCII hyphen. */
export const MINUS_SIGN = '−';

/** Signed difference: `120` -> `+£1.20`, `-1800` -> `−£18.00`, `0` -> `£0.00`. */
export function formatSignedPence(pence: number): string {
  if (pence > 0) return `+${formatPence(pence)}`;
  if (pence < 0) return `${MINUS_SIGN}${formatPence(-pence)}`;
  return formatPence(0);
}

/**
 * Optional leading minus, optional £, pounds either plain digits or correctly
 * comma-grouped, then optionally 1-2 decimal places.
 */
const POUNDS_PATTERN = /^(-)?£?(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/;

export interface ParsePoundsOptions {
  /** Plain digits only ("1.10", "2"): no minus, £ or commas. */
  plain?: boolean;
}

/**
 * Parse a pounds string (`"12.3"`, `"£1,234.56"`, `"-£12.30"`) to integer pence.
 * Returns null on invalid input (including more than 2 decimal places).
 * Uses string arithmetic only, so no float noise is introduced.
 */
export function parsePoundsToPence(text: string, options: ParsePoundsOptions = {}): number | null {
  const trimmed = text.trim();
  if (options.plain === true && /[-£,]/.test(trimmed)) {
    return null;
  }
  const match = POUNDS_PATTERN.exec(trimmed);
  if (match === null) {
    return null;
  }
  const [, minus, poundsText, decimalsText = ''] = match;
  const pounds = Number(poundsText.replace(/,/g, ''));
  const pence = Number(decimalsText.padEnd(2, '0'));
  const magnitude = pounds * 100 + pence;
  if (!Number.isSafeInteger(magnitude)) {
    return null;
  }
  return (minus === undefined ? magnitude : -magnitude) + 0; // turns -0 into 0
}
