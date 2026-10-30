# ShiftPay — Build Spec (for Claude Code)

> Working name: **ShiftPay** (check Play Store / trademark availability before launch).
> Put this file in an empty folder as `SPEC.md`, open Claude Code in that folder, and start with the prompt in **§11 Phase 1**.

---

## 1. Product summary

An Android-first app for UK shift workers (logistics, warehouses, NHS, retail, care, security, transport) that:

1. Stores their **rota / shift pattern** (including rotating cycles like 4-on-4-off).
2. Calculates **expected gross pay** per shift and per pay period, including night, weekend, bank-holiday and overtime premiums.
3. **Checks the payslip**: the user types in what they were paid, and the app shows any difference and what caused it.
4. Tracks **holiday entitlement** and what has been used.
5. Sends **shift reminders**.

**Positioning:** "Know exactly what you should be paid — and catch payslip mistakes."
**Must stay generic:** no employer names, logos, pay agreements or company data. Users enter their own rates.

---

## 2. Principles

- **Local-first, no backend in v1.** All data is stored on the device. That means no server costs, no login, simpler GDPR, and the app keeps running on its own.
- **Pay-engine correctness is the product.** The calculation logic lives in a pure TypeScript module with heavy unit tests and no UI dependencies.
- **Quick daily use.** Logging or confirming a shift takes 2 taps or fewer.
- **Offline always works.**
- **Everything is an estimate.** Show the disclaimer: "Estimates only — not financial or tax advice. Always check with your employer/payroll."

---

## 3. Tech stack

| Concern | Choice |
|---|---|
| Framework | **Expo (React Native) + TypeScript**, Expo Router |
| Local DB | `expo-sqlite` + **Drizzle ORM** (with migrations) |
| State | Zustand |
| Dates | `date-fns` + `date-fns-tz` (always Europe/London; handle BST changes) |
| Money | Store as **integer pence**, never floats |
| Notifications | `expo-notifications` (local, scheduled) |
| Subscriptions | **RevenueCat** (`react-native-purchases`) for Google Play Billing |
| Charts | `victory-native` or `react-native-gifted-charts` |
| Tests | Jest + `@testing-library/react-native`; the pay engine gets 100% coverage |
| Build / release | EAS Build → AAB → Google Play Console |
| Lint | ESLint + Prettier, `strict: true` TypeScript |

Folder layout:

```
app/                 # Expo Router screens
src/engine/          # PURE pay/rota/holiday logic (no React, no DB)
src/engine/__tests__/
src/db/              # Drizzle schema, migrations, repositories
src/store/           # Zustand stores
src/components/
src/config/          # tax-year config, bank holidays snapshot
src/features/pro/    # paywall + entitlement gating
```

---

## 4. Data model (SQLite via Drizzle)

- **Job**: id, name (e.g. "Main job"), baseRatePence (per hour), payFrequency (`weekly | fortnightly | four_weekly | monthly`), payPeriodAnchorDate, payDayOffsetDays, contractedHoursPerWeek, holidayYearStart (date), holidayEntitlementHours, colour.
- **PremiumRule**: id, jobId, name, type (`time_band | day_of_week | bank_holiday | overtime_daily | overtime_weekly | overtime_period`), multiplier (e.g. 1.5) **or** flatAddPencePerHour, startTime/endTime (for time bands, which can cross midnight), daysOfWeek[], thresholdHours (for overtime), stacking (`stack | highest_only`), priority.
- **ShiftTemplate**: id, jobId, name ("Early", "Late", "Night"), startTime, endTime, unpaidBreakMinutes, colour.
- **RotaPattern**: id, jobId, cycleLengthDays, startDate, days[] (each day = shiftTemplateId or `OFF`).
- **Shift**: id, jobId, date, start (datetime), end (datetime), unpaidBreakMinutes, source (`pattern | manual`), status (`planned | worked | sick | holiday | cancelled`), overtimeFlag, notes. Generated shifts from patterns are materialised for a rolling window (e.g. -90 to +120 days), and manual edits override them.
- **Payslip**: id, jobId, periodStart, periodEnd, grossPaidPence, hoursPaid (optional), lines[] (optional: label, hours, amountPence), taxPence, niPence, pensionPence, netPence (optional).
- **Setting**: key/value (units, notification lead time, tax region `rUK | scotland`, tax code, student loan plan, pension %).

