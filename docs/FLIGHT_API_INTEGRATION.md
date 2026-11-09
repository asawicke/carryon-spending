# Ignav flight fare integration

Implemented November 8, 2026 (live provider response timestamps are UTC, November 9). This update replaces the previous AirLabs-only flight scope. AirLabs remains an optional live-status tool, with its own key; it is not used for fare search.

## Verified provider choice

We need **fare search**, rather than aircraft tracking, to help a traveler compare a possible flight with their trip budget. Ignav's official documentation provides self-service fare search and seller booking links. Its current terms explicitly permit retaining returned flight data, including prices and historical snapshots, indefinitely, and permit commercial products. This is a description of the consulted terms, not a legal opinion. [Fare quickstart](https://ignav.com/docs/quickstart), [terms effective October 1, 2026](https://ignav.com/terms).

The published allowance is **1,000 requests once**, then **$2 per 1,000 successful requests**. It does not renew monthly. Successful empty searches also count. There is no published per-account rate limit, and no card is needed to begin. Configure a dashboard spending limit before enabling paid billing. [Pricing](https://ignav.com/pricing).

We did not select SerpApi, create a paid account, or rely on the pasted claims about its commercial restrictions or litigation. Those claims were not needed for this implementation and have not been adopted as verified facts. Similarly, no broad claim that all providers lack historical data is necessary here: this app saves its own selected fare snapshots and does not claim market history.

## Implemented use case

1. On **Plan → Flights · fare search and tickets**, enter an origin, destination and departure date. An optional return date chooses a round-trip search. Nonstop filtering is available.
2. Submit deliberately; no page load, typing, background job or refresh automatically triggers a paid search.
3. See up to 20 verified positive fare estimates, original currency, home-currency interpretation, individual segments and airport-local times. Searches explicitly cover **one adult, economy, US pricing market**. Currency is read from the response; there is no invented currency-request parameter.
4. Compare the estimate with the Flights allocation (or Transit if Flights has no allocation). This is a comparison with the user's own plan, not a claim about typical route prices.
5. **Save estimate** persists the server-validated quote with query, segments, source and retrieval time. It never creates an expense or changes the budget. Previously saved estimates remain available after restart and after search-cache expiry.
6. **Check booking options** retrieves seller links only for a selected current result. The UI displays purchase coverage; separate outbound and return purchases are identified. Only HTTPS links are rendered. Updated provider estimates are shown separately, preserving the saved snapshot. The seller's checkout establishes the final cost.
7. Record a purchased ticket in the existing form below. Recording an actual fare as a Flights expense requires the explicit paid checkbox and retains the existing atomic, idempotent expense behavior. Unpurchased search quotes are never automatically charged to the budget.

Fare search and booking contracts were read from the [one-way reference](https://ignav.com/docs/one-way), [round-trip reference](https://ignav.com/docs/round-trip), and [booking-link reference](https://ignav.com/docs/booking-links). The browser interface and backend do not invent booking links or fares.

## Design decisions

- Preserve the existing Plan card and collapsed Flights section: progressive disclosure keeps occasional flight planning from crowding routine expense entry.
- Show source, retrieval time, original currency and approximate wording: Nielsen's visibility-of-system-status principle helps users distinguish an estimate from a bank charge or guaranteed fare. Provider results can themselves be reused for up to 30 minutes. [Freshness FAQ](https://ignav.com/docs/faq).
- Separate saved estimates from paid tickets: Nielsen's error-prevention principle supports explicit confirmation before a planned purchase reduces available funds.
- Use native labels, date constraints, focusable buttons, status announcements and text errors: this supports keyboard use and WCAG 2.2 criteria for labels, error identification and status messages. This update is not a full WCAG certification.
- Retain React, Flask and SQLite: the current stack already handles trip state, server secrets and persistent records. There is no migration or framework rework.

## Server design and safeguards

| Concern | Implementation |
| --- | --- |
| Provider boundary | `backend/ignav.py` implements `search(query)` and `booking(offer_id)` behind the interface in `fare_service.py`. A future adapter updates registry/configuration, cache identity and quota namespace without changing frontend endpoints. |
| Authentication | `IGNAV_API_KEY` in the server environment, sent as `X-Api-Key` over HTTPS. `.env` is ignored and is never included in the code snapshot. No client-side or `VITE_` secret. |
| API contract | POST `/api/fares/one-way`, `/round-trip`, `/booking-links` at `https://ignav.com`. Documented fields only. |
| Cache | SQLite: fare results 15 minutes, booking options 5 minutes, failures 60 seconds. Cache identity includes all search options, provider and a non-secret account fingerprint. Original `observed_at` is preserved. |
| Request budget | SQLite atomic counter shared across processes/restarts, default 20 attempts per UTC day. Failed and booking requests count locally. Cache hits do not. This is an installation guard, not a guarantee of staying within the one-time free allowance. |
| Timeouts / retries | 60-second upstream timeout; no automatic retries. The UI announces loading and disables duplicate submissions. Users may retry after a failure cooldown. No raw provider exceptions, bodies or credential-bearing requests reach the client. |
| Failure states | Friendly messages for missing/invalid key, unverified email, billing exhaustion, spending limits, empty/unverified results, unsupported dates, missing links and downtime. Manual ticket entry remains available. |
| Selection integrity | Save/booking accepts only an offer returned in a non-expired server search cache. The client cannot submit its own quote price. Unknown, forged and expired selections are rejected. |
| Persistence | `fare_quotes` stores selected snapshots with a unique trip/submission ID; `flight_api_usage` stores request counters. Neither uses mock production data. |

The provider recommends user-initiated POST searches, on-demand booking lookups, explicit empty states and approximate prices. This integration follows that pattern; transient failures are surfaced for a deliberate retry rather than spending extra attempts automatically. [Production checklist](https://ignav.com/docs/production-checklist), [error reference](https://ignav.com/docs/errors).

## Setup

Follow the [README flight setup](../README.md#flight-search-setup). Create/verify an account, obtain a key privately, set `IGNAV_API_KEY`, `FLIGHT_PROVIDER=ignav`, and `IGNAV_DAILY_LIMIT=20`, then load `.env` into the environment and restart Flask. The local configuration file has owner-only permissions. The key is not part of this report, frontend assets or repository content.

## Verification

- **17 backend tests passed**, including six new fare tests: documented request mapping, round-trip/nonstop options, cache hits, empty/unverified results, daily cap, missing key, forged/expired selections, saved-quote persistence, unchanged spending, booking coverage, unsafe-link filtering, failure cooldown and secret-safe errors.
- **Production frontend build passed.** Fixtures exist only in isolated automated tests.
- **Real keyed test passed** against Ignav for DTW → CDG, December 8–15, 2026: verified fare estimates returned, including a $730 USD round-trip estimate at retrieval. This is test evidence, not a current fare recommendation. Repeating the same search used cache. A selected quote survived application restart; trip spending remained $0. A real booking-link lookup returned one purchase option.
- Live checks used a separate temporary SQLite database. Existing user trips, expenses and budgets were not used as test data.
- Browser verification passed for a real one-way DTW–CDG search, saving its estimate, and retrieving a JetBlue seller link. At 390px, document width stayed 390px with no horizontal overflow, every search input had a label, and keyboard focus reached the seller link. Screenshots: [desktop](screenshots/flights-desktop.png), [mobile](screenshots/flights-mobile.png). Normal localhost health returned 200 after restart and its two existing trips remained available.

### Manual acceptance checklist

| Check | Expected result |
| --- | --- |
| Open Plan / expand Flights | Existing layout retained; fare search appears above paid ticket entry. |
| Keyboard through search | Each field has a label; buttons and checkboxes work without a pointer. |
| Invalid airport/date/return | Browser or server gives a useful error; no provider request is made for locally invalid inputs. |
| Submit one-way / round trip / nonstop | Correct route and dates appear; stop count and each segment are visible. |
| Repeat identical search | Cached indicator appears; no additional request allowance consumed. |
| Save estimate twice with same submission | One saved snapshot; spending unchanged. Reload retains it. |
| Check seller options | HTTPS seller links and purchase coverage shown; seller opens in a new tab; no automatic booking or payment. |
| Empty results / outage / no key / local cap | Text explanation and manual ticket alternative; no fabricated fallback fares. |
| Mobile 390px / zoom | Search and quote cards fit; long segment/link text wraps. |
| Inspect browser bundle and requests | Requests go to Flask; no API key appears. |

## Requirement status and remaining scope

| Item | Status | Evidence / limitation |
| --- | --- | --- |
| Real flight API | Done | Live Ignav fare search and booking-link lookup tested. |
| Secret-safe proxy / cache / limits / persistence | Done | Adapter, service, routes, SQLite tables and automated tests above. |
| Existing layout / no mock production data | Done | Flights remains a Plan disclosure; production uses real provider results or explicit failure states. |
| UR-10 flight-price context | Partial | Real fare estimates and comparison with a category budget now exist. Historical or typical route/date benchmarks do not. |
| Flight alerts | Stretch, not implemented | Requires route watchlists, scheduled checks, accumulated comparable observations and notification decisions. No scheduler is deployed. |
| Other user requirements | Existing audit retained | See the [prior requirements audit](PWA_REFINEMENT_REPORT.md); this flight change does not complete its remaining participant/usability or verified travel-guidance work. |
| GitHub delivery | Included in this update | App changes, setup instructions and verification notes are part of this repository update. |
