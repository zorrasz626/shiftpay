// Dev-only check that time.ts gives the right Europe/London offsets on this JS
// engine (Hermes Intl support varies). Fixed instants only; expectations are
// copied from src/engine/__tests__/time.test.ts.

import { instantToLocal, localToInstant, utcOffsetMinutes } from '../engine/time';

type Check = { name: string; actual: () => unknown; expected: unknown };

const CHECKS: readonly Check[] = [
  {
    name: 'BST offset 2026-07-01T12:00Z',
    actual: () => utcOffsetMinutes('2026-07-01T12:00:00.000Z'),
    expected: 60,
  },
  {
    name: 'GMT offset 2026-01-15T12:00Z',
    actual: () => utcOffsetMinutes('2026-01-15T12:00:00.000Z'),
    expected: 0,
  },
  {
    name: 'spring-forward gap 2026-03-29 01:30 -> instant',
    actual: () => localToInstant('2026-03-29', '01:30'),
    expected: '2026-03-29T01:30:00.000Z',
  },
  {
    name: 'spring-forward gap 2026-03-29 01:30 -> local 02:30',
    actual: () => instantToLocal(localToInstant('2026-03-29', '01:30')).time,
    expected: '02:30',
  },
  {
    name: 'autumn overlap 2026-10-25 01:30 -> first occurrence',
    actual: () => localToInstant('2026-10-25', '01:30'),
    expected: '2026-10-25T00:30:00.000Z',
  },
  {
    name: 'autumn overlap 2026-10-25T00:30Z -> local 01:30',
    actual: () => instantToLocal('2026-10-25T00:30:00.000Z').time,
    expected: '01:30',
  },
  {
    name: 'autumn overlap 2026-10-25T01:30Z -> local 01:30',
    actual: () => instantToLocal('2026-10-25T01:30:00.000Z').time,
    expected: '01:30',
  },
];

export function tzSelfCheck(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  for (const check of CHECKS) {
    let actual: unknown;
    try {
      actual = check.actual();
    } catch (e) {
      failures.push(`${check.name}: threw ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (actual !== check.expected) {
      failures.push(
        `${check.name}: expected ${JSON.stringify(check.expected)}, got ${JSON.stringify(actual)}`,
      );
    }
  }
  return { ok: failures.length === 0, failures };
}
