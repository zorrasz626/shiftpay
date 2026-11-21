# ShiftPay — Implementation Plan (all 7 phases)

Source: `SPEC.md` (same folder). No code yet.
Every task below follows the orchestration limits: one concern, ≤5 files changed, ≤5 acceptance criteria, one Verify command, sized for ~80 tool calls.
Each one becomes `.work/<task-id>/task.md` when it starts. Each task must leave the build green.

**Workers:** G = grunt (Sonnet) · I = implementer (Opus) · R = reviewer (Opus) · R* = reviewer (Fable: risky/stored data/release/core money logic)

**Standard Verify** (fixed in Task 1.1 and written into CLAUDE.md):
`npm run verify` = `tsc --noEmit && eslint . --quiet && jest --silent` (output to `.work/<task>/verify.log`)

---

## 0. Decisions to settle before Phase 1

These are gaps or ambiguities in the spec. I give a default for each, so the work can start if you agree.

| # | Question | Proposed default |
|---|---|---|
| D1 | Overtime + premium on the same hour: does OT replace the premium, or stack? | **Decided: user choice.** New Job field `overtimePremiumMode`: `replace` (OT rate only) · `highest` (the higher of OT and premium) · `stack` (uplifts add: 1.5 OT + 0.25 night = 1.75). Default `highest`; set in onboarding step 4 and Settings. |
| D2 | Do sick/holiday hours count towards weekly/period OT thresholds? | No (worked hours only). Configurable later. |
| D3 | Multipliers stored as floats (1.25)? | **Decided: decimals.** Multipliers, hours and flat £/h adds are decimal numbers (e.g. 1.25, 1.333). Stored money totals stay integer pence (spec §3). The engine works in decimals and rounds once per segment to whole pence, via one `roundPence()` helper that clears float noise first (so 28.5p never becomes 28p). |
| D4 | Shift times: UTC instants or local wall-clock? | Store UTC ISO instants **plus** the local date. Templates keep wall-clock `HH:mm`; converted via Europe/London at materialisation. A non-existent start (01:30 on the GMT→BST day) moves forward; an ambiguous one uses the first occurrence. |
| D5 | Bank holiday region is missing from the data model (Setting only has tax region). | **Decided: add** `bankHolidayRegion: england-and-wales \| scotland \| northern-ireland` to Job. |
| D6 | Monthly cut-off day is missing from Job. | **Decided: add** `periodCutoffDay` (1–31, clamped to the month length → February works). |
| D7 | Break deduction "longest/central segment". | Longest segment; on a tie, the earliest. |
| D8 | Does the free tier's "2 premium rules" include overtime rules? | Yes: 2 rules of any type. |
| D9 | `date-fns-tz` vs `@date-fns/tz` (date-fns v4). | `date-fns` v4 + `@date-fns/tz` (`TZDate`). It is the maintained successor and handles DST better. |
| D10 | Charts library. | `react-native-gifted-charts` (no Skia dependency, simpler build than victory-native). |

## Traps to give workers (they go into CLAUDE.md in Task 1.1)
- Stored money is integer pence; multipliers and hours are decimals. Rounding to pence happens only in `roundPence()`, once per segment; totals are sums of rounded segments, never re-rounded.
- Never call `new Date()` inside `src/engine`; "now" is always passed in. Every timezone conversion goes through one module (`src/engine/time.ts`).
- `src/engine` imports nothing from React, Expo or the DB. Jest enforces 100% coverage on `src/engine/**`.
- expo-sqlite does not run in Jest: repositories are tested against `better-sqlite3` with the same Drizzle schema.
- Drizzle migrations in Expo need the `.sql` metro extension and the `inline-import` babel plugin.

---

## Phase 1 — Scaffold + pay engine (TDD)