---

## 5. Pay engine rules (src/engine)

The engine has pure functions only. Inputs are a shift plus the job's rules. The output is a breakdown of segments.

1. **Split each shift into segments** at every boundary: midnight, time-band edges and BST/GMT changeovers. A 22:00–06:00 night shift crosses two dates and may cross a bank holiday.
2. **Unpaid breaks**: deduct from the longest/central segment by default (make this configurable later).
3. **Apply premiums per segment**:
   - `time_band` (e.g. nights 22:00–06:00 ×1.25)
   - `day_of_week` (e.g. Sunday ×1.5)
   - `bank_holiday` (e.g. ×2). Use the bundled **England & Wales / Scotland / NI** bank-holiday list; source is `https://www.gov.uk/bank-holidays.json`. Bundle a snapshot in `src/config/` and refresh it in-app when online.
   - Stacking: `highest_only` (default) or `stack` (multipliers add their uplift: 1.25 + 1.5 → 1.75).
4. **Overtime**:
   - daily (hours beyond X in a shift), weekly (beyond X in a Mon–Sun or custom week), or per pay period.
   - Overtime is applied after base/premium allocation, to the **latest** hours first.
5. **Status handling**: `sick` and `holiday` shifts are paid at the base rate by default (configurable to unpaid or SSP later). `cancelled` = 0.
6. **Pay periods**: generate period boundaries from frequency + anchor date. Monthly periods use a configurable cut-off day.
7. **Output**: `{ segments[], basePence, premiumPence, overtimePence, totalGrossPence, paidHours }` per shift, and an aggregate per period with a per-rule breakdown.
8. **Rounding**: round to the nearest penny **per segment**, and make sure the totals equal the sum of the segments.

### Estimated net pay (Pro feature)
- Put tax-year values in `src/config/taxYears.ts` (one object per tax year, starting 6 April). Include the personal allowance, bands for rUK and Scotland, employee Class 1 NI thresholds and rates, and student-loan plan thresholds.
- **⚠ Verify every value against gov.uk before release and update each April.** The app must show which tax year it is using.
- Use a simple period-based PAYE estimate (cumulative tax code only, e.g. `1257L`). Show a "rough estimate" label.

### Holiday
- Fixed entitlement in hours, **or** the irregular-hours accrual of **12.07% of hours worked** (UK rule for irregular-hours and part-year workers for leave years from April 2024; verify on gov.uk).
- Show entitled, accrued, booked, taken and remaining for the current holiday year.

### Required unit tests (write these first, TDD)
- Night shift crossing midnight with a time-band premium
- Shift crossing into a bank holiday at 00:00
- Night shift across a BST → GMT change (25-hour night) and GMT → BST (23-hour night)
- Unpaid break deduction
- Stacking vs highest-only premiums
- Weekly overtime threshold crossed mid-shift
- Pay-period boundaries for all 4 frequencies, including a February monthly period
- 4-on-4-off and 2-2-3 rota generation across a year
- Penny rounding: the period total equals the sum of its shifts
- Payslip diff: underpaid, overpaid and exact match

---

## 6. Payslip checker

- The user selects a pay period, enters the gross paid amount (and optionally hours or individual lines).
- The app shows **Expected vs Paid**, the difference in £ and hours, and a list of the likely causes. For example, the app compares its own shift-by-shift breakdown with the payslip lines it was given: "Sunday premium for 3 Oct not found?" or "Overtime threshold not met?"
- Status chip: ✅ Match (within £1) / ⚠ Check / ❌ Underpaid by £X.
- **Export** a PDF/CSV summary the user can take to payroll (Pro).

---

## 7. Screens (Expo Router)

1. **Onboarding** (3–4 steps): job name + base rate → pay frequency + next pay date → pick or create a rota pattern → optional premiums (offer presets: "Nights ×1.25", "Sundays ×1.5", "Bank hols ×2", "Overtime after 39h/week ×1.5").
2. **Home / This period**: big number for expected gross so far and the projected total; next shift card; pay day countdown.
3. **Calendar**: month view with colour-coded shifts. Tap a day to edit, mark as worked, sick, holiday or overtime, or add a manual shift.
4. **Shift detail**: segment breakdown (base / night / Sunday / OT) with amounts.
5. **Pay periods** list → period detail → **Check payslip**.
6. **Holiday**: entitlement ring, plus booking holiday from the calendar.
7. **Stats** (Pro): earnings by month, overtime hours, premiums earned.
8. **Settings**: jobs, rates, premiums, rota patterns, notifications, tax settings, backup/export, about and disclaimer, privacy policy link.
9. **Paywall**.

