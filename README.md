# CarryOn Spending — EECS 497 capstone

## Live pilot

Open **https://carryon-spending-asawicke.azurewebsites.net/** and create an email/password account. Azure hosts Flask and React together over HTTPS with a persistent PostgreSQL database. Google sign-in is configured; the first real login is pending because Google is rejecting the new authorized origin, which may still be propagating. Email sign-in is verified.

The deployed code is on `codex/azure-deployment`; releases are currently manual, with GitHub verification before publishing. [Deployment and operations](docs/AZURE_DEPLOYMENT.md).

## App

A travel budgeting PWA built with React and Flask, using SQLite locally and PostgreSQL online. Plan a trip, track expenses in local and home currencies, view spending charts, create custom categories, and search flight fares. Includes light/dark themes, local accounts, multi-destination trips, and editable budget suggestions.

## Run locally

Requires Python 3.10+, Node.js 20.19+ (20.x) or 22.12+, npm, and Git.

```sh
git clone --branch codex/azure-deployment https://github.com/asawicke/carryon-spending.git
cd carryon-spending
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
npm ci --prefix frontend
npm run build --prefix frontend
PORT=5050 python -m backend.app
```

Open **http://127.0.0.1:5050/**. Keep the terminal running. Sign in or create an account, then create a trip on **Plan**. Local and hosted accounts/data are separate.

**Windows PowerShell:** activate with `.\.venv\Scripts\Activate.ps1`, then use the same install/build commands. Set `$env:PORT = '5050'` and run `python -m backend.app`.

**Updating an existing checkout:** run `git pull`, repeat the install/build commands, and restart Flask. Your local database is preserved.

## Flight search setup

Manual ticket entry works without an API key. To enable fare search:

1. [Create an Ignav account](https://ignav.com/signup), review its terms, verify your email, and get your key from the dashboard.
2. Copy `.env.example` to `.env` **only if `.env` does not already exist**. Enter your key privately as `IGNAV_API_KEY`.
3. Restart Flask. It now reads `.env` automatically (existing environment variables take precedence):

```sh
PORT=5050 python -m backend.app
```

On PowerShell, edit the same `.env` file, set `$env:PORT = '5050'`, then start Python. Never commit keys or put them in frontend code or `VITE_` variables.

Open **Plan → Flights · fare search and tickets**. Search one-way or round-trip fares for one adult in economy using airport/city codes such as DTW or PAR. Searches use the US pricing market and display the returned currency. Save an estimate without changing spending, or open seller booking options. Record purchased tickets separately.

[Ignav pricing](https://ignav.com/pricing), checked November 8, 2026: **1,000 one-time free requests**, then **$2 per 1,000 successful requests**. The local `IGNAV_DAILY_LIMIT=20` setting counts attempts across restarts and resets at midnight UTC; it does not guarantee staying within the provider's free allowance. Searches are cached for 15 minutes and booking links for 5 minutes. Fares are estimates; confirm final prices and fees with the seller. Alerts and historical market-price benchmarks remain stretch goals.

Optional AirLabs live-status lookup uses a separate `AIRLABS_API_KEY`; it is not required for fare search. See the [flight integration notes](docs/FLIGHT_API_INTEGRATION.md) for API details, limits, sources, and verification.

## Data and development

- Local SQLite stores trips, expenses, categories, checklists, tickets, and saved quotes at `backend/data/carryon.db`. Back it up before moving it. `CARRYON_DB_PATH` selects another location. Databases and `.env` are excluded from Git.
- [Frankfurter](https://frankfurter.dev) provides daily reference exchange rates, cached for six hours. Conversions are estimates and may differ from bank rates or fees. Saved expenses retain their conversion rate.
- Sign in or create an account on the first screen. Accounts separate trips on this local server; Settings offers an explicit move of earlier device trips. An open workspace can queue expenses offline, but signing in or reloading requires the server. The hosted version saves account data across browsers; your local server keeps separate data. Email verification and password reset are not included.
- Frontend code is in `frontend/src/`; APIs and provider adapters are in `backend/`. For frontend development, run Flask on port 5000 and `npm run dev --prefix frontend` separately; use Vite's printed URL.

## Themes and planning

Use the header Settings button for **Light**, **Dark**, or **Use device setting**, accounts, custom-category removal, and service status. Plan supports multiple destinations and currencies. **Help me split my budget** previews an editable allocation after fixed costs and one emergency reserve. Daily guidance excludes those protected funds; recent World Bank country price indexes weight the relative split where available, with source/year shown.

Optional **Google sign-in** needs a Google Cloud **Web application** client ID. Add your localhost origin in Google Auth Platform, set `GOOGLE_CLIENT_ID` in `.env`, and restart. No client secret is needed for this flow. [Setup and limitations](docs/GOOGLE_SIGN_IN.md).

## Verify

```sh
python -m unittest discover -s backend/tests -v
npm test --prefix frontend
npm run build --prefix frontend
```

Tests use temporary databases and isolated fixtures, not production sample data.

## Project references

[Feedback fixes and verification](docs/FEEDBACK_IMPLEMENTATION.md) · [Research and requirements audit](docs/PWA_REFINEMENT_REPORT.md) · [Flight integration](docs/FLIGHT_API_INTEGRATION.md) · [Drive folder](https://drive.google.com/drive/folders/130RJwSIgSeLF7ZevDTFqgfarOgmiQ-yF) · [Requirements](https://docs.google.com/document/d/1JayOina8pale-Gw71MvVIuDWl6Kys1jVBq2v5S1WbWE) · [Figma](https://www.figma.com/make/NUjJLaoI0HzRKz7lWTytJU/Lofi-Prototype-Creation)
