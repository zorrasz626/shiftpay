# ShiftPay

Android-first Expo (React Native) + TypeScript app for UK shift workers: stores rota, calculates expected gross pay, checks payslips, tracks holiday, reminds of shifts. Spec: SPEC.md; plan: PLAN.md.

## Conventions
- Folders: `app/` Expo Router screens; `src/engine/` pure pay/rota/holiday logic; `src/db/` Drizzle schema + repositories; `src/store/` Zustand; `src/components/`; `src/config/` tax-year + bank holidays; `src/features/pro/` paywall.
- Timezone is always Europe/London (handle BST changes).
- Money: stored as integer pence, never floats. Multipliers, hours and flat adds are decimals (D3).
- D1: overtime + premium on the same hour follows Job `overtimePremiumMode` (`replace` | `highest` | `stack`, default `highest`).
- D3: decimals in the engine; round to pence once per segment via `roundPence()`.
- D5: Job has `bankHolidayRegion` (england-and-wales | scotland | northern-ireland).
- D6: Job has `periodCutoffDay` (1-31, clamped to month length).
- Hard rule: no employer names, logos or pay agreements anywhere (SPEC §1).
- Show the disclaimer: "Estimates only — not financial or tax advice. Always check with your employer/payroll."

## Traps
- Stored money is integer pence; multipliers and hours are decimals. Rounding to pence happens only in `roundPence()`, once per segment; totals are sums of rounded segments, never re-rounded.
- Never call `new Date()` inside `src/engine`; "now" is always passed in. Every timezone conversion goes through one module (`src/engine/time.ts`).
- `src/engine` imports nothing from React, Expo or the DB. Jest enforces 100% coverage on `src/engine/**`.
- expo-sqlite does not run in Jest: repositories are tested against `better-sqlite3` with the same Drizzle schema.
- Drizzle migrations in Expo need the `.sql` metro extension and the `inline-import` babel plugin.
- Android build on this Windows machine: `ANDROID_HOME` isn't set globally (pass it per command), and reanimated's C++ build needs CMake ≥3.31 (`cmake.dir` in the git-ignored `android/local.properties`); SDK CMake 3.22.1's ninja breaks on paths >260 chars even with LongPathsEnabled. Give the emulator ≥4 GB RAM or the app ANRs at startup.

## Commands
- Start: `npm start`
- Test: `npm test`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Verify (all): `npm run verify`

<!-- orchestration-setup: done -->