| ID | Task | Worker | Done when |
|---|---|---|---|
| 1.1 | Scaffold: `create-expo-app` (TS, Expo Router), strict TS, ESLint+Prettier, Jest (jest-expo), the §3 folder layout, placeholder screen, `npm run verify`, project CLAUDE.md (conventions + Traps + Commands), `git init`, `.gitignore` incl. `.work/` | G → R | `npm run verify` passes; `npx expo start` launches the placeholder |
| 1.2 | Engine types + money: `types.ts` (Job incl. `overtimePremiumMode`, `bankHolidayRegion`, `periodCutoffDay`; PremiumRule, Shift, Segment, Breakdown…), `money.ts` (`roundPence()`: pence rate × decimal hours × decimal multiplier → whole pence, half-up; formatting) | I → R | Tests: half-up rounding, float-noise cases (e.g. 0.285 × 100), multipliers like 1.333; coverage 100% |
| 1.3 | Time + bank holidays: `time.ts` (Europe/London wall-clock ↔ instant, day boundaries, DST detection); bundle `src/config/bankHolidays.json` snapshot + lookup by region | I → R* | Tests: 23h and 25h days, a non-existent and an ambiguous local time, the 3 regions |
| 1.4 | Segmentation: split a shift at midnight, time-band edges and DST changes; unpaid break deduction (D7) | I → R* | Required tests: night across midnight, shift into a BH at 00:00, BST→GMT 25h night, GMT→BST 23h night, break deduction |
| 1.5 | Premiums: time_band, day_of_week, bank_holiday; `stack` vs `highest_only`; per-rule attribution on each segment | I → R | Required test: stacking vs highest-only; flat £/h add. Make Segment extend `SegmentSlice` (1.4). Add `ruleAmounts: { ruleId, pence }[]` to Segment; `premiumPence` = sumPence of them (review note from 1.2) |
| 1.6 | Overtime + status: daily/weekly/period thresholds applied to the latest hours first (D2); OT on a premium hour per `overtimePremiumMode` (D1); sick/holiday at base rate, cancelled = 0 | I → R* | Required test: weekly threshold crossed mid-shift; daily; period; one night-OT hour under each of `replace` / `highest` / `stack`. Split a segment where an OT threshold is crossed, so `isOvertime` covers the whole segment (review note from 1.2). `calculateShift` filters rules by `jobId`; export one noise-clearing helper from money.ts and use it in premiums.ts instead of its `COMPARE_PRECISION` copy (review notes from 1.5) |
| 1.7 | Pay periods + aggregation: boundaries for all 4 frequencies (D6); per-period aggregate with per-rule breakdown | I → R | Required tests: all 4 frequencies incl. February monthly; period total = sum of shift totals. `calculateShifts` filters shifts by `job.id` (2nd job's hours must not count to thresholds); export `upliftPerHour` from premiums.ts and drop overtime.ts's `rawUplift` copy (review notes from 1.6) |
| 1.8 | Rota generation (pure): pattern + date range → planned shift instances | I → R | Required tests: 4-on-4-off and 2-2-3 over a full year, incl. both DST days |
| 1.9 | Payslip diff + holiday maths (pure): diff status (Match within £1 / Check / Under/Overpaid), likely-cause list; holiday fixed vs 12.07% accrual, entitled/accrued/booked/taken/remaining | I → R | Required tests: underpaid, overpaid, exact match; accrual cases |

Phase 1 exit: you run `npx expo start` + `npm run verify`; coverage report shows 100% for `src/engine`.

## Phase 2 — Database + rota materialisation

| ID | Task | Worker | Done when |
|---|---|---|---|
| 2.1 | Drizzle schema for §4 (+ D1, D4–D6 fields; multipliers as REAL), drizzle-kit config, first migration, metro/babel setup, `db/client.ts` that migrates on start | I → R* | App starts and migrates on device; schema test on better-sqlite3 |
| 2.2 | Repositories: jobs, premium rules, shift templates, rota patterns (CRUD) | I → R | Repo tests on better-sqlite3 |
| 2.3 | Repositories: shifts, payslips (+ lines), settings | I → R | Repo tests; shift start/end are truncated to whole minutes on save (review note from 1.4) |
| 2.4 | Materialisation service: rolling window −90/+120 days, idempotent, manual edits and status changes never overwritten, regeneration when a pattern changes | I → R* | Tests: rerun = no duplicates; manual edit survives a pattern change; window rolls forward |
| 2.5 | Zustand stores (jobs, shifts, settings) + app bootstrap (migrate → materialise → load) | I → R | Verify passes; app boots on an empty DB |

## Phase 3 — Core screens

Run the `frontend-design` skill once in 3.1 to set the visual direction; later screens reuse its components.

| ID | Task | Worker | Done when |
|---|---|---|---|
| 3.1 | Design system: theme tokens (light/dark, AA contrast), BigNumber, Card, Button, Chip, Disclaimer components; tab layout | I → R | Components render in both themes; contrast checked; one on-device check that `time.ts` (Intl timeZone on Hermes) gives correct BST/GMT offsets (review note from 1.3) |
| 3.2 | Onboarding 1–2: job + base rate; pay frequency + next pay date (+ cut-off day for monthly) | I → R | Data saved through repos; disclaimer shown |
| 3.3 | Onboarding 3–4: pick/create rota pattern; premium presets (Nights ×1.25, Sundays ×1.5, BH ×2, OT after 39h ×1.5) + "overtime on a premium hour" choice (D1); bank holiday region; first-run routing | I → R | Finishing onboarding materialises shifts and lands on Home |
| 3.4 | Home / This period: gross so far, projected total, next shift card, pay-day countdown | I → R | Numbers match the engine for a seeded fixture |
| 3.5 | Calendar month view, colour-coded shifts | I → R | Month navigation; DST months render correctly |
| 3.6 | Day sheet: mark worked/sick/holiday/cancelled/overtime, add/edit manual shift (≤2 taps to confirm a shift) | I → R | Edits persist and survive re-materialisation |
| 3.7 | Shift detail: segment breakdown (base / night / Sunday / OT) with amounts | I → R | Breakdown sums to the shift total |
| 3.8 | Settings A: jobs, rates, bank holiday region, cut-off day, `overtimePremiumMode`, premium & overtime rule editor (decimal multipliers) | I → R | Rule edits recalculate Home |
| 3.9 | Settings B: rota patterns + shift templates editor, about/disclaimer, privacy-policy link | I → R | Pattern edit regenerates future shifts only |

## Phase 4 — Pay periods, payslip checker, holiday

| ID | Task | Worker | Done when |
|---|---|---|---|
| 4.1 | Pay periods list → period detail (per-rule breakdown, shift list) | I → R | Totals match the engine aggregate |
| 4.2 | Payslip entry: gross, optional hours, optional lines, tax/NI/pension/net | I → R | Saved and editable per period |
| 4.3 | Payslip check result: Expected vs Paid, £ and hours diff, status chip, likely causes | I → R | The 3 fixture cases render correctly; disclaimer shown |
| 4.4 | Holiday screen: entitlement ring, booking holiday from the calendar | I → R | Booked/taken/remaining update after booking |

**→ After Phase 4, start the Play closed test (see "Your tasks").** The app is useful at this point, and the 14-day clock can run while Phases 5–7 are built.

## Phase 5 — Notifications, backup, bank-holiday refresh

| ID | Task | Worker | Done when |
|---|---|---|---|
| 5.1 | Reminder planner (pure: shifts + lead time → triggers, capped to the next N) + expo-notifications scheduler, Android 13 permission, reschedule on any shift change | I → R | Planner tests; reminders fire on a device |
| 5.2 | Notification settings UI (on/off, lead time) | I → R | Changing lead time reschedules |
| 5.3 | Backup export: versioned JSON of all tables → share sheet | I → R* | Round-trip test: export → import equals original |
| 5.4 | Backup import: validate (zod), confirm, replace in one transaction, re-materialise | I → R* | Invalid/old files are rejected without data loss |
| 5.5 | Bank holiday refresh from gov.uk when online; falls back to the bundled snapshot | I → R | Offline start still works; refreshed data is used |

## Phase 6 — Pro, paywall, net pay, stats

| ID | Task | Worker | Done when |
|---|---|---|---|
| 6.1 | RevenueCat SDK init + `useEntitlement()` hook + dev-build override | I → R* | Hook returns free/pro; no key committed to git |
| 6.2 | Feature gating per §8 (job/pattern/rule limits, line-by-line check, export, stats, backup) | I → R | Each gate tested free vs pro |
| 6.3 | Paywall screen (monthly, annual with 7-day trial, lifetime; restore purchases) | I → R* | Purchase + restore work with Play test accounts |
| 6.4 | `src/config/taxYears.ts` (2026/27, every value `// TODO-VERIFY gov.uk`) + net-pay engine (PAYE cumulative, NI, student loan, pension) with tests | I → R* | Tests pass; tax year shown in output |
| 6.5 | Net-pay UI on Home and period detail ("rough estimate" label + disclaimer) | I → R | Pro only; shows the tax year used |
| 6.6 | Payslip check export: PDF (expo-print) + CSV via share sheet | I → R | Files open on device |
| 6.7 | Stats screen: earnings by month, OT hours, premiums earned | I → R | Pro only; empty state when no data |

## Phase 7 — Release prep

| ID | Task | Worker | Done when |
|---|---|---|---|
| 7.1 | EAS: app.json/eas.json, package name, versionCode policy, target API level, production profile | I → R* | `eas build -p android --profile preview` succeeds |
| 7.2 | Privacy policy page (GitHub Pages) + store listing text (short/full description, ASO keywords) | I → R | Policy matches the actual data use (RevenueCat only) |
| 7.3 | Polish A: accessibility labels, font scaling, contrast on all screens | I → R | No unlabelled touchables |
| 7.4 | Polish B: empty states, error handling, performance (calendar/period lists) | I → R | Large-fixture test (2 years of shifts) stays smooth |

---

## Your tasks (can't be delegated)
- **Now:** check the "ShiftPay" name on Play / UK trademark search.
- **Now:** you already have a personal Play account (from DriverBooks), so the 12-testers / 14-days rule applies. Recruit testers early; the DriverBooks testers may be reusable.
- **Phase 6:** create the RevenueCat project and Play subscription/lifetime products.
- **Before release:** verify every `TODO-VERIFY` tax value and the 12.07% holiday rule on gov.uk (done 2026-11-21 for 2026/27, sources in `src/config/taxYears.ts` and `src/engine/holiday.ts`); check the current target API level in the Play Console.
- Screenshots, icon, feature graphic, Data safety form, content rating.

## Totals
43 tasks: Phase 1 = 9, Phase 2 = 5, Phase 3 = 9, Phase 4 = 4, Phase 5 = 5, Phase 6 = 7, Phase 7 = 4. 1 grunt task, 42 implementer tasks; 11 of them get a Fable review.
