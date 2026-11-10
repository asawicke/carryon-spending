# November 9 feedback fixes

The supplied palette and Ben's notes were grouped into the areas below before implementation. Today → Expenses → Plan, the content width, and the existing card layout remain in place. This update is local; GitHub will be updated only when requested. The normal app was left open on port 5050 with its two existing trips; the separate QA server was stopped.

## Feedback coverage

| Area | Feedback | Implemented fix | Verification |
| --- | --- | --- | --- |
| Startup | Loading trips, then unexpectedly landing on Plan | Trip loading no longer waits for exchange rates. Empty installations show an intentional welcome page; creating a first trip is explicit. Connection failures have a retry state. | Empty-database welcome and retry paths; independent loading in `useCarryOn.js`. |
| Startup | Explain how the app works | Three-step first-trip guide; tutorial available again in Settings. | Browser welcome and Settings. |
| Currency | Too few world currencies | 161 provider-supported currencies with full names, from an actual Frankfurter response; shared backend/frontend catalog. Crypto assets are excluded. | Catalog count/schema and catalog agreement test; real rate endpoint retained. |
| Trip setup | Past dates should not be an accidental choice | New trips default to today/future dates. “Record a past trip” explicitly enables history entry. Existing past trips remain editable. | API rejection/explicit opt-in tests and rendered date constraints. |
| Trip setup | Multiple destinations/currencies | Up to 12 stops, country, local currency and dates; contiguous non-overlapping days; expense destination selection and per-stop currency defaults. | Multi-stop API tests, country/currency controls, saved itinerary. |
| Planning | Suggest category amounts, allow editing | Preview a split after entering known Flights/Stay/Transit costs and one reserve; explicitly apply, adjust, and save. Starting daily shares: Food 50%, Activities 30%, Shopping 10%, Other 10%. These are design defaults, not researched typical traveler costs. | Exact-total test; browser preview/apply/save. |
| Planning | Daily budget should exclude major fixed costs | Daily guidance uses selected daily categories, protects outstanding fixed allocations and the reserve, and accounts for overspending. Plan exposes the daily-category selection. | Pure calculation checks: prepaid flight does not consume today's daily target; lunch does; reserve/fixed overspending stays protected. |
| Planning | Buffer duplicates emergency extra costs | One “Emergency reserve” allocation. No emergency extra-cost row. A checked legacy reminder moves into the draft reserve for review before saving. | Plan UI, allocation validation; old records backed up and retained. |
| Planning | Adjust guidance for countries and multiple destinations | Recent World Bank GDP price-level indexes weight the relative daily split. Source/year are displayed, missing/old observations receive neutral weight, and the user can adjust category budgets. | Actual France/Thailand reference observations; suggestion and daily-weight tests. |
| Flights | City input is limited to three characters | City/airport search accepts full text and returns selectable named airports with IATA code and country; direct codes still work. Explicit Find requests are cached for seven days. | Real “Paris” lookup returned CDG, ORY, BVA and other matches; CDG selected in the browser. |
| Flights | Flight search not configured | Flask automatically loads supported settings from the local `.env`, without executing it. Settings shows configuration status without revealing secrets. Optional AirLabs lookup is hidden unless configured. | Service-status tests; live Ignav airport request succeeded. |
| Accounts | No sign-in/account system | Local registration/sign-in, hashed passwords, revocable seven-day sessions, login-attempt limits, same-origin write protection, per-account trips/categories, explicit import of existing device trips. | Account isolation, restart, logout, cross-origin rejection, throttling, and import tests. |
| Expenses | Cannot remove an expense | A labeled remove button opens confirmation; removal updates totals, charts and guidance. Pending offline entries can also be removed when not syncing. | Browser removal changed total spent from $637 to $625; idempotent deletion API retained. |
| Settings | Cannot delete custom categories | Settings removes a category from future choices while retaining existing records/allocations. Removing a built-in category is rejected. Explicitly creating the same name can restore it. | Browser removal kept the Museum expense; restart/history regression test. |
| Settings | Bell is confusing; housekeeping needs a home | Replace the inactive bell with Settings: appearance, account, category management, connection/service status, and help. | Browser checks; all controls labeled. |
| Appearance | Supplied palette, light/dark modes | Light, Dark and Use device setting; preference persists and applies before first paint. Accent colors and contrast-adjusted variants share one token file. | Theme switches, persistence, contrast calculations and rendered-page checks. |

## Color and accessibility decisions

Exact supplied colors: Lime Cream **#ECFEAA**, Baltic Blue **#30638E**, Yale Blue **#003D5B**, Ocean Mist **#60AB9A**, Cinnamon Wood **#C06E52**. Yale and lime anchor the budget card; Baltic identifies Expenses; Cinnamon identifies Plan. Mint is used in progress graphics. Text and controls use accessible variants where the exact swatch would have insufficient contrast: Plan text is **#82452E** on light surfaces and **#F1BAA4** on dark surfaces.

Light canvas/surface: **#F2F6F3 / #FFFFFF**. Dark canvas/surface: **#061E2B / #0C2D3C**. Light text is Yale; dark text is **#F0F6F2**. Theme tokens and section accents are in `frontend/src/theme.css`.

