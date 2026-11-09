# CarryOn PWA refinement report

**Flight integration update:** [Ignav fare search and live verification](FLIGHT_API_INTEGRATION.md) supersedes the AirLabs-only scope and no-key limitation in sections 4, 7–9 below. AirLabs is now optional status lookup; Ignav provides actual fare estimates.

Research date: November 8, 2026. The existing repository supplied the current frontend and data model. No replacement frontend or new screenshot attachments were included with this request. Research preceded implementation. Existing untracked logo and slide work was left untouched.

## 1. Competitive research

Official product descriptions establish capabilities, not usability-test results. “Assessment” below means my reasoned UX critique, not a measured defect or representative customer complaint. A single review is explicitly identified as such.

| Product | What it does / standout features | UX strengths to borrow | Weaknesses or complaints / evidence limits |
| --- | --- | --- | --- |
| [TravelSpend](https://apps.apple.com/us/app/travelspend-travel-budget-app/id1434284824) | Travel-specific expense logging, offline entry, home-currency conversion, shared trips, visual insights, CSV export; some features require Premium. | Keeps the trip and home-currency interpretation central; supports logging while disconnected. | One 2022 App Store reviewer requested a faster quick-add flow; this is an individual historical complaint, not proof the current release lacks it. Assessment: detailed entry should remain optional. |
| [Wanderlog](https://wanderlog.com/travel-budget-expense-splitting-app) | Trip budgeting, splitting, category/day breakdowns, currency conversion, offline expense editing, plus itinerary planning and reservation import. | Costs appear in trip context; category and daily views answer different questions. | Assessment: its broad planning surface introduces more choices than CarryOn's novice budgeting task requires. No independent usability comparison was performed. |
| [Splitwise](https://www.splitwise.com/pro) | Shared bills and balances; Pro adds unlimited expenses, conversion, charts, receipt scanning, itemization and search. | Makes individual records and group balances explicit; editable expense details support corrections. | Conversion and charts are paid features. Assessment: debt settlement does not by itself explain how much an individual can safely spend over the rest of a trip. Exact current free daily cap was not verified. |
| [Tricount](https://tricount.com/en-us/) | Group expense entry and settlement, currency conversion, offline use, spending insights and import; advertises free use without ads or daily caps. | Low entry friction and a readable record of who paid. | Assessment: the consulted page focuses on group settlement and does not describe novice pre-trip budget or spending-pace coaching. This is a documentation gap, not proof those features never exist. |
| [Wallet by BudgetBakers](https://budgetbakers.com/en/products/wallet/) | Budgets, expense tracking, planned payments, cash-flow reports, multiple currencies, premium bank sync and sharing. | Category allocations and planned costs establish a baseline for actual spending. | Advanced automation and sharing require Premium. Assessment: investments, net worth and household finance add complexity irrelevant to a first international trip. |
| [YNAB](https://www.ynab.com/features) | Category targets/templates, progress tracking, customizable views, reporting, account imports and shared subscription use. | Explains money through categories and remaining amounts rather than charts alone. | Assessment: active category allocation introduces a learning step; CarryOn should explain its simpler category totals plainly. The consulted features page describes a trial but does not establish current subscription prices. |

### Ideas to borrow

- Fast entry with optional description, saved categories, and later editing, informed by TravelSpend's entry focus and the individual quick-add review.
- Keep both original and home-currency amounts visible, following TravelSpend and Wanderlog.
- Combine category totals with day-level context, following Wanderlog, and compare actual category spending with the user's own plan, following Wallet/YNAB.
- Preserve a readable, editable ledger and make retry behavior explicit, consistent with the record clarity emphasized by Splitwise and Tricount.

### Ways to go beyond for CarryOn's users

- Connect the existing hypothetical-purchase tool to remaining trip-day flexibility.
- Explain “no category budget set” rather than representing an absent plan as an overspending failure.
- Add a short, persistent passport/entry/insurance/connectivity/card-fee/baggage checklist next to planning.
- Label exchange-rate provenance and dates, pending sync, manual flight details, and saved status snapshots.
- Compare an entered fare with a personal budget while explicitly avoiding unsupported “good deal” or market-price claims.

## 2. Requirements audit

Source: [team User Requirements Document](https://docs.google.com/document/d/1JayOina8pale-Gw71MvVIuDWl6Kys1jVBq2v5S1WbWE), read through connected Drive. Status refers to functional coverage; **none of its percentage/timed participant success targets has been validated by this engineering pass**.

| Requirement | Status | Existing coverage and this update |
| --- | --- | --- |
| UR-01: understand remaining total budget | Met functionally | Today displays budget minus saved/pending expenses; flight fare recording changes the balance. Browser and API tests confirm the calculation. |
| UR-02: record expenses with little effort | Met functionally | Amount, currency, category and date; description optional; no amount spinner; previous custom names are reusable; pending submissions survive reload. The 15-second participant target remains untested. |
| UR-03: estimate a trip before departure | Met functionally | New trip on Plan, total/category budgets, live allocation total, and user-entered extra-cost estimates. No fabricated default prices. |
| UR-04: recognize overlooked costs | Met functionally | Extra costs and saved pre-trip checklist cover entry fees, insurance, airport transfer, mobile data, card/ATM fees and baggage. |
| UR-05: understand purchase effects | Met functionally | Existing what-if purchase changes projected remaining funds and per-day flexibility without recording an expense. |
| UR-06: familiar-currency interpretation | Met functionally | Entry preview and each record show home/original values; real rate source/date and bank-fee caveat replace fixed demo rates. |
| UR-07: identify major spending categories | Met functionally | Sorted bars plus labeled donut percentages, custom categories included, with small categories combined into Other. |
| UR-08: recognize problematic pace | Met functionally | Daily spending vs daily budget, over/under text, remaining category budgets, and existing trip-day flexibility. Prepaid costs are explicitly included. |
| UR-09: understandable financial information | Partially met | Plain labels and contextual explanations implemented; novice comprehension and post-task clarity survey still required. |
| UR-10: interpret flight-price reasonableness | Partially met | Actual fare vs the user's Flights/Transit allocation. A status API supplies no market-price history; typical-price/price-drop context is not implemented. |

The URD excludes a complete flight-search/booking platform and prioritizes expense tracking. A small itinerary/status feature and actual fare recording stay within that scope. No conflict required overriding the URD. Automated banking, complete itinerary planning, price prediction and notifications were not added.

## 3. Design rationale

- **Stack:** React/Vite, Flask and SQLite remain appropriate for the existing PWA and local persistence. Retaining them avoids a framework/data-layer migration and keeps API secrets on the server; the work adds focused components and additive tables/columns rather than stack rework.
- **Section colors:** Today teal **#075F68**, Expenses violet **#654398**, Plan amber-brown **#8A4B08**, ink **#182A35**, muted text **#475B67**, canvas **#F4F7F8**. Accent/white contrast is 7.38:1, 7.47:1 and 6.79:1; labels, icons, active underline and aria-current also convey the section, applying [WCAG color/contrast requirements](https://www.w3.org/TR/WCAG22/).
- **Charts:** Dark hues **#00689D, #A84400, #00745A, #894970, #806100, #286A7A** adapt the familiar blue/orange/green/purple/ochre/cyan family; all exceed 5.7:1 against white, and numbered labels, amounts and percentages remain readable without hue discrimination, following [color universal design advice](https://jfly.uni-koeln.de/color/). These are adapted hues, not a claim that the exact original palette was used or independently certified by color-vision testing.
- **Orientation/layout:** The header, 780px content container, card order, and fixed three-tab navigation remain; Plan moves to the right with a pencil, applying consistency and recognition from [Nielsen's heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/).
- **Progressive disclosure:** “Other” reveals one category-name input, and Flights is an expandable Plan section, so secondary tasks compete less with expense entry; this follows [progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/). [Hick's original choice-reaction experiments](https://journals.sagepub.com/doi/10.1080/17470215208416600) motivate limiting simultaneous options here, but a precise speed benefit is not claimed.
- **Grouping:** Related chart data share a container and flight fields stay beside their lookup results, using [Gestalt proximity](https://www.nngroup.com/articles/gestalt-proximity/).
- **Feedback/error prevention:** Loading, rate dates, pending sync, provider errors, explicit paid-fare confirmation and idempotent retries apply Nielsen's system-status and error-prevention heuristics.
- **Keyboard/accessibility:** A native modal dialog provides focus containment and Escape, focus returns to the trigger, form controls have labels, status/errors announce changes, and 44px interactive targets exceed WCAG's 24px AA target minimum where applicable. Visible focus and fixed-header scroll spacing support [WCAG 2.2](https://www.w3.org/TR/WCAG22/); full assistive-technology certification is not claimed.
- **Novice priority:** (1) home-currency entry and daily comparison reduce currency/pace interpretation; (2) category remaining amounts show available choices; (3) countdown locates that guidance in the trip; (4) a checklist helps users remember preparation without crowding the transaction form. These priorities are design inferences supported by the team's interviews, not a new user study.

## 4. Flight API evaluation

We need **fare search/pricing plus meaningful reference prices** to fully satisfy UR-10. Status/tracking APIs answer where/when a flight operates and cannot establish whether its fare is a bargain. This update uses the prompt's allowed itinerary/status + actual-cost use case, with explicit personal-budget context.

| Option | Current free cost/limits and licensing | Features/coverage | Fit and limitations |
| --- | --- | --- | --- |
| [Amadeus](https://developers.amadeus.com/) | Site states the Self-Service portal was decommissioned July 17; it now offers Enterprise access by request. No current free self-service quota is assumed. | Enterprise travel APIs and sandbox; contractual access. | Former self-service fare-search examples are not a viable default for a new free integration. |
| [Aviationstack](https://aviationstack.com/pricing) | $0, 100 requests/month, personal/non-commercial use, HTTPS. Basic $49.99/month for 10,000 requests and commercial use. Numeric per-minute limit not established in the consulted pages. | Global live flights; [docs](https://docs.apilayer.com/aviationstack/docs/api-documentation) put historical/future schedule features on Basic+. | Useful status alternative, but low free allowance and no airfare prices. [Terms](https://aviationstack.com/terms) do not establish an unrestricted redistribution right. |
| [AirLabs](https://airlabs.co/) | $0 personal use, 1,000 queries/month, limited fields; Developer $49/month for 25,000 queries and commercial use. [Errors](https://airlabs.co/docs/) include minute/hour/month limits without publishing their numeric minute/hour values. | Global live/scheduled flight info, airports, schedules; field availability depends on flight/plan. | **Chosen** for a small manual lookup flow and larger free allowance. Detailed redistribution and caching license terms were not confirmed in publicly accessible pages, so public deployment needs vendor confirmation. |
| [OpenSky](https://openskynetwork.github.io/opensky-api/rest.html) | Current docs list 400 anonymous / 4,000 standard / 8,000 feeder daily credits per endpoint bucket; request cost varies. [License](https://opensky-network.org/about/terms-of-use) requires written agreement for operational integration, including non-profit products. | ADS-B state vectors, tracks, historical aircraft/airport flights; no fares, weak booking-itinerary context. | Poor fit for a consumer budgeter; research telemetry is not flight shopping or a free unrestricted product license. |

### Integration

- Flask calls documented **GET https://airlabs.co/api/v9/flight** with **flight_iata** and **api_key**, using an eight-second timeout. The [flight documentation](https://airlabs.co/docs/flight) defines flight_iata, dep_iata, arr_iata, dep_time, arr_time, and status.
- Only safe normalized values reach the browser. Missing plan-limited fields stay blank; the user confirms or enters route/date from a ticket. Unknown/malformed responses fail safely.
- A closest-flight lookup can be for a different travel date. Saving provider-linked details checks the cached number, date and route; an edited itinerary becomes explicitly user-supplied.
- Successful results cache for 15 minutes, empty/failure results for 60 seconds; the server guards its own monthly use at 900 calls. A 429 response includes Retry-After; the UI offers manual entry.
- Saving flight details persists an itinerary in SQLite. The paid-fare checkbox atomically saves one linked Flights expense with a stable client ID; retrying does not double-count.
- The UI identifies the provider and last-checked timestamp and calls status a snapshot. Manual entries are sourced to “Your ticket,” never an invented live result.
- No AirLabs key was supplied. Keyed live success and account-specific coverage remain **unverified**; unit tests use explicit test fixtures only, and manual itinerary/error paths were exercised in the browser.
- Frankfurter daily reference rates replace sample conversions. Its [current v2 documentation](https://frankfurter.dev) permits caching and commercial use of blended rates; these are estimates rather than bank charges.

## 5. Changed/new files

```text
.env.example
README.md
backend/
  app.py
  categories.py
  flights.py
  providers.py
  tests/test_app.py
  tests/test_refinements.py
frontend/
  public/sw.js
  src/App.jsx
  src/lib.js
  src/styles.css
  src/hooks/useCarryOn.js
  src/components/
    Icons.jsx
    Modal.jsx
    ExpenseForm.jsx
    ExpenseRow.jsx
    TripForm.jsx
    Today.jsx
    Expenses.jsx
    Plan.jsx
    TravelerInsights.jsx
    SpendingCharts.jsx
    FlightPanel.jsx
    SavedFlights.jsx
docs/
  PWA_REFINEMENT_REPORT.md
  PWA_FULL_CODE.md
  screenshots/
```

## 6. Full code

[PWA_FULL_CODE.md](PWA_FULL_CODE.md) contains the complete final contents of every changed/new source/configuration/README file, one filename heading and separate code block per file. The actual working source files are also present in the tree above. Generated build output and binary screenshots are excluded from that text listing.

## 7. Setup

These app changes and the later Ignav fare integration are included in this repository update. Use the README for current local setup instructions.

See [README](../README.md) for environment creation, install/build/run, Windows commands and the optional AirLabs key. The server reads AIRLABS_API_KEY and AIRLABS_MONTHLY_LIMIT; .env must be loaded into the environment explicitly. No secret belongs in VITE_ variables.

New databases are empty. Legacy demo-paris records are retained as an archive and excluded from normal app/API views; no user data is deleted. Real trips created separately remain available. Custom categories, flights, expenses and preparation checks use SQLite; offline pending expenses use a versioned localStorage queue.

## 8. Testing checklist

### Automated results

11 backend tests pass: no seeding, budget persistence, expense conversion/replay/edit/delete, validation/currency lock, Unicode/case category deduplication, checklist persistence, atomic flight fare/replay, cached lookup, missing credentials, empty response, quota, downtime, secret redaction, provider-selection date checks, and stale-rate expiry. Production build and diff whitespace checks pass. Test provider responses are isolated fixtures, never production fallbacks.

### Manual steps

| Change | Steps and expected result |
| --- | --- |
| 1–3 | Visit Today, Expenses and Plan; confirm teal/violet/amber identity, icons and active underline. Inspect charts without relying on color; compare all numeric labels. Check normal text >=4.5:1, large text >=3:1, essential non-text contrast >=3:1. |
| 4–6 | Click logo from Plan/Expenses; Today opens. Confirm Ashley greeting and no star. |
| 7–8 | Choose + New trip from the header select; the inline Add new trip form opens on Plan. Cancel returns to existing trip. Plan is rightmost with a pencil. |
| 9–10 | Confirm the specified Overview/Plan slogans are absent. |
| 11 | Open Add expense; Amount is a decimal-keyboard text field without spinners. Reject blank, zero, negative, nonnumeric, and >2-decimal values; accept positive decimals. |
| 12 | Select Other, enter Museums, save. Reopen form and choose Museums. Add MUSEUMS through Other; reload/restart and verify one canonical category. Check other trips also offer it. |
| 13 | Record several categories including a tiny amount; donut and bars show the same totals and labeled percentages, and tiny groups appear under Other with an explanation. At desktop they sit alongside; on mobile they stack. |
| 14 | Set Food/Flights limits on Plan, log expenses, inspect remaining amounts and daily pace. Check countdown before/during/after a trip. Save checklist, reload and verify checked state. Inspect original/home amounts on each record. |
| 15–16 | Without a key, request a lookup: show useful setup/manual message and preserve the form. With a personal key, look up a current flight, confirm date/route, save and reload. Check no key in browser requests/build. Test invalid/no results, unavailable provider and 429. Save manual fare with paid checkbox; balance falls once. Replay the request and verify one expense. |
| PWA | After an online visit, disconnect, add/edit a queued expense, reload, then reconnect; it should sync once. Foreign pending estimates are labeled and may change at sync. |
| Keyboard | Tab through header/nav/forms, activate selects by keyboard, open expense dialog, confirm focus begins on amount, Shift+Tab stays inside, Escape closes and returns focus. Check focus stays visible around sticky/fixed elements. |
| Responsive | Check 320px, 390px and desktop widths; no page-level horizontal scrolling, readable legends and 44px buttons. At 200%/400% zoom use reflow without losing fields or actions. |
| Assistive tech | With VoiceOver/NVDA, check names, headings, native select, dialog title, status/errors, chart description/legend and category progress values. This full screen-reader session remains a manual acceptance step. |
| User research | Run the URD's timed/comprehension tasks with novice travelers; record its actual success rates rather than treating engineering tests as user validation. |

Browser work uses an isolated temporary database. Screenshots show QA entries, not production sample data. Verified in the browser: real Frankfurter conversion; adding and reusing Museums; charts including a sub-3% category; new-trip dropdown and cancel; saved checklist; no-key flight error; manual flight fare recording; server restart persistence; offline entry plus cached reload; exactly one synced Offline Fees expense after restart; 320px no horizontal overflow or sub-24px targets; 390px mobile and 1100px side-by-side charts; no duplicate element IDs; expense amount focus, Shift+Tab loop, Escape and trigger focus restoration. A rendered Expenses-page contrast scan found no failing visible text pairs. The scan is not a comprehensive WCAG certification.

The QA database contained five expenses and one saved flight after these checks. New installations start empty; the regular database retains real trips and receives no QA data. Screenshots: [desktop Expenses](screenshots/expenses-desktop.jpg), [mobile Today](screenshots/today-mobile.jpg), [mobile Expenses](screenshots/expenses-mobile.jpg).

## 9. Final verification

| Item | Done / Partially / Not done | Where in code/output |
| --- | --- | --- |
| Phase 1: six-product research | Done | Section 1; linked official sources and explicitly qualified review/assessment. |
| Phase 1: borrow/improve | Done | Section 1 ideas/gaps and section 3 priorities. |
| Phase 2: requirements review | Done | Section 2 covers UR-01 through UR-10 and distinguishes functional coverage from unvalidated success targets. |
| 1: cohesive section accents | Done | styles.css section tokens and active navigation. |
| 2: redundant meaning / AA | Partially | Icons/labels, focus, keyboard and measured token contrasts implemented; independent full WCAG/assistive-technology audit remains. |
| 3: chart palette | Done | SpendingCharts.jsx; high-contrast adapted hues plus numbered legend, amounts and percentages. |
| 4: logo home | Done | App.jsx home link. |
| 5: remove star | Done | Today.jsx greeting, no decorative star. |
| 6: Ashley | Done | Today.jsx; no Maya/Avery remains in application source. |
| 7: + New trip | Done | Header select → inline TripForm on Plan. |
| 8: Plan rightmost + edit icon | Done | App.jsx bottom nav order and pencil. |
| 9: remove overview text | Done | Today.jsx. |
| 10: remove Plan slogans | Done | Plan.jsx. |
| 11: decimal amount without spinners | Done | ExpenseForm.jsx text/inputMode/pattern + server validation. |
| 12: reusable custom categories | Done | ExpenseForm.jsx, categories.py, SQLite unique normalized key, queue restoration. |
| 13: donut alongside bars | Done | SpendingCharts.jsx, responsive chart-grid CSS, Other threshold/group disclosure. |
| 14: novice components | Done | TravelerInsights.jsx, ExpenseRow.jsx, Today/Expenses/Plan with rationale in section 3. |
| 15: free API research | Partially | Four-provider table; published limits/licensing verified, unpublished minute/hour limits and detailed AirLabs redistribution/cache permissions remain unknown. |
| 16: real API integration | Partially | providers.py/flights.py/FlightPanel.jsx; secure environment setup, persistence and failures implemented; keyed live success requires the user's API key. |
| Constraints: layout / modularity | Done | Existing header/container/cards/three-page IA retained; focused components, separate provider/data code. |
| Constraints: no mock production data | Done | No auto-seed/fixed foreign rates; actual inputs/provider responses only; old sample archived. |
| 17: final review | Done | This table and delivered testing evidence, with outstanding limits explicit. |

Outstanding: keyed flight success, detailed vendor license confirmation for public use, complete screen-reader/zoom/CVD acceptance, and the URD participant targets. Full market-fare benchmarking/alerts remain outside this status integration; UR-10 is partial. No remaining item is silently represented as complete.

## 10. Sources consulted

Product, API, requirements and design citations are placed next to the claims they support above. Also consulted: [Splitwise comparison by Tricount](https://tricount.com/en-us/comparisons/tricount-vs-splitwise) (vendor comparison, not independent evidence), [Aviationstack quickstart](https://docs.apilayer.com/aviationstack/docs/quickstart-guide), [code examples](https://docs.apilayer.com/aviationstack/docs/code-examples), [API features](https://docs.apilayer.com/aviationstack/docs/api-features), and [archived official repository](https://github.com/apilayer/aviationstack) (its older quota was not used). Some attempted AirLabs terms URLs returned 404 and did not establish a license. No claim above relies on those missing pages.
