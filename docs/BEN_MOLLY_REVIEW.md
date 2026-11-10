# Ben and Molly feedback review — November 10, 2026

This reviews the current local source, including the new login entrance. It distinguishes implemented behavior from proposals. The November 9 [implementation report](FEEDBACK_IMPLEMENTATION.md) records the earlier feature work and tests.

## Ben

| Feedback | Status | Current behavior / limit |
|---|---|---|
| Startup workflow and tutorial | Implemented; tooltip tour partial | Signed-out users see login first. Returning valid sessions open their workspace. Empty accounts see a three-step guide and Create your first trip. A replayable written guide is in Settings; no anchored tooltip tour yet. |
| More currencies | Implemented | 161 provider-supported fiat currencies, not a claim to support every currency. Unavailable reference rates produce an explicit message. |
| Past trip dates | Implemented | Past dates require an explicit Record a past trip choice. Existing past trips stay editable. |
| Multiple destinations | Implemented | Stops have their own country, currency and dates; expenses can be assigned to a stop. |
| Suggested category budget | Implemented | Enter fixed costs and reserve, preview a suggested split, apply it and adjust manually. Suggested percentages are an editable starting point, not researched destination-specific prices. |
| City/airport lookup | Implemented | Search city or airport name and select a supported airport. The text query is no longer limited to three characters. Fare providers still need supported IATA codes; airports without one are not searchable here. |
| Unconfigured flight search | Implemented locally | The server loads the existing private Ignav configuration. API access, allowance and live results depend on the provider. Manual entry remains available. |
| Accounts | Implemented locally | Email/password registration, sign-in, hashed passwords, revocable sessions and trip isolation. Authentication now protects financial APIs as well as the UI. This is not cloud synchronization or a finished recovery system. |
| Daily budget excludes flights/fixed costs | Implemented | Guidance uses daily categories, protects unspent fixed allocations and one emergency reserve, and accounts for relevant daily expenses. |
| Delete expenses | Implemented | Expenses have a remove action and confirmation; totals update. |
| Duplicate buffer/emergency costs | Implemented | One Emergency reserve allocation; duplicate emergency extra-cost reminders are removed from the editable plan. |
| Unhelpful notification bell | Implemented | Replaced with a working Settings button. No fake notification feature. |
| Country price differences | Implemented with limits | Relative daily weighting uses available recent World Bank GDP price-level indexes and stop duration; source/year shown. Economy-wide PLI is not a tourist-cost quote. Missing data falls back to equal daily weighting. |
| Delete custom categories | Implemented | Settings removes categories from future choices while preserving historical expense labels and amounts. |
| Settings | Implemented | Appearance, account, device-trip import, categories, connection/provider status and replayable guide. |
| Dark mode / themes | Implemented | Light, Dark and device setting; saved locally. Uses the supplied palette with accessible text variants and persistent labels. |

## Molly

| Feedback | Status | Proposed next change |
|---|---|---|
| Hardcoded Ashley | Fixed in this update | The Today greeting uses the signed-in account's name. The guest Ashley fallback is gone. |
| Faster expense entry | Not implemented | Add an **Add again** action based on a real previous expense, prefill its amount/currency/category/description, use today's date and require review before saving. This avoids invented preset prices. Recurring automation needs a separate choice: reminder versus automatic entry, plus frequency, end date and cancellation rules. |
| Meaning of Plan | Partial | The guide explains it, but the tab still says Plan. Proposed label: **Trip plan**, retaining the pencil and far-right position, with “Set your budget and prepare for departure” on the page. The original callout image was not supplied here, so this assumes the navigation label is the confusing part. |
| Baseline ranges for extra costs | Not implemented | Current estimates start at zero. Proposed first fix: show **Not estimated** and count unresolved items separately from confirmed free costs. Optional ranges must cite a source, currency and checked date and depend on relevant inputs; visa/passport/insurance fees cannot honestly share one universal baseline. Exact quotes should remain editable. |
| First sign-in tooltip walkthrough | Partial | There is a three-step empty-account welcome and a replayable written guide. Proposed next step: an optional, dismissible tour of Trip plan → Add expense → Today, shown once per account and replayable in Settings. Wait until the relevant controls exist so tips do not point at empty screens. |

These four remaining experience changes are proposals for the user's review; this turn implements the explicitly requested login entrance and optional Google integration.

## Login entrance and Google

- The screenshot informs the centered card, brand, social sign-in area, divider, labelled email/password fields, Continue button and create-account link. CarryOn's existing palette and Light/Dark/System modes remain.
- The first render is the login shell while session verification runs. No trip components mount until a session is confirmed. A valid returning session skips credential re-entry, as expected for a persistent login.
- Logout and API session expiration return to the entrance. An inaccessible server does not silently open a previously cached account. Browser caches and SQLite data are preserved; existing device trips can be explicitly imported after sign-in.
- Google code is ready for a web client ID, not enabled by a flight API key. The disabled setup state is honest about this. See [Google setup](GOOGLE_SIGN_IN.md). Live Google authorization remains unverified until the owner configures a client and tests it.
- UI rationale: the single entrance and primary action reduce competing choices; visible labels and inline errors support recognition and error recovery. A password reveal control, autofill, keyboard focus, 44-pixel controls and theme contrast support accessible completion. These are design intentions and targeted checks, not a claim of complete WCAG certification.

## Verification record

- 32 backend tests passed, including the default authentication gate, registration, session persistence/revocation, isolation, Google challenge reuse rejection, account collision and provider failures. A generated local certificate exercises Google's real signature/audience verifier without contacting Google or using real credentials.
- Frontend daily-budget checks passed; the production build passed (58 modules).
- Isolated browser checks passed: invalid password error, account creation, name from account, session after reload, sign-out to login, password reveal and visible keyboard focus.
- Login layout had no horizontal overflow at 320 and 390 pixels. Targeted DOM contrast checks found no failing visible text in either theme; this is not a full accessibility audit.
- The normal server is running at `http://127.0.0.1:5050`. Existing trip, expense and category rows were compared before/after and remain unchanged. A private pre-update SQLite backup is excluded from Git.
- Moving earlier device trips also syncs any locally queued expenses before clearing their old cache; stable entry IDs make interrupted retries safe. The eight feedback regression tests passed after extending the import/retry check. Dependency downloads in the iCloud-backed project folder stalled, so the completed test run used a temporary local Python environment against the same workspace source.
- [Dark login preview](screenshots/login-dark-mobile.png) and [light login preview](screenshots/login-light-mobile.png) were inspected. Live Google authorization is pending client configuration. Nothing was pushed to GitHub.
