# ShiftPay: Google Play store listing

Text to paste into the Play Console. Character counts are of the text inside each code block (Play limits in brackets). Before publishing, check the privacy policy URL works: `https://zorrasz626.github.io/shiftpay/privacy`.

Rules for any edit: no employer names, logos or pay agreements (SPEC §1); every figure is an estimate; no claim of accuracy, financial or tax advice.

## App name (30 / 30)

```text
ShiftPay: Shift Pay Calculator
```

## Short description (76 / 80)

```text
Estimate your shift pay, keep your rota and check your payslip for mistakes.
```

## Full description (1748 / 4000)

```text
ShiftPay helps UK shift workers estimate what they should be paid and spot possible payslip mistakes. Enter your own rates and rota once, and ShiftPay works out the expected gross pay for every shift and pay period.

Made for anyone on shifts: warehouses and logistics, care, healthcare, retail, security, transport, hospitality and more. ShiftPay is generic: you enter your own pay rates and rules.

ROTA AND SHIFTS
• Set up rotating patterns such as 4-on-4-off, or add shifts one by one
• Confirm or change a shift in a couple of taps
• Shift reminders before each shift

PAY ESTIMATES
• Expected gross pay per shift and per pay period
• Night, weekend, bank holiday and overtime premiums, using your own rules
• UK bank holidays for England and Wales, Scotland and Northern Ireland
• Handles clock changes (BST) and shifts that cross midnight

PAYSLIP CHECK
• Type in what your payslip says and compare it with the estimate
• See where the difference comes from, so you know what to ask payroll about

HOLIDAY
• Track your holiday entitlement and what you have used

PRIVATE BY DESIGN
• No account and no sign-in
• Your rota, pay and payslip details stay on your phone
• No ads, no analytics
• Works offline

SHIFTPAY PRO
Upgrade for more, with a 7-day free trial on the yearly plan:
• Unlimited jobs, rota patterns and premium rules
• Estimated take-home (net) pay with tax, National Insurance, student loan and pension
• Line-by-line payslip check, with PDF and CSV export
• Stats and charts
• Backup to a file you keep

Pro is available monthly, yearly or as a one-off lifetime purchase. Subscriptions renew automatically until you cancel in Google Play.

Estimates only — not financial or tax advice. Always check with your employer/payroll.
```

## ASO keywords

Play has no keyword field; these phrases are worked into the text above. Keep them generic (no employer names):

shift pay calculator, rota, rota planner, overtime calculator, payslip checker, UK, night shift, bank holiday pay, holiday tracker, wage calculator, shift worker, 4 on 4 off

## Store settings

- Category: Finance (alternative: Productivity)
- Tags: personal finance, calendar, productivity
- Contact email: zorrasz@protonmail.com
- Privacy policy URL: `https://zorrasz626.github.io/shiftpay/privacy`
- Contains ads: No
- In-app purchases: Yes (subscriptions monthly and yearly, one-time lifetime product)

## Data safety form

Overview answers:

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | Yes (purchase data via RevenueCat) |
| Is all user data collected by your app encrypted in transit? | Yes (RevenueCat and GOV.UK use HTTPS) |
| Do you provide a way for users to request that their data is deleted? | Yes: email zorrasz@protonmail.com (RevenueCat record); on-device data is removed by uninstalling or clearing storage |
| Account creation | The app does not let users create an account |

Data types (anything not listed: not collected, not shared):

| Data type | Collected? | Shared? | Processed ephemerally? | Required or optional? | Purposes |
|---|---|---|---|---|---|
| Financial info > Purchase history | Yes (RevenueCat, our processor) | No | No | Required (needed to unlock and restore Pro) | App functionality |
| Device or other IDs | Yes: RevenueCat's random anonymous app user ID | No | No | Required | App functionality |
| Financial info > Other financial info (pay rates, payslips, tax settings) | No: stored only on the device, never sent off it | No | n/a | n/a | n/a |
| Personal info (name, email, address, phone) | No | No | n/a | n/a | n/a |
| Location, contacts, photos, files, messages, audio, calendar, health | No | No | n/a | n/a | n/a |
| App activity, app info and performance (analytics, crash logs, diagnostics) | No | No | n/a | n/a | n/a |

Notes for the form:
- "Shared" is No: RevenueCat processes purchase data on our behalf as a service provider, which Google does not count as sharing. Payment itself is handled by Google Play.
- Data that never leaves the device (the SQLite database, local reminders) is not "collected" in Play's definition. Backups and payslip exports go only where the user sends them through the share sheet, so they are not collected either.
- The GOV.UK bank-holiday download sends no user data (only the IP address that any internet request reveals), so it is not declared.
- Before submitting, compare these answers with RevenueCat's current Play Data safety guidance in its docs, in case its SDK's data list has changed.

## Content rating (IARC questionnaire)

- Category: Utility, productivity, communication or other (not a game).
- Violence, sexual content, profanity, drugs, alcohol, tobacco, gambling, horror: none.
- User-generated content shared with other users: No. Users cannot talk to each other.
- Shares the user's location: No.
- Digital purchases: Yes (in-app purchases of ShiftPay Pro).
- Expected rating: PEGI 3 / Everyone.

## Target audience

- Target age group: 18 and over (working adults). Not designed for children.
