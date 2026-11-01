/**
 * PAYE tax-code parsing (the common forms only).
 *
 * Supported: `<digits>L|M|N|T` (allowance = digits x £10 + £9; `0T` = no
 * allowance), `BR`, `D0`, `D1`, `NT`, each with an optional `S` (Scottish
 * bands) or `C` (Welsh = rUK bands) prefix. Case- and space-insensitive.
 * Unsupported (returns null): K codes, emergency `W1`/`M1`/`X` suffixes and
 * anything else.
 */
import type { FlatRateCode, ParsedTaxCode } from './types';

const TAX_CODE_PATTERN = /^([SC])?(?:(\d{1,6})([LMNT])|(BR|D0|D1|NT))$/;

export function parseTaxCode(text: string): ParsedTaxCode | null {
  const code = text.replace(/\s+/g, '').toUpperCase();
  const match = TAX_CODE_PATTERN.exec(code);
  if (match === null) {
    return null;
  }
  const [, prefix, digits, , named] = match;
  const region = prefix === 'S' ? 'scotland' : 'ruk';
  if (named === 'NT') {
    return { kind: 'noTax', code };
  }
  if (named !== undefined) {
    return { kind: 'flat', region, flat: named as FlatRateCode, code };
  }
  const units = Number(digits);
  const allowancePence = units === 0 ? 0 : (units * 10 + 9) * 100;
  return { kind: 'allowance', region, allowancePence, code };
}
