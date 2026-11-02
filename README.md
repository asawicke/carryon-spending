# CarryOn Spending — EECS 497 capstone

## Lo-Fi prototype

This is a working React/Flask progressive web app for the team's priority budget → expense → decision flow. It lets a student create a trip, set a total and category budget, review commonly missed costs, enter or edit an expense in local currency, and see the updated home-currency balance, category breakdown, daily guidance, and a possible-purchase calculation. Trip and expense records live in SQLite. Expense submissions use a client-generated ID so a queued offline retry creates at most one server record.

The sample Paris trip starts at **$1,700 budget, $1,058 spent, $642 remaining**. The exchange rates are fixed **demo estimates**, clearly labeled in the app. Live rates, flight alerts, travel guidance, account login, and a production sync system remain future work.

## Run locally

Requirements: **Python 3.10+**, **Node.js 20.19+ or 22.12+**, npm, and Git. SQLite is included with Python. No API keys or external database are needed.

Clone this private repository using a GitHub account with access:

```sh
git clone https://github.com/asawicke/carryon-spending.git
cd carryon-spending
```

Then run the following from the repository root on macOS or Linux:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
npm ci --prefix frontend
npm run build --prefix frontend
python -m backend.app
```

On Windows PowerShell, create and activate the environment with `py -m venv .venv` and `.\.venv\Scripts\Activate.ps1`, then run the same commands starting with `python -m pip install`.

Open **http://127.0.0.1:5000/** in your browser. Flask serves both the built React app and its API. Keep the terminal running; press Ctrl+C to stop it. Later, activate the environment again and run `python -m backend.app` to restart. Rebuild the frontend after changing its source files.

If port 5000 is occupied (sometimes by AirPlay Receiver on macOS), use `PORT=5050 python -m backend.app` on macOS/Linux and open **http://127.0.0.1:5050/**. The app must be built before opening the Flask URL; an unbuilt frontend returns a 404.

The database is created and seeded automatically on first launch at `backend/data/carryon.db`. Your changes persist on that computer across restarts. This file, installed packages, and generated builds are excluded from Git. To rehearse with a separate database, start with `CARRYON_DB_PATH=/tmp/carryon-rehearsal.db python -m backend.app` on macOS/Linux.

For the PWA cache, visit the app once online. The prototype includes an expense queue for offline retries; full offline behavior still needs browser testing.

## Frontend development

Keep Flask running on port 5000. In a second terminal at the repository root, run `npm run dev --prefix frontend` and open the URL Vite prints (usually http://127.0.0.1:5173/). Vite forwards `/api` requests to Flask; edits appear without rebuilding. If you change Flask's port, update the proxy target in `frontend/vite.config.js` too.

## Project structure

- `frontend/src/`: React screens, forms, budget calculations, and offline expense queue.
- `frontend/public/`: PWA manifest, service worker, and icons.
- `backend/app.py`: Flask API, input validation, currency conversion, and SQLite storage.
- `backend/tests/`: API behavior tests using temporary databases.

Useful API URLs: `/api/health`, `/api/trips`, and `/api/rates`. These return JSON; `/` opens the app.

## Verify

- Backend behavior (with the environment activated): `python -m unittest discover -s backend/tests -v`
- Production frontend build: `npm run build --prefix frontend`

## Project references

- [EECS 497 – Capstone Project folder](https://drive.google.com/drive/folders/130RJwSIgSeLF7ZevDTFqgfarOgmiQ-yF)
- [Team user requirements](https://docs.google.com/document/d/1JayOina8pale-Gw71MvVIuDWl6Kys1jVBq2v5S1WbWE)
- [Figma Make lo-fi prototype](https://www.figma.com/make/NUjJLaoI0HzRKz7lWTytJU/Lofi-Prototype-Creation?p=f&t=wAIy1PFGYRGPDWDS-0)

The references may require team access. This code is a local implementation alongside the Figma prototype. Exchange rates are sample estimates; travel guidance, live rates, authentication, and production hosting remain future work.