Design: clean and modern, large numbers, dark mode, accessible contrast, one-handed use.

---

## 8. Monetisation (RevenueCat)

| Free | Pro (£1.99/month · £12.99/year · £24.99 lifetime) |
|---|---|
| 1 job, 1 rota pattern | Unlimited jobs and patterns |
| Expected gross pay | Estimated **net** pay (tax/NI/pension/student loan) |
| Basic premiums (2 rules) | Unlimited premium and overtime rules |
| Payslip check: gross only | Line-by-line payslip check + PDF/CSV export |
| Shift reminders | Stats and charts, home-screen widget (later), backup to file |

- Gate features through a single `useEntitlement()` hook.
- Offer a 7-day free trial on the annual plan.
- **No ads in v1**. They make the app look less trustworthy, and trust matters for an app about pay.

---

## 9. Privacy and compliance

- No accounts and no analytics in v1, other than RevenueCat. This keeps the Play **Data safety** form simple.
- Host a privacy policy page (GitHub Pages is fine).
- Show the disclaimer in onboarding and on every net-pay and payslip screen.
- Backup: export/import a JSON file through the share sheet (the user owns the file).

---

## 10. Google Play launch checklist

- [ ] Google Play developer account ($25 one-off, identity verification)
- [ ] **New personal accounts must run a closed test with at least 12 testers for 14 continuous days** before production access. Recruit these early (friends, colleagues, forums). Verify the current rule in the Play Console.
- [ ] Target the current required Android API level (check the Play Console)
- [ ] App icon, feature graphic, 4–8 screenshots, short and full description (ASO keywords: shift pay calculator, rota, overtime, payslip checker, UK, night shift)
- [ ] Data safety form, content rating, privacy policy URL
- [ ] RevenueCat products set up in the Play Console (subscriptions + one-time lifetime product)
- [ ] EAS production build (AAB), internal testing → closed testing → production

---

## 11. Build phases — prompts to paste into Claude Code

Run them one at a time. After each phase, run the app (`npx expo start`) and the tests before moving on.

**Phase 1 — Scaffold + engine (most important)**
> Read SPEC.md. Scaffold an Expo + TypeScript project with Expo Router, ESLint/Prettier, Jest, and the folder layout in §3. Then build `src/engine/` exactly as described in §5 using TDD: write all the unit tests listed in "Required unit tests" first, then implement until they pass. Money in integer pence, timezone Europe/London. No UI yet beyond a placeholder screen. Create a CLAUDE.md summarising the conventions.

**Phase 2 — Database + rota generation**
> Implement the Drizzle/expo-sqlite schema from §4 with migrations and repository functions. Add rota pattern → shift materialisation for a rolling window, with manual edits overriding generated shifts. Add tests.

**Phase 3 — Core screens**
> Build onboarding, Home, Calendar, Shift detail and Settings (§7) wired to the DB and engine. Include the premium presets. Dark mode and accessible contrast.

**Phase 4 — Pay periods, payslip checker, holiday**
> Build pay period list/detail, the payslip checker (§6) and the holiday tracker (§5 Holiday).

**Phase 5 — Notifications + backup**
> Local shift reminders (configurable lead time, rescheduled whenever shifts change) and JSON export/import through the share sheet.

**Phase 6 — Pro + paywall**
> Integrate RevenueCat, the `useEntitlement()` hook, feature gating per §8, the paywall screen, net-pay estimate (§5) using `src/config/taxYears.ts` with clearly marked TODO-VERIFY values, and stats charts.

**Phase 7 — Release prep**
> Configure EAS (app.json/eas.json, package name, versioning), generate store listing text and a privacy policy page (§9), and do a final pass on accessibility, empty states, error handling and performance.

---

## 12. Later ideas (not v1)

Home-screen widget (next shift + period pay), multiple jobs on one calendar, sick pay (SSP) rules, cloud sync, iOS release, shift-swap notes, import a rota from a photo using AI (good Pro upsell), Welsh language.