- Measured defined normal-text pairs exceed **4.5:1**; control borders exceed **3:1** in both themes. Minimum tested section-text pairing: **5.58:1**. Focus outlines are 3px; active navigation includes underline/icon/text, not color alone. [WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
- Charts retain numbered labels, amounts, percentages and descriptions. Their colors have light/dark variants, with separators; the information remains readable without distinguishing hues.
- Native labels and controls, confirmation dialogs, focus containment/restoration, visible keyboard focus, reduced-motion and forced-color support remain. Disclosure summaries are included in dialog keyboard navigation.
- First-trip guidance and optional disclosures follow progressive disclosure; expense confirmation follows error prevention; explicit source/status messages follow visibility of system status. These are design rationales, not claims of measured usability improvement.

## Data and implementation notes

**Currencies:** actual snapshot of [Frankfurter v2 currencies](https://api.frankfurter.dev/v2/currencies), retrieved November 9, 2026. Filtered to three-letter `type=currency` records. This is provider coverage, not a promise to support every monetary asset or deprecated currency. Rates continue to be real reference estimates; missing conversions are not fabricated. [Official docs](https://frankfurter.dev).

**Countries / prices:** actual [World Bank country response](https://api.worldbank.org/v2/country?format=json&per_page=400), with aggregate regions excluded. Price observations use [PA.NUS.GDP.PLI](https://data.worldbank.org/indicator/PA.NUS.GDP.PLI), the current GDP price-level index with US=100. This is an economy-wide comparison, **not a tourist cost-of-living or hotel-price dataset**. The daily pool is allocated proportionally to country index × remaining days. Observations older than five years are not used; absent indexes get equal weight. Values and years are preserved in `backend/resources/price_levels.json`. Source attribution and [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) are displayed in the app.

**Airports:** documented [Ignav airport endpoint](https://ignav.com/docs/airports), proxied by Flask with `X-Api-Key`. IATA airport/metro codes are three characters; four-character ICAO identifiers describe a different system. This provider accepts supported IATA codes, so unsupported airports receive an explicit alternative rather than an invented code. No keys enter frontend source or responses.

**Accounts:** scrypt password hashes via Werkzeug, hashed random session tokens in SQLite, HttpOnly/SameSite=Strict cookies, server ownership checks on trip/expense/quote routes, 10 login attempts per IP per 15 minutes, and origin/JSON checks for writes. The existing device workspace remains usable; importing it is explicit. Device caches are cleared after import, and account caches/queues are scoped separately. Pending entries must sync before switching accounts. Local storage is not encrypted; local accounts are not a cloud authentication/deployment service. Set `COOKIE_SECURE=true` behind HTTPS. No email delivery or password-reset flow is included. [Flask security guidance](https://flask.palletsprojects.com/en/stable/web-security/).

**Persistence:** additive trip/expense columns and account/session/category migrations; existing financial amounts and stored conversion rates stay intact. A pre-update backup is stored in the ignored `backend/data/` directory. Test trips/accounts live in a separate temporary database, not the normal app.

## Code map

- Appearance: `theme.css`, `useTheme.js`, `public/theme.js`, Settings, chart color variables.
- Startup/accounts/settings: `App.jsx`, `GettingStarted.jsx`, `AccountForm.jsx`, `Settings.jsx`, `useAccount.js`, `backend/accounts.py`, `backend/configuration.py`.
- Planning: `TripForm.jsx`, `DestinationFields.jsx`, `BudgetStarter.jsx`, `dailyBudget.js`, `TravelerInsights.jsx`, `backend/itineraries.py`, `backend/planning.py`.
- Currencies/flights: catalogs in backend resources and frontend data, `CurrencySelect.jsx`, `AirportPicker.jsx`, Ignav adapter and fare routes.
- Removal: `DeleteExpense.jsx`, expense row/actions, scoped category archival, `useCarryOn.js`.

## Verification and local preview

Automated checks: **25 backend tests passed**, plus the frontend daily-budget regression checks. The tests use isolated databases and fixtures. Live airport lookup uses the actual provider, not a fixture.

Browser checks completed: intentional empty-state welcome, Settings, light/dark switching, source-aware daily guidance, category archival preserving expense history, expense confirmation/removal with recalculated totals, budget suggestion preview/apply/save, and live city-to-airport lookup. Rendered text checks on light/dark Today and light Expenses/Plan found no contrast failures. At 320px, Today had no horizontal overflow or undersized inspected controls; a wrapped monetary value was corrected. Full assistive-technology certification is not claimed. Native date rules were verified at the API layer and through rendered constraints; complete native-calendar selection through this automation harness was not completed.

Final verification: production build passed from the same source with clean locked dependencies in an isolated build directory, then the generated files were copied to the normal local app. This avoided iCloud file-placeholder errors in installed React files. The final client credential-pattern scan passed. The normal server returned HTTP 200; schema migration completed with the existing trip count, expense count and total unchanged.

Final browser checks also passed: local registration opened a separate empty workspace; explicit device-trip import moved only the test trip; sign-out showed an empty device workspace, and sign-in restored the account trip. Session and theme selection survived reload. Choosing Bangkok on an expense switched the currency to THB and displayed a real home-currency estimate. Settings' last disclosure is keyboard reachable and dialog focus remains contained. Updated 320px layout kept the complete budget number on one line with no document overflow; 390px Today, Expenses, Plan and expense dialog text scans found no failures in both themes. No cross-browser or screen-reader certification is claimed.

Screenshots show the isolated QA trip, not production sample data: [light desktop](screenshots/feedback-light-desktop.png), [dark desktop](screenshots/feedback-dark-desktop.png), [light mobile](screenshots/feedback-light-mobile.png), [dark mobile](screenshots/feedback-dark-mobile.png).

Run from the project folder with `PORT=5050 python3 -m backend.app`, then open **http://127.0.0.1:5050/**. The server loads `.env` automatically. Open the header **Settings → Appearance** to change themes. GitHub remains unchanged for this update.
# Latest review

The [November 10 Ben/Molly audit](BEN_MOLLY_REVIEW.md) adds the login-first entrance, optional Google integration and an explicit list of remaining proposals. The implementation history below describes November 9 behavior; guest startup was subsequently replaced by required sign-in.
