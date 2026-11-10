# CarryOn PWA — November 8 source snapshot

**Historical snapshot:** this predates the November 9 themes, accounts, and feedback fixes. Use the current source files and [feedback report](FEEDBACK_IMPLEMENTATION.md) for this update.

Original snapshot contents. Production has no seeded sample data. Test fixtures occur only in tests. Private `.env` and database files are excluded.

See [research and requirements](PWA_REFINEMENT_REPORT.md) and [Ignav integration and live verification](FLIGHT_API_INTEGRATION.md).

## .env.example

````dotenv
# Copy to .env and fill this in locally. Never commit .env or use a VITE_ prefix.
IGNAV_API_KEY=
FLIGHT_PROVIDER=ignav
# Counts all attempts, including failures and booking-link requests; resets at midnight UTC.
# The provider's 1,000 free requests are ONE TIME, not a monthly allowance.
IGNAV_DAILY_LIMIT=20
# Optional, separate live-status provider. Not needed for Ignav fare search.
AIRLABS_API_KEY=
# A conservative per-installation monthly guard; AirLabs' free plan is personal use.
AIRLABS_MONTHLY_LIMIT=900
# Optional: use a separate database or port.
# CARRYON_DB_PATH=/absolute/path/to/carryon.sqlite3
# PORT=5050
````

## README.md

````markdown
# CarryOn Spending — EECS 497 capstone

## Lo-Fi prototype

A travel budgeting PWA built with React, Flask, and SQLite. Plan a trip, track expenses in local and home currencies, view spending charts, create custom categories, and search flight fares.

## Run locally

Requires Python 3.10+, Node.js 20.19+ (20.x) or 22.12+, npm, and Git.

```sh
git clone https://github.com/asawicke/carryon-spending.git
cd carryon-spending
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
npm ci --prefix frontend
npm run build --prefix frontend
PORT=5050 python -m backend.app
```

Open **http://127.0.0.1:5050/**. Keep the terminal running. New installations start empty; create a trip on **Plan**.

**Windows PowerShell:** activate with `.\.venv\Scripts\Activate.ps1`, then use the same install/build commands. Set `$env:PORT = '5050'` and run `python -m backend.app`.

**Updating an existing checkout:** run `git pull`, repeat the install/build commands, and restart Flask. Your local database is preserved.

## Flight search setup

Manual ticket entry works without an API key. To enable fare search:

1. [Create an Ignav account](https://ignav.com/signup), review its terms, verify your email, and get your key from the dashboard.
2. Copy `.env.example` to `.env` **only if `.env` does not already exist**. Enter your key privately as `IGNAV_API_KEY`.
3. Load the configuration and restart Flask:

```sh
set -a
source .env
set +a
PORT=5050 python -m backend.app
```

On PowerShell, set `$env:IGNAV_API_KEY` locally before starting Python. Flask reads environment variables; it does not load `.env` automatically. Never commit keys or put them in frontend code or `VITE_` variables.

Open **Plan → Flights · fare search and tickets**. Search one-way or round-trip fares for one adult in economy using airport/city codes such as DTW or PAR. Searches use the US pricing market and display the returned currency. Save an estimate without changing spending, or open seller booking options. Record purchased tickets separately.

[Ignav pricing](https://ignav.com/pricing), checked November 8, 2026: **1,000 one-time free requests**, then **$2 per 1,000 successful requests**. The local `IGNAV_DAILY_LIMIT=20` setting counts attempts across restarts and resets at midnight UTC; it does not guarantee staying within the provider's free allowance. Searches are cached for 15 minutes and booking links for 5 minutes. Fares are estimates; confirm final prices and fees with the seller. Alerts and historical market-price benchmarks remain stretch goals.

Optional AirLabs live-status lookup uses a separate `AIRLABS_API_KEY`; it is not required for fare search. See the [flight integration notes](docs/FLIGHT_API_INTEGRATION.md) for API details, limits, sources, and verification.

## Data and development

- SQLite stores trips, expenses, categories, checklists, tickets, and saved quotes at `backend/data/carryon.db`. Back it up before moving it. `CARRYON_DB_PATH` selects another location. Databases and `.env` are excluded from Git.
- [Frankfurter](https://frankfurter.dev) provides daily reference exchange rates, cached for six hours. Conversions are estimates and may differ from bank rates or fees. Saved expenses retain their conversion rate.
- Offline expense entries are queued and synced with stable IDs. Trip creation, plan saves, and flights require the server. This is a local, single-user prototype.
- Frontend code is in `frontend/src/`; APIs and provider adapters are in `backend/`. For frontend development, run Flask on port 5000 and `npm run dev --prefix frontend` separately; use Vite's printed URL.

## Verify

```sh
python -m unittest discover -s backend/tests -v
npm run build --prefix frontend
```

Tests use temporary databases and isolated fixtures, not production sample data.

## Project references

[Research and requirements audit](docs/PWA_REFINEMENT_REPORT.md) · [Flight integration](docs/FLIGHT_API_INTEGRATION.md) · [Drive folder](https://drive.google.com/drive/folders/130RJwSIgSeLF7ZevDTFqgfarOgmiQ-yF) · [Requirements](https://docs.google.com/document/d/1JayOina8pale-Gw71MvVIuDWl6Kys1jVBq2v5S1WbWE) · [Figma](https://www.figma.com/make/NUjJLaoI0HzRKz7lWTytJU/Lofi-Prototype-Creation)
````

## backend/app.py

````python
"""Persistent API and production file server for the CarryOn prototype.

Run locally with ``python3 -m backend.app``. New installations start empty.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

from flask import Flask, abort, g, jsonify, request, send_from_directory
from .providers import SUPPORTED_CURRENCIES, rates as provider_rates, ProviderError
from .categories import canonical_category, register_categories, PREPARATION
from .flights import register_flights
from .fare_routes import register_fares


BASE_CURRENCY = "USD"
DEFAULT_OVERLOOKED_COSTS = [
    {"id": key, "label": label, "estimate": 0, "checked": False}
    for key, label in (("passport", "Passport renewal"), ("visa", "Visa or entry fees"),
                       ("insurance", "Travel insurance"), ("airport", "Airport transfer"),
                       ("sim", "SIM / eSIM"), ("fees", "Foreign transaction and ATM fees"),
                       ("baggage", "Baggage fees"), ("buffer", "Emergency cushion"))
]
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CENT = Decimal("0.01")
MAX_MONEY = Decimal("1000000000")


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = "invalid_request"):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_date(value: object, field: str, *, optional: bool = False) -> str | None:
    if optional and value is None:
        return None
    if not isinstance(value, str) or not DATE_PATTERN.fullmatch(value):
        raise ApiError(f"{field} must be a date in YYYY-MM-DD format.")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise ApiError(f"{field} must be a valid date.") from exc
    if parsed.isoformat() != value:
        raise ApiError(f"{field} must be a date in YYYY-MM-DD format.")
    return value


def text_field(value: object, field: str, *, maximum: int, allow_empty: bool = False) -> str:
    if not isinstance(value, str):
        raise ApiError(f"{field} must be text.")
    cleaned = value.strip()
    if not allow_empty and not cleaned:
        raise ApiError(f"{field} is required.")
    if len(cleaned) > maximum:
        raise ApiError(f"{field} must be {maximum} characters or fewer.")
    return cleaned


def decimal_money(value: object, field: str, *, allow_zero: bool = False) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (int, float, str, Decimal)):
        raise ApiError(f"{field} must be a number.")
    try:
        money = Decimal(str(value))
    except InvalidOperation as exc:
        raise ApiError(f"{field} must be a number.") from exc
    if not money.is_finite() or money >= MAX_MONEY:
        raise ApiError(f"{field} must be a finite amount below one billion.")
    if money < 0 or (money == 0 and not allow_zero):
        qualifier = "zero or greater" if allow_zero else "greater than zero"
        raise ApiError(f"{field} must be {qualifier}.")
    if money.quantize(CENT, rounding=ROUND_HALF_UP) != money:
        raise ApiError(f"{field} cannot have more than two decimal places.")
    return money


def to_cents(value: Decimal) -> int:
    return int((value * 100).to_integral_value(rounding=ROUND_HALF_UP))


def from_cents(value: int) -> float:
    return float(Decimal(value) / 100)


def currency_field(value: object, field: str = "currency") -> str:
    if not isinstance(value, str) or value.upper() not in SUPPORTED_CURRENCIES:
        supported = ", ".join(SUPPORTED_CURRENCIES)
        raise ApiError(f"{field} must be one of: {supported}.")
    return value.upper()


def category_budgets_field(value: object) -> dict[str, float]:
    if not isinstance(value, dict) or len(value) > 20:
        raise ApiError("categoryBudgets must be an object with at most 20 categories.")
    result: dict[str, float] = {}
    for raw_name, raw_amount in value.items():
        name = text_field(raw_name, "Category name", maximum=40)
        if name in result:
            raise ApiError("categoryBudgets contains a duplicate category.")
        result[name] = from_cents(to_cents(decimal_money(raw_amount, f"Budget for {name}", allow_zero=True)))
    return result


def overlooked_costs_field(value: object) -> list[dict]:
    if not isinstance(value, list) or len(value) > 50:
        raise ApiError("overlookedCosts must be a list with at most 50 items.")
    result = []
    seen_ids = set()
    for index, raw_item in enumerate(value):
        if not isinstance(raw_item, dict):
            raise ApiError(f"overlookedCosts item {index + 1} must be an object.")
        item_id = text_field(raw_item.get("id", str(uuid.uuid4())), "Cost id", maximum=80)
        if item_id in seen_ids:
            raise ApiError("overlookedCosts contains a duplicate id.")
        seen_ids.add(item_id)
        label = text_field(raw_item.get("label"), "Cost label", maximum=100)
        estimate = decimal_money(raw_item.get("estimate", 0), "Cost estimate", allow_zero=True)
        checked = raw_item.get("checked", False)
        if not isinstance(checked, bool):
            raise ApiError("Cost checked must be true or false.")
        result.append({"id": item_id, "label": label, "estimate": from_cents(to_cents(estimate)), "checked": checked})
    return result


def body_object() -> dict:
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ApiError("Request body must be a JSON object.")
    return body


def require_allowed(body: dict, allowed: set[str]) -> None:
    unknown = sorted(set(body) - allowed)
    if unknown:
        raise ApiError(f"Unknown field: {unknown[0]}.")
    if not body:
        raise ApiError("At least one field is required.")


def connect_database(path: str) -> sqlite3.Connection:
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 10000")
    return connection


def init_database(path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    db = connect_database(path)
    try:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS trips (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                destination TEXT NOT NULL,
                start_date TEXT,
                end_date TEXT,
                budget_cents INTEGER NOT NULL CHECK (budget_cents >= 0),
                currency TEXT NOT NULL,
                local_currency TEXT NOT NULL,
                category_budgets_json TEXT NOT NULL,
                overlooked_costs_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS expenses (
                id TEXT PRIMARY KEY,
                client_id TEXT NOT NULL,
                trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
                currency TEXT NOT NULL,
                amount_base_cents INTEGER NOT NULL CHECK (amount_base_cents >= 0),
                rate REAL NOT NULL,
                category TEXT NOT NULL,
                note TEXT NOT NULL,
                date TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT,
                UNIQUE (trip_id, client_id)
            );
            CREATE INDEX IF NOT EXISTS expenses_trip_date ON expenses (trip_id, date DESC, created_at DESC);
            """
        )
        columns = {row["name"] for row in db.execute("PRAGMA table_info(trips)")}
        if "local_currency" not in columns:
            db.execute("ALTER TABLE trips ADD COLUMN local_currency TEXT NOT NULL DEFAULT 'USD'")
        if "preparation_json" not in columns:
            db.execute("ALTER TABLE trips ADD COLUMN preparation_json TEXT NOT NULL DEFAULT '{}'")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS categories (name_key TEXT PRIMARY KEY, name TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS provider_cache (
                key TEXT PRIMARY KEY, data TEXT NOT NULL, created_at REAL NOT NULL, expires_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS provider_usage (month TEXT PRIMARY KEY, count INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS flight_api_usage (period TEXT PRIMARY KEY, count INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS fare_quotes (
                id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id),
                client_id TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL,
                UNIQUE(trip_id, client_id)
            );
            CREATE TABLE IF NOT EXISTS flights (
                id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id),
                client_id TEXT NOT NULL, details TEXT NOT NULL, expense_id TEXT REFERENCES expenses(id),
                created_at TEXT NOT NULL, UNIQUE(trip_id, client_id)
            );
        """)
        # Preserve the old prototype's sample trip in storage, but never serve it.
        for row in db.execute("SELECT DISTINCT category FROM expenses WHERE trip_id != 'demo-paris'"):
            canonical_category(db, row["category"])
        db.commit()
    finally:
        db.close()


def conversion_rate(from_currency: str, to_currency: str) -> Decimal:
    if from_currency == to_currency:
        return Decimal("1")
    available = provider_rates(get_db())
    if from_currency not in available["rates"] or to_currency not in available["rates"]:
        raise ApiError("An exchange rate is unavailable. Try again later or record the actual home-currency amount.",
                       status=503, code="rate_unavailable")
    return Decimal(str(available["rates"][to_currency])) / Decimal(str(available["rates"][from_currency]))


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = connect_database(g.app_db_path)
    return g.db


def trip_row(trip_id: str) -> sqlite3.Row:
    row = get_db().execute("SELECT * FROM trips WHERE id = ?", (trip_id,)).fetchone()
    if row is None or row["id"] == "demo-paris":
        raise ApiError("Trip not found.", status=404, code="not_found")
    return row


def expense_row(expense_id: str, *, include_deleted: bool = False) -> sqlite3.Row:
    clause = "" if include_deleted else " AND deleted_at IS NULL"
    row = get_db().execute(f"SELECT * FROM expenses WHERE id = ?{clause}", (expense_id,)).fetchone()
    if row is None or row["trip_id"] == "demo-paris":
        raise ApiError("Expense not found.", status=404, code="not_found")
    return row


def expense_dict(row: sqlite3.Row) -> dict:
    result = {
        "id": row["id"], "clientId": row["client_id"], "tripId": row["trip_id"],
        "amount": from_cents(row["amount_cents"]), "currency": row["currency"],
        "amountBase": from_cents(row["amount_base_cents"]), "rate": round(row["rate"], 8),
        "category": row["category"], "note": row["note"], "date": row["date"],
        "createdAt": row["created_at"], "updatedAt": row["updated_at"],
    }
    if row["deleted_at"]:
        result["deletedAt"] = row["deleted_at"]
    return result


def trip_dict(row: sqlite3.Row) -> dict:
    db = get_db()
    totals = db.execute(
        """SELECT COALESCE(SUM(amount_base_cents), 0) AS spent_cents,
                  COUNT(*) AS expense_count
           FROM expenses WHERE trip_id = ? AND deleted_at IS NULL""",
        (row["id"],),
    ).fetchone()
    categories = db.execute(
        """SELECT category, SUM(amount_base_cents) AS spent_cents FROM expenses
           WHERE trip_id = ? AND deleted_at IS NULL GROUP BY category""",
        (row["id"],),
    ).fetchall()
    spent = totals["spent_cents"]
    budget = row["budget_cents"]
    return {
        "id": row["id"], "name": row["name"], "destination": row["destination"],
        "startDate": row["start_date"], "endDate": row["end_date"],
        "budget": from_cents(budget), "currency": row["currency"],
        "localCurrency": row["local_currency"],
        "categoryBudgets": json.loads(row["category_budgets_json"]),
        "overlookedCosts": json.loads(row["overlooked_costs_json"]),
        "preparation": json.loads(row["preparation_json"]),
        "summary": {
            "spent": from_cents(spent), "remaining": from_cents(budget - spent),
            "percentUsed": round(spent * 100 / budget, 1) if budget else 0,
            "expenseCount": totals["expense_count"],
            "categorySpent": {entry["category"]: from_cents(entry["spent_cents"]) for entry in categories},
        },
        "createdAt": row["created_at"], "updatedAt": row["updated_at"],
    }


def normalized_trip_body(body: dict, *, existing: sqlite3.Row | None = None) -> dict:
    allowed = {"name", "destination", "startDate", "endDate", "budget", "currency", "localCurrency", "categoryBudgets", "overlookedCosts", "preparation"}
    require_allowed(body, allowed)
    name = text_field(body.get("name", existing["name"] if existing else None), "name", maximum=100)
    destination = text_field(body.get("destination", existing["destination"] if existing else None), "destination", maximum=100)
    start = parse_date(body.get("startDate", existing["start_date"] if existing else None), "startDate", optional=True)
    end = parse_date(body.get("endDate", existing["end_date"] if existing else None), "endDate", optional=True)
    if start and end and end < start:
        raise ApiError("endDate cannot be before startDate.")
    raw_budget = body.get("budget", from_cents(existing["budget_cents"]) if existing else None)
    budget = decimal_money(raw_budget, "budget", allow_zero=True)
    currency = currency_field(body.get("currency", existing["currency"] if existing else "USD"))
    local_currency = currency_field(body.get("localCurrency", existing["local_currency"] if existing else currency), "localCurrency")
    if existing and currency != existing["currency"]:
        count = get_db().execute("SELECT COUNT(*) FROM expenses WHERE trip_id = ? AND deleted_at IS NULL", (existing["id"],)).fetchone()[0]
        if count:
            raise ApiError("Trip currency cannot change after expenses are recorded.", status=409, code="currency_locked")
    raw_categories = body.get("categoryBudgets", json.loads(existing["category_budgets_json"]) if existing else {})
    raw_costs = body.get("overlookedCosts", json.loads(existing["overlooked_costs_json"]) if existing else DEFAULT_OVERLOOKED_COSTS)
    preparation = body.get("preparation", json.loads(existing["preparation_json"]) if existing else {})
    if not isinstance(preparation, dict) or any(key not in PREPARATION or not isinstance(value, bool)
                                               for key, value in preparation.items()):
        raise ApiError("Preparation must contain the supported checklist items with true or false values.")
    return {
        "preparation_json": json.dumps(preparation),
        "name": name, "destination": destination, "start_date": start, "end_date": end,
        "budget_cents": to_cents(budget), "currency": currency, "local_currency": local_currency,
        "category_budgets_json": json.dumps(category_budgets_field(raw_categories), separators=(",", ":")),
        "overlooked_costs_json": json.dumps(overlooked_costs_field(raw_costs), separators=(",", ":")),
    }


def normalized_expense_body(body: dict, *, existing: sqlite3.Row | None = None) -> dict:
    allowed = {"amount", "currency", "category", "note", "date"}
    if existing is None:
        allowed.add("clientId")
    require_allowed(body, allowed)
    if existing is None:
        client_id = text_field(body.get("clientId"), "clientId", maximum=100)
    else:
        client_id = existing["client_id"]
    amount = decimal_money(body.get("amount", from_cents(existing["amount_cents"]) if existing else None), "amount")
    currency = currency_field(body.get("currency", existing["currency"] if existing else "USD"))
    category = text_field(body.get("category", existing["category"] if existing else "Other"), "category", maximum=40)
    note = text_field(body.get("note", existing["note"] if existing else ""), "note", maximum=200, allow_empty=True)
    expense_date = parse_date(body.get("date", existing["date"] if existing else date.today().isoformat()), "date")
    return {"client_id": client_id, "amount_cents": to_cents(amount), "currency": currency,
            "category": category, "note": note, "date": expense_date}


def create_app(config: dict | None = None) -> Flask:
    app = Flask(__name__, static_folder=None)
    default_db = Path(__file__).resolve().parent / "data" / "carryon.db"
    app.config.update(
        DATABASE_PATH=os.environ.get("CARRYON_DB_PATH", str(default_db)),
        AIRLABS_API_KEY=os.environ.get("AIRLABS_API_KEY", ""),
        AIRLABS_MONTHLY_LIMIT=int(os.environ.get("AIRLABS_MONTHLY_LIMIT", "900")),
        IGNAV_API_KEY=os.environ.get("IGNAV_API_KEY", ""),
        IGNAV_DAILY_LIMIT=int(os.environ.get("IGNAV_DAILY_LIMIT", "20")),
        FLIGHT_PROVIDER=os.environ.get("FLIGHT_PROVIDER", "ignav"),
        FRONTEND_DIST=str(Path(__file__).resolve().parent.parent / "frontend" / "dist"),
    )
    if config:
        app.config.update(config)
    init_database(app.config["DATABASE_PATH"])
    register_categories(app, globals())
    register_flights(app, globals())
    register_fares(app, globals())

    @app.before_request
    def attach_db_path() -> None:
        g.app_db_path = app.config["DATABASE_PATH"]

    @app.teardown_appcontext
    def close_db(_error: Exception | None) -> None:
        database = g.pop("db", None)
        if database is not None:
            database.close()

    @app.errorhandler(ProviderError)
    def provider_error(error):
        response = jsonify({"error": {"code": error.code, "message": error.message}})
        if error.status == 429:
            response.headers["Retry-After"] = "60"
        return response, error.status

    @app.errorhandler(ApiError)
    def handle_api_error(error: ApiError):
        return jsonify({"error": {"code": error.code, "message": error.message}}), error.status

    @app.errorhandler(404)
    def handle_not_found(_error):
        if request.path.startswith("/api/"):
            return jsonify({"error": {"code": "not_found", "message": "Endpoint not found."}}), 404
        return _error

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok"})

    @app.get("/api/rates")
    def rates():
        return jsonify(provider_rates(get_db()))

    @app.get("/api/trips")
    def list_trips():
        rows = get_db().execute("SELECT * FROM trips WHERE id != 'demo-paris' ORDER BY created_at DESC, id").fetchall()
        return jsonify([trip_dict(row) for row in rows])

    @app.post("/api/trips")
    def create_trip():
        fields = normalized_trip_body(body_object())
        trip_id = str(uuid.uuid4())
        timestamp = now_iso()
        db = get_db()
        db.execute(
            """INSERT INTO trips
               (id, name, destination, start_date, end_date, budget_cents, currency, local_currency,
                category_budgets_json, overlooked_costs_json, preparation_json, created_at, updated_at)
               VALUES (:id, :name, :destination, :start_date, :end_date, :budget_cents, :currency, :local_currency,
                       :category_budgets_json, :overlooked_costs_json, :preparation_json, :created_at, :updated_at)""",
            {"id": trip_id, **fields, "created_at": timestamp, "updated_at": timestamp},
        )
        db.commit()
        return jsonify(trip_dict(trip_row(trip_id))), 201

    @app.get("/api/trips/<trip_id>")
    def get_trip(trip_id: str):
        return jsonify(trip_dict(trip_row(trip_id)))

    @app.patch("/api/trips/<trip_id>")
    def update_trip(trip_id: str):
        current = trip_row(trip_id)
        fields = normalized_trip_body(body_object(), existing=current)
        db = get_db()
        db.execute(
            """UPDATE trips SET name=:name, destination=:destination, start_date=:start_date,
               end_date=:end_date, budget_cents=:budget_cents, currency=:currency,
               local_currency=:local_currency,
               category_budgets_json=:category_budgets_json,
               overlooked_costs_json=:overlooked_costs_json, preparation_json=:preparation_json, updated_at=:updated_at WHERE id=:id""",
            {"id": trip_id, **fields, "updated_at": now_iso()},
        )
        db.commit()
        return jsonify(trip_dict(trip_row(trip_id)))

    @app.get("/api/trips/<trip_id>/expenses")
    def list_expenses(trip_id: str):
        trip_row(trip_id)
        rows = get_db().execute(
            """SELECT * FROM expenses WHERE trip_id = ? AND deleted_at IS NULL
               ORDER BY date DESC, created_at DESC, id DESC""",
            (trip_id,),
        ).fetchall()
        return jsonify([expense_dict(row) for row in rows])

    @app.post("/api/trips/<trip_id>/expenses")
    def create_expense(trip_id: str):
        trip = trip_row(trip_id)
        fields = normalized_expense_body(body_object())
        db = get_db()
        # The unique (trip_id, client_id) key survives soft deletion, so replaying
        # an offline write cannot increase the balance a second time.
        prior = db.execute(
            "SELECT * FROM expenses WHERE trip_id = ? AND client_id = ?",
            (trip_id, fields["client_id"]),
        ).fetchone()
        if prior is not None:
            return jsonify(expense_dict(prior)), 200
        rate = conversion_rate(fields["currency"], trip["currency"])
        fields["category"] = canonical_category(get_db(), fields["category"])
        amount_base = to_cents(Decimal(fields["amount_cents"]) / 100 * rate)
        expense_id = str(uuid.uuid4())
        timestamp = now_iso()
        try:
            db.execute(
                """INSERT INTO expenses
                   (id, client_id, trip_id, amount_cents, currency, amount_base_cents, rate,
                    category, note, date, created_at, updated_at)
                   VALUES (:id, :client_id, :trip_id, :amount_cents, :currency, :amount_base_cents,
                           :rate, :category, :note, :date, :created_at, :updated_at)""",
                {"id": expense_id, "trip_id": trip_id, **fields, "amount_base_cents": amount_base,
                 "rate": float(rate), "created_at": timestamp, "updated_at": timestamp},
            )
            db.commit()
        except sqlite3.IntegrityError:
            db.rollback()
            prior = db.execute(
                "SELECT * FROM expenses WHERE trip_id = ? AND client_id = ?",
                (trip_id, fields["client_id"]),
            ).fetchone()
            if prior is None:
                raise
            return jsonify(expense_dict(prior)), 200
        return jsonify(expense_dict(expense_row(expense_id))), 201

    @app.patch("/api/expenses/<expense_id>")
    def update_expense(expense_id: str):
        current = expense_row(expense_id)
        fields = normalized_expense_body(body_object(), existing=current)
        trip = trip_row(current["trip_id"])
        rate = Decimal(str(current["rate"])) if fields["currency"] == current["currency"] else conversion_rate(fields["currency"], trip["currency"])
        fields["category"] = canonical_category(get_db(), fields["category"])
        amount_base = to_cents(Decimal(fields["amount_cents"]) / 100 * rate)
        db = get_db()
        db.execute(
            """UPDATE expenses SET amount_cents=:amount_cents, currency=:currency,
               amount_base_cents=:amount_base_cents, rate=:rate, category=:category,
               note=:note, date=:date, updated_at=:updated_at WHERE id=:id""",
            {"id": expense_id, **fields, "amount_base_cents": amount_base,
             "rate": float(rate), "updated_at": now_iso()},
        )
        db.commit()
        return jsonify(expense_dict(expense_row(expense_id)))

    @app.delete("/api/expenses/<expense_id>")
    def delete_expense(expense_id: str):
        row = expense_row(expense_id, include_deleted=True)
        if row["deleted_at"] is None:
            db = get_db()
            timestamp = now_iso()
            db.execute("UPDATE expenses SET deleted_at = ?, updated_at = ? WHERE id = ?", (timestamp, timestamp, expense_id))
            db.commit()
        return "", 204

    @app.get("/")
    @app.get("/<path:asset_path>")
    def frontend(asset_path: str = ""):
        if asset_path.startswith("api/"):
            abort(404)
        dist = Path(app.config["FRONTEND_DIST"])
        if asset_path and (dist / asset_path).is_file():
            response = send_from_directory(dist, asset_path)
            is_index = False
        elif (dist / "index.html").is_file():
            response = send_from_directory(dist, "index.html")
            is_index = True
        else:
            abort(404, description="Frontend build not found. Start Vite or build the frontend.")
        if asset_path == "sw.js" or is_index:
            response.headers["Cache-Control"] = "no-cache"
        return response

    return app


if __name__ == "__main__":
    create_app().run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")))
````

## backend/categories.py

````python
"""Persistent, Unicode-aware category names shared by expense entry and planning."""
import unicodedata

BASE_CATEGORIES = ("Stay", "Transit", "Flights", "Food", "Activities", "Shopping", "Other")
PREPARATION = ("passport", "visa", "insurance", "sim", "fees", "baggage")


def clean_name(value):
    return " ".join(unicodedata.normalize("NFKC", value).split())


def canonical_category(db, name):
    name = clean_name(name)
    key = name.casefold()
    for standard in BASE_CATEGORIES:
        if standard.casefold() == key:
            return standard
    row = db.execute("SELECT name FROM categories WHERE name_key=?", (key,)).fetchone()
    if row:
        return row["name"]
    db.execute("INSERT OR IGNORE INTO categories (name_key, name) VALUES (?,?)", (key, name))
    return db.execute("SELECT name FROM categories WHERE name_key=?", (key,)).fetchone()["name"]


def register_categories(app, helpers):
    db, body, text, error = (helpers[key] for key in ("get_db", "body_object", "text_field", "ApiError"))

    @app.get("/api/categories")
    def list_categories():
        custom = [row["name"] for row in db().execute("SELECT name FROM categories ORDER BY name_key")]
        return {"standard": list(BASE_CATEGORIES), "custom": custom}

    @app.post("/api/categories")
    def add_category():
        data = body()
        if set(data) != {"name"}:
            raise error("Provide one category name.")
        name = clean_name(text(data["name"], "Category name", maximum=40))
        if not name:
            raise error("Category name is required.")
        result = canonical_category(db(), name)
        db().commit()
        return {"name": result}, 201
````

## backend/flights.py

````python
"""Saved itineraries and atomic, idempotent flight-fare expense recording."""
import json
import re
import time
import uuid
from decimal import Decimal

from flask import request
from .providers import cached, flight_lookup


def register_flights(app, helpers):
    db, trip_row, body, error, now = (helpers[key] for key in
                                    ("get_db", "trip_row", "body_object", "ApiError", "now_iso"))

    @app.get("/api/flights/lookup")
    def lookup():
        number = re.sub(r"\s+", "", request.args.get("number", "")).upper()
        if not re.fullmatch(r"[A-Z0-9]{2}\d{1,4}[A-Z]?", number):
            raise error("Use the flight code on your ticket, such as AA100.")
        result = flight_lookup(db(), number)
        return {**result, "source": "AirLabs",
                "notice": "Lookup returns the closest scheduled/live flight, not future fares. Confirm your travel date."}

    @app.get("/api/trips/<trip_id>/flights")
    def list_flights(trip_id):
        trip_row(trip_id)
        rows = db().execute("""SELECT f.*, e.amount_cents, e.currency, e.deleted_at
            FROM flights f LEFT JOIN expenses e ON e.id=f.expense_id
            WHERE f.trip_id=? ORDER BY f.created_at DESC""", (trip_id,))
        result = []
        for row in rows:
            details = json.loads(row["details"])
            linked = row["expense_id"] if row["deleted_at"] is None else None
            if linked and row["amount_cents"] is not None:
                details.update(fare=row["amount_cents"] / 100, currency=row["currency"])
            result.append(details | {"id": row["id"], "expenseId": linked})
        return result

    @app.post("/api/trips/<trip_id>/flights")
    def save_flight(trip_id):
        trip = trip_row(trip_id)
        data = body()
        allowed = {"clientId", "flightNumber", "departureDate", "origin", "destination",
                   "fare", "currency", "logExpense", "lookupId", "paymentDate"}
        helpers["require_allowed"](data, allowed)
        client_id = helpers["text_field"](data.get("clientId"), "Submission id", maximum=100)
        prior = db().execute("SELECT * FROM flights WHERE trip_id=? AND client_id=?", (trip_id, client_id)).fetchone()
        if prior:
            return json.loads(prior["details"]) | {"id": prior["id"], "expenseId": prior["expense_id"]}, 200
        details = {}
        for field, maximum in (("flightNumber", 10), ("origin", 3), ("destination", 3)):
            details[field] = helpers["text_field"](data.get(field), field, maximum=maximum).upper()
        if not re.fullmatch(r"[A-Z0-9]{2}\d{1,4}[A-Z]?", details["flightNumber"]):
            raise error("Enter a valid flight code.")
        if not all(re.fullmatch(r"[A-Z]{3}", details[field]) for field in ("origin", "destination")):
            raise error("Use three-letter airport codes from your ticket.")
        if details["origin"] == details["destination"]:
            raise error("Departure and arrival airports must differ.")
        details["departureDate"] = helpers["parse_date"](data.get("departureDate"), "Departure date")
        payment_date = helpers["parse_date"](data.get("paymentDate", now()[:10]), "Payment date")
        details["currency"] = helpers["currency_field"](data.get("currency", trip["currency"]))
        fare = helpers["decimal_money"](data.get("fare"), "Fare", allow_zero=True)
        details.update(fare=float(fare), source="Your ticket", status="Not checked")
        if not isinstance(data.get("logExpense", False), bool):
            raise error("Record fare must be true or false.")
        lookup_id = data.get("lookupId")
        if lookup_id:
            row = cached(db(), str(lookup_id))
            found = json.loads(row["data"]).get("flight") if row and row["expires_at"] > time.time() else None
            if (not found or found["flightNumber"] != details["flightNumber"] or
                    found["departureDate"] != details["departureDate"] or
                    found["origin"] != details["origin"] or found["destination"] != details["destination"]):
                raise error("Flight details changed or the lookup expired. Search again or save as ticket details.")
            details.update(status=found["status"], source="AirLabs",
                           checkedAt=json.loads(row["data"])["checkedAt"],
                           departureTime=found["departureTime"], arrivalTime=found["arrivalTime"])
        flight_id, expense_id, timestamp = str(uuid.uuid4()), None, now()
        rate = helpers["conversion_rate"](details["currency"], trip["currency"]) if data.get("logExpense") else None
        if data.get("logExpense") and fare <= 0:
            raise error("Enter the actual amount paid before recording an expense.")
        connection = db()
        try:
            connection.execute("BEGIN IMMEDIATE")
            prior = connection.execute("SELECT * FROM flights WHERE trip_id=? AND client_id=?",
                                       (trip_id, client_id)).fetchone()
            if prior:
                connection.rollback()
                return json.loads(prior["details"]) | {"id": prior["id"], "expenseId": prior["expense_id"]}, 200
            if rate is not None:
                expense_id = str(uuid.uuid4())
                connection.execute("""INSERT INTO expenses
                    (id,client_id,trip_id,amount_cents,currency,amount_base_cents,rate,category,note,date,created_at,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (expense_id, "flight:" + client_id, trip_id, helpers["to_cents"](fare), details["currency"],
                     helpers["to_cents"](fare * Decimal(str(rate))), float(rate), "Flights",
                     details["flightNumber"] + " " + details["origin"] + "–" + details["destination"],
                     payment_date, timestamp, timestamp))
            connection.execute("INSERT INTO flights VALUES (?,?,?,?,?,?)",
                               (flight_id, trip_id, client_id, json.dumps(details), expense_id, timestamp))
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        return details | {"id": flight_id, "expenseId": expense_id}, 201
````

## backend/providers.py

````python
"""Real provider requests, bounded timeouts, persistent cache and quota protection."""
import json
import os
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from flask import current_app

SUPPORTED_CURRENCIES = ("USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "CNY", "INR", "NZD")


class ProviderError(Exception):
    def __init__(self, message, status=503, code="provider_unavailable"):
        super().__init__(message)
        self.message, self.status, self.code = message, status, code


def fetch_json(url):
    # Never propagate URLs/exceptions: the flight provider authenticates in its query.
    try:
        with urlopen(Request(url, headers={"Accept": "application/json"}), timeout=8) as response:
            return json.loads(response.read(1_000_000))
    except HTTPError as error:
        status = 429 if error.code == 429 else 503
        raise ProviderError("The provider is busy. Try again later.", status) from None
    except (URLError, TimeoutError, ValueError, OSError):
        raise ProviderError("The provider is unavailable. Your saved data is safe.") from None


def cached(db, key):
    row = db.execute("SELECT * FROM provider_cache WHERE key=?", (key,)).fetchone()
    return dict(row) if row else None


def put_cache(db, key, data, ttl):
    db.execute("INSERT OR REPLACE INTO provider_cache VALUES (?, ?, ?, ?)",
               (key, json.dumps(data), time.time(), time.time() + ttl))
    db.commit()


def rates(db):
    key = "rates:USD"
    row = cached(db, key)
    if row and row["expires_at"] > time.time():
        return json.loads(row["data"])
    try:
        query = urlencode({"base": "USD", "quotes": ",".join(SUPPORTED_CURRENCIES[1:])})
        transport = current_app.config.get("HTTP_FETCH", fetch_json)
        rows = transport("https://api.frankfurter.dev/v2/rates?" + query)
        values, dates = {"USD": 1}, {}
        if not isinstance(rows, list):
            raise ProviderError("Exchange rates could not be read.")
        for item in rows:
            quote, value = item.get("quote"), item.get("rate")
            if quote in SUPPORTED_CURRENCIES and isinstance(value, (int, float)) and 0 < value < 1e9:
                values[quote], dates[quote] = value, item.get("date")
        if len(values) < 2:
            raise ProviderError("No exchange rates are available.")
        result = {"base": "USD", "rates": values, "dates": dates, "source": "Frankfurter",
                  "sourceUrl": "https://frankfurter.dev", "stale": False,
                  "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        put_cache(db, key, result, 6 * 3600)
        return result
    except ProviderError:
        if row and time.time() - row["created_at"] < 7 * 86400:
            return {**json.loads(row["data"]), "stale": True}
        # One is an identity conversion, never a fabricated foreign-currency rate.
        return {"base": "USD", "rates": {"USD": 1}, "dates": {}, "source": "Frankfurter",
                "unavailable": True, "message": "Exchange rates are unavailable. You can still enter USD expenses."}


def flight_lookup(db, number):
    key = "flight:" + number
    row = cached(db, key)
    if row and row["expires_at"] > time.time():
        result = json.loads(row["data"])
        if result.get("error"):
            raise ProviderError(result["error"], result.get("status", 503))
        return result
    api_key = current_app.config.get("AIRLABS_API_KEY") or os.environ.get("AIRLABS_API_KEY")
    if not api_key:
        raise ProviderError("Flight lookup is not configured. You can add your flight details manually.",
                            503, "not_configured")
    month = time.strftime("%Y-%m", time.gmtime())
    limit = int(current_app.config.get("AIRLABS_MONTHLY_LIMIT", 900))
    # Atomic local budget, shared across processes/restarts; failed calls count too.
    db.execute("INSERT OR IGNORE INTO provider_usage VALUES (?, 0)", (month,))
    allowed = db.execute("UPDATE provider_usage SET count=count+1 WHERE month=? AND count<?",
                         (month, limit)).rowcount
    db.commit()
    if not allowed:
        raise ProviderError("This month's flight lookup allowance is used. Enter flight details manually.", 429)
    try:
        query = urlencode({"flight_iata": number, "api_key": api_key})
        transport = current_app.config.get("HTTP_FETCH", fetch_json)
        payload = transport("https://airlabs.co/api/v9/flight?" + query)
        if not isinstance(payload, dict):
            raise ProviderError("Flight information could not be read.")
        if payload.get("error"):
            code = str(payload["error"].get("code", "")) if isinstance(payload["error"], dict) else ""
            if code == "not_found":
                result = {"flight": None}
                put_cache(db, key, result, 60)
                return result
            status = 429 if "limit" in code else 503
            raise ProviderError("Flight lookup is temporarily unavailable. Try later or enter details manually.", status)
        # Docs show the flight object; live responses may wrap it in 'response'.
        flight = payload.get("response", payload)
        if not flight:
            result = {"flight": None}
        elif not isinstance(flight, dict) or not isinstance(flight.get("flight_iata"), str) or not flight["flight_iata"]:
            raise ProviderError("The flight provider returned incomplete information. Enter details manually.")
        else:
            text = lambda key: flight.get(key) if isinstance(flight.get(key), str) else ""
            result = {"flight": {"flightNumber": flight["flight_iata"],
                      "origin": text("dep_iata"), "destination": text("arr_iata"),
                      "departureTime": text("dep_time"), "arrivalTime": text("arr_time"),
                      "departureDate": text("dep_time")[:10],
                      "status": text("status") or "Not supplied",
                      "source": "AirLabs", "lookupId": key},
                      "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        put_cache(db, key, result, 15 * 60 if result["flight"] else 60)
        return result
    except ProviderError as error:
        put_cache(db, key, {"error": error.message, "status": error.status}, 60)
        raise
````

## backend/ignav.py

````python
"""Ignav adapter. Official contract: https://ignav.com/docs/one-way ."""
import json
import math
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from flask import current_app
from .providers import ProviderError


def post_json(endpoint, payload, key):
    request = Request("https://ignav.com/api/fares/" + endpoint,
                      data=json.dumps(payload).encode(), method="POST",
                      headers={"X-Api-Key": key, "Content-Type": "application/json", "Accept": "application/json"})
    try:
        with urlopen(request, timeout=60) as response:
            return json.loads(response.read(2_000_000))
    except HTTPError as exc:
        try:
            code = json.loads(exc.read(8000)).get("error", {}).get("code", "")
        except (ValueError, AttributeError):
            code = ""
        messages = {
            401: "Flight search needs a valid server API key. You can enter a fare manually.",
            403: "Verify the Ignav account email before searching. Manual entry is available.",
            402: "The flight provider's free allowance or billing access is unavailable. Enter a fare manually.",
            429: "The flight provider's spending limit was reached. Enter a fare manually or try after it resets.",
            404: "Booking links expired or are unavailable. Search again or check the airline directly.",
            400: "The flight provider could not use that route or date. Check the airport codes and dates.",
        }
        message = messages.get(exc.code, "Flight search is temporarily unavailable. Try again later or enter a fare manually.")
        if code == "unsupported_search":
            message = "Those dates are outside the provider's search range. Try earlier dates."
        status = exc.code if exc.code in (400, 404, 429) else 503
        raise ProviderError(message, status, "flight_provider_error") from None
    except (URLError, TimeoutError, ValueError, OSError):
        raise ProviderError("Flight search timed out or is unavailable. Try again later or enter a fare manually.") from None


def text(value, maximum=150):
    return value[:maximum] if isinstance(value, str) else ""


def normalize_itinerary(item):
    if not isinstance(item, dict) or not isinstance(item.get("price"), dict):
        return None
    price = item["price"]
    amount = price.get("amount")
    currency = price.get("currency")
    if (price.get("status") != "verified" or isinstance(amount, bool)
            or not isinstance(amount, (int, float)) or not math.isfinite(amount)
            or not 0 < amount < 1e9 or not isinstance(currency, str)
            or len(currency) != 3 or not currency.isalpha()):
        return None
    legs = []
    for direction in ("outbound", "inbound"):
        leg = item.get(direction)
        if leg is None and direction == "inbound":
            continue
        if (not isinstance(leg, dict) or not isinstance(leg.get("segments"), list)
                or not 1 <= len(leg["segments"]) <= 12):
            return None
        segments = []
        for segment in leg["segments"][:12]:
            if not isinstance(segment, dict):
                return None
            if not all(isinstance(segment.get(key), str) and segment[key]
                       for key in ("departure_airport", "arrival_airport", "departure_time_local", "arrival_time_local")):
                return None
            segments.append({key: text(segment.get(key)) for key in (
                "marketing_carrier_code", "flight_number", "departure_airport", "arrival_airport",
                "departure_time_local", "arrival_time_local", "departure_timezone", "arrival_timezone")})
        legs.append({"direction": direction, "carrier": text(leg.get("carrier")), "segments": segments})
    return {"offerId": text(item.get("ignav_id"), 200), "amount": round(amount, 2),
            "currency": currency.upper(), "legs": legs, "cabin": text(item.get("cabin_class"))}


class IgnavProvider:
    name = "Ignav"

    def request(self, endpoint, payload):
        key = current_app.config.get("IGNAV_API_KEY")
        if not key:
            raise ProviderError("Flight search is not configured. You can enter a fare manually.", 503, "not_configured")
        transport = current_app.config.get("IGNAV_HTTP", post_json)
        result = transport(endpoint, payload, key)
        if not isinstance(result, dict):
            raise ProviderError("The flight provider returned unreadable information. Try again later.")
        return result

    def search(self, query):
        endpoint = "round-trip" if query.get("return_date") else "one-way"
        result = self.request(endpoint, query)
        if not isinstance(result.get("itineraries"), list):
            raise ProviderError("The flight provider returned incomplete results. Try again later.")
        offers = [normalize_itinerary(item) for item in result["itineraries"]]
        offers = sorted((offer for offer in offers if offer and offer["offerId"]),
                        key=lambda offer: (offer["currency"], offer["amount"]))[:20]
        return {"offers": offers, "observedAt": text(result.get("observed_at")),
                "omittedCount": len(result["itineraries"]) - len(offers)}

    def booking(self, offer_id):
        return self.request("booking-links", {"ignav_id": offer_id})
````

## backend/fare_service.py

````python
"""Provider-independent fare caching, durable request budget and selection checks."""
import hashlib
import json
import time
from urllib.parse import urlsplit

from flask import current_app
from .ignav import IgnavProvider, normalize_itinerary
from .providers import ProviderError, cached, put_cache


def provider():
    # Another adapter only needs name, search(query) and booking(offer_id).
    adapters = {"ignav": IgnavProvider}
    selected = adapters.get(current_app.config.get("FLIGHT_PROVIDER", "ignav"))
    if not selected:
        raise ProviderError("The selected flight provider is unavailable. Enter a fare manually.")
    if not current_app.config.get("IGNAV_API_KEY"):
        raise ProviderError("Flight search is not configured. You can enter a fare manually.", 503, "not_configured")
    return selected()


def reserve_request(db):
    day = "ignav:" + time.strftime("%Y-%m-%d", time.gmtime())
    limit = int(current_app.config.get("IGNAV_DAILY_LIMIT", 20))
    db.execute("INSERT OR IGNORE INTO flight_api_usage VALUES (?, 0)", (day,))
    allowed = db.execute("UPDATE flight_api_usage SET count=count+1 WHERE period=? AND count<?",
                         (day, limit)).rowcount
    db.commit()
    if not allowed:
        raise ProviderError("Today's local flight-search allowance is used. Enter a fare manually or try tomorrow UTC.",
                            429, "local_flight_limit")


def with_cache(db, key, fetch, ttl):
    row = cached(db, key)
    if row and row["expires_at"] > time.time():
        data = json.loads(row["data"])
        if data.get("error"):
            raise ProviderError(data["error"], data["status"], data["code"])
        return {**data, "cached": True}
    reserve_request(db)
    try:
        data = fetch()
        data.update(checkedAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        put_cache(db, key, data, ttl)
        return {**data, "cached": False}
    except ProviderError as exc:
        put_cache(db, key, {"error": exc.message, "status": exc.status, "code": exc.code}, 60)
        raise


def search_fares(db, query):
    adapter = provider()
    # Include the account fingerprint so rotating keys cannot reuse another account's handoff IDs.
    account = hashlib.sha256(current_app.config["IGNAV_API_KEY"].encode()).hexdigest()[:16]
    identity = json.dumps([adapter.name, account, query], sort_keys=True)
    key = "fares:" + hashlib.sha256(identity.encode()).hexdigest()
    result = with_cache(db, key, lambda: {**adapter.search(query), "query": query,
                                        "source": adapter.name, "searchId": key}, 15 * 60)
    return result


def select_offer(db, search_id, offer_id):
    if not isinstance(search_id, str) or not search_id.startswith("fares:") or not isinstance(offer_id, str):
        raise ProviderError("Choose a fare from a current search.", 400, "invalid_selection")
    row = cached(db, search_id)
    if not row or row["expires_at"] <= time.time():
        raise ProviderError("That fare search expired. Search again for a current estimate.", 400, "expired_search")
    result = json.loads(row["data"])
    offer = next((item for item in result.get("offers", []) if item["offerId"] == offer_id), None)
    if not offer:
        raise ProviderError("That fare is not in this search. Search again.", 400, "invalid_selection")
    return {**offer, "query": result["query"], "source": result["source"],
            "observedAt": result["observedAt"], "checkedAt": result["checkedAt"]}


def booking_options(db, search_id, offer_id):
    select_offer(db, search_id, offer_id)
    adapter = provider()
    key = "booking:" + hashlib.sha256((search_id + offer_id).encode()).hexdigest()

    def fetch():
        raw = adapter.booking(offer_id)
        if not isinstance(raw.get("booking_options"), list):
            raise ProviderError("Booking options could not be read. Check the airline directly.")
        options = []
        for option in raw["booking_options"]:
            if not isinstance(option, dict):
                continue
            links = []
            for link in option.get("links", []) if isinstance(option.get("links"), list) else []:
                if not isinstance(link, dict) or not isinstance(link.get("url"), str):
                    continue
                url = link["url"]
                try:
                    parsed = urlsplit(url)
                    safe = parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password
                except ValueError:
                    safe = False
                if safe:
                    links.append({"url": url, "provider": str(link.get("provider_name", "Seller"))[:100],
                                  "specificity": link.get("specificity") if link.get("specificity") in
                                  ("exact_flight", "search_results") else "unspecified"})
            raw_legs = option.get("legs", [])
            legs = [item for item in raw_legs if item in ("outbound", "inbound")] if isinstance(raw_legs, list) else []
            if links:
                options.append({"legs": legs, "links": links})
        return {"options": options, "updatedQuote": normalize_itinerary(raw.get("itinerary"))}

    return with_cache(db, key, fetch, 5 * 60)
````

## backend/fare_routes.py

````python
"""User-initiated fare searches and saved estimates; quotes never create expenses."""
import json
import re
import uuid
from datetime import date

from flask import request
from .fare_service import search_fares, select_offer, booking_options


def register_fares(app, helpers):
    db, trip_row, body, error = (helpers[key] for key in ("get_db", "trip_row", "body_object", "ApiError"))

    @app.post("/api/trips/<trip_id>/fare-search")
    def search(trip_id):
        trip_row(trip_id)
        data = body()
        helpers["require_allowed"](data, {"origin", "destination", "departureDate", "returnDate", "nonstop"})
        query = {"market": "US", "adults": 1, "cabin_class": "economy"}
        for key in ("origin", "destination"):
            value = helpers["text_field"](data.get(key), key, maximum=3).upper()
            if not re.fullmatch(r"[A-Z]{3}", value):
                raise error("Use three-letter airport or city codes, such as DTW or PAR.")
            query[key] = value
        if query["origin"] == query["destination"]:
            raise error("Choose different departure and arrival locations.")
        query["departure_date"] = helpers["parse_date"](data.get("departureDate"), "Departure date")
        if query["departure_date"] < date.today().isoformat():
            raise error("Choose today or a future departure date for fare search. Past tickets can be entered manually.")
        if data.get("returnDate"):
            query["return_date"] = helpers["parse_date"](data["returnDate"], "Return date")
            if query["return_date"] < query["departure_date"]:
                raise error("Return date must be on or after departure.")
        if not isinstance(data.get("nonstop", False), bool):
            raise error("Nonstop must be true or false.")
        if data.get("nonstop"):
            query["max_stops"] = 0
        return search_fares(db(), query)

    @app.post("/api/trips/<trip_id>/fare-booking-links")
    def booking(trip_id):
        trip_row(trip_id)
        data = body()
        helpers["require_allowed"](data, {"searchId", "offerId"})
        return booking_options(db(), data.get("searchId"), data.get("offerId"))

    @app.get("/api/trips/<trip_id>/fare-quotes")
    def list_quotes(trip_id):
        trip_row(trip_id)
        rows = db().execute("SELECT * FROM fare_quotes WHERE trip_id=? ORDER BY created_at DESC", (trip_id,))
        return [json.loads(row["details"]) | {"id": row["id"]} for row in rows]

    @app.post("/api/trips/<trip_id>/fare-quotes")
    def save_quote(trip_id):
        trip_row(trip_id)
        data = body()
        helpers["require_allowed"](data, {"searchId", "offerId", "clientId"})
        client_id = helpers["text_field"](data.get("clientId"), "Submission id", maximum=100)
        prior = db().execute("SELECT * FROM fare_quotes WHERE trip_id=? AND client_id=?", (trip_id, client_id)).fetchone()
        if prior:
            return json.loads(prior["details"]) | {"id": prior["id"]}, 200
        details = select_offer(db(), data.get("searchId"), data.get("offerId"))
        quote_id, timestamp = str(uuid.uuid4()), helpers["now_iso"]()
        # Unique submission constraint + re-read makes concurrent retries idempotent.
        db().execute("INSERT OR IGNORE INTO fare_quotes VALUES (?,?,?,?,?)",
                     (quote_id, trip_id, client_id, json.dumps(details), timestamp))
        db().commit()
        row = db().execute("SELECT * FROM fare_quotes WHERE trip_id=? AND client_id=?", (trip_id, client_id)).fetchone()
        return json.loads(row["details"]) | {"id": row["id"]}, 201
````

## backend/tests/test_app.py

````python
"""Behavioral checks for CarryOn's persistent prototype API."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.app import create_app


def fixture_http(url):
    if "frankfurter" in url:
        return [{"quote": c, "rate": r, "date": "2026-11-06"} for c, r in (("EUR", .92), ("GBP", .79), ("JPY", 150), ("CAD", 1.36))]
    raise AssertionError("Unexpected network request")


class CarryOnApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self.temp.name) / "carryon.db")
        self.app = create_app({"TESTING": True, "DATABASE_PATH": self.db_path, "HTTP_FETCH": fixture_http})
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp.cleanup()

    def create_trip(self, **overrides):
        payload = {
            "name": "Test trip", "destination": "Paris", "budget": 100,
            "currency": "USD", "localCurrency": "EUR",
            "categoryBudgets": {"Food": 60, "Transit": 40},
            "overlookedCosts": [{"id": "insurance", "label": "Insurance", "estimate": 20, "checked": False}],
        }
        payload.update(overrides)
        response = self.client.post("/api/trips", json=payload)
        self.assertEqual(response.status_code, 201, response.json)
        return response.json

    def test_new_installation_is_empty_and_rates_are_sourced(self):
        self.assertEqual(self.client.get("/api/trips").json, [])
        rates = self.client.get("/api/rates").json
        self.assertEqual(rates["source"], "Frankfurter")
        self.assertEqual(rates["dates"]["EUR"], "2026-11-06")

    def test_trip_plan_survives_restart(self):
        trip = self.create_trip()
        trip_id = trip["id"]
        response = self.client.patch(f"/api/trips/{trip_id}", json={
            "budget": 120,
            "categoryBudgets": {"Food": 70, "Transit": 50},
            "overlookedCosts": [{"id": "insurance", "label": "Travel insurance", "estimate": 25, "checked": True}],
        })
        self.assertEqual(response.status_code, 200, response.json)
        restarted = create_app({"TESTING": True, "DATABASE_PATH": self.db_path, "HTTP_FETCH": fixture_http})
        saved = restarted.test_client().get(f"/api/trips/{trip_id}").json
        self.assertEqual(saved["budget"], 120.0)
        self.assertEqual(saved["categoryBudgets"], {"Food": 70.0, "Transit": 50.0})
        self.assertTrue(saved["overlookedCosts"][0]["checked"])
        self.assertEqual(saved["localCurrency"], "EUR")

    def test_foreign_expense_replay_edit_and_delete_update_balance_once(self):
        trip_id = self.create_trip()["id"]
        payload = {"clientId": "offline-uuid-1", "amount": 46, "currency": "EUR",
                   "category": "Food", "note": "Dinner", "date": "2026-11-10"}
        first = self.client.post(f"/api/trips/{trip_id}/expenses", json=payload)
        self.assertEqual(first.status_code, 201, first.json)
        self.assertEqual(first.json["amountBase"], 50.0)
        self.assertAlmostEqual(first.json["rate"], 1 / 0.92, places=7)
        replay = self.client.post(f"/api/trips/{trip_id}/expenses", json=payload)
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json["id"], first.json["id"])

        restarted = create_app({"TESTING": True, "DATABASE_PATH": self.db_path, "HTTP_FETCH": fixture_http})
        saved = restarted.test_client().get(f"/api/trips/{trip_id}").json
        self.assertEqual(saved["summary"]["spent"], 50.0)
        self.assertEqual(saved["summary"]["remaining"], 50.0)
        self.assertEqual(saved["summary"]["expenseCount"], 1)

        expense_id = first.json["id"]
        changed = self.client.patch(f"/api/expenses/{expense_id}", json={"amount": 23})
        self.assertEqual(changed.status_code, 200, changed.json)
        self.assertEqual(changed.json["amountBase"], 25.0)
        self.assertEqual(self.client.get(f"/api/trips/{trip_id}").json["summary"]["remaining"], 75.0)

        self.assertEqual(self.client.delete(f"/api/expenses/{expense_id}").status_code, 204)
        self.assertEqual(self.client.get(f"/api/trips/{trip_id}").json["summary"]["remaining"], 100.0)
        self.assertEqual(self.client.get(f"/api/trips/{trip_id}/expenses").json, [])
        replay_after_delete = self.client.post(f"/api/trips/{trip_id}/expenses", json=payload)
        self.assertEqual(replay_after_delete.status_code, 200)
        self.assertEqual(replay_after_delete.json["id"], expense_id)
        self.assertIn("deletedAt", replay_after_delete.json)
        self.assertEqual(self.client.get(f"/api/trips/{trip_id}").json["summary"]["spent"], 0.0)

    def test_validation_and_currency_lock(self):
        trip_id = self.create_trip()["id"]
        endpoint = f"/api/trips/{trip_id}/expenses"
        bad_amount = self.client.post(endpoint, json={"clientId": "a", "amount": -1})
        self.assertEqual(bad_amount.status_code, 400)
        bad_currency = self.client.post(endpoint, json={"clientId": "b", "amount": 2, "currency": "XYZ"})
        self.assertEqual(bad_currency.status_code, 400)
        bad_date = self.client.post(endpoint, json={"clientId": "c", "amount": 2, "date": "2026-13-02"})
        self.assertEqual(bad_date.status_code, 400)
        good = self.client.post(endpoint, json={"clientId": "d", "amount": 2})
        self.assertEqual(good.status_code, 201)
        locked = self.client.patch(f"/api/trips/{trip_id}", json={"currency": "EUR"})
        self.assertEqual(locked.status_code, 409)
        self.assertEqual(locked.json["error"]["code"], "currency_locked")
        self.assertEqual(self.client.get("/api/missing").status_code, 404)


if __name__ == "__main__":
    unittest.main()
````

## backend/tests/test_refinements.py

````python
"""Money, persistence and external-service failure tests; fixtures never enter production."""
import json
import tempfile
import time
import unittest
from pathlib import Path

from backend.app import create_app, connect_database
from backend.providers import ProviderError
from test_app import fixture_http


class RefinementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / "test.db")
        self.calls = []
        self.flight_response = {"flight_iata": "AA100", "dep_iata": "JFK", "arr_iata": "LHR",
                                "dep_time": "2026-11-08 18:00", "arr_time": "2026-11-09 06:00",
                                "status": "scheduled"}
        def transport(url):
            self.calls.append(url)
            if "frankfurter" in url:
                return fixture_http(url)
            return self.flight_response
        self.config = {"TESTING": True, "DATABASE_PATH": self.path,
                       "HTTP_FETCH": transport, "AIRLABS_API_KEY": "test-only"}
        self.app = create_app(self.config)
        self.client = self.app.test_client()
        self.trip = self.client.post("/api/trips", json={"name": "QA", "destination": "London",
            "budget": 1000, "currency": "USD", "localCurrency": "GBP",
            "startDate": "2026-11-08", "endDate": "2026-11-12"}).json

    def tearDown(self):
        self.temp.cleanup()

    def expense(self, category, client_id):
        return self.client.post("/api/trips/" + self.trip["id"] + "/expenses", json={
            "clientId": client_id, "amount": 10, "currency": "USD", "category": category})

    def test_custom_categories_reuse_case_unicode_and_survive_restart(self):
        self.assertEqual(self.expense("  Café   tours ", "one").json["category"], "Café tours")
        self.assertEqual(self.expense("CAFÉ tours", "two").json["category"], "Café tours")
        self.client.post("/api/categories", json={"name": "Ｆｏｏｄ"})
        restarted = create_app(self.config).test_client()
        self.assertEqual(restarted.get("/api/categories").json["custom"], ["Café tours"])
        expenses = restarted.get("/api/trips/" + self.trip["id"] + "/expenses").json
        self.assertEqual(len(expenses), 2)
        self.assertEqual(restarted.get("/api/trips/" + self.trip["id"]).json["summary"]["categorySpent"], {"Café tours": 20})

    def test_checklist_persists_and_rejects_unknown_or_nonboolean_items(self):
        url = "/api/trips/" + self.trip["id"]
        self.assertEqual(self.client.patch(url, json={"preparation": {"passport": True, "fees": False}}).status_code, 200)
        self.assertTrue(create_app(self.config).test_client().get(url).json["preparation"]["passport"])
        self.assertEqual(self.client.patch(url, json={"preparation": {"passport": "yes"}}).status_code, 400)
        self.assertEqual(self.client.patch(url, json={"preparation": {"invented": True}}).status_code, 400)

    def test_flight_fare_saved_atomically_and_replay_never_double_counts(self):
        url = "/api/trips/" + self.trip["id"] + "/flights"
        payload = {"clientId": "flight-one", "flightNumber": "AA100", "origin": "JFK", "destination": "LHR",
                   "departureDate": "2026-11-08", "fare": 200, "currency": "USD", "logExpense": True,
                   "paymentDate": "2026-11-01"}
        first = self.client.post(url, json=payload)
        self.assertEqual(first.status_code, 201, first.json)
        self.assertEqual(self.client.post(url, json=payload).status_code, 200)
        restarted = create_app(self.config).test_client()
        self.assertEqual(len(restarted.get(url).json), 1)
        saved = restarted.get("/api/trips/" + self.trip["id"]).json
        self.assertEqual(saved["summary"]["remaining"], 800)
        self.assertEqual(saved["summary"]["categorySpent"]["Flights"], 200)
        self.assertEqual(restarted.get("/api/trips/" + self.trip["id"] + "/expenses").json[0]["date"], "2026-11-01")
        self.client.patch("/api/expenses/" + first.json["expenseId"], json={"amount": 250})
        self.assertEqual(self.client.get(url).json[0]["fare"], 250)

    def test_lookup_is_cached_and_unconfigured_returns_useful_error(self):
        a = self.client.get("/api/flights/lookup?number=AA100")
        b = self.client.get("/api/flights/lookup?number=AA100")
        self.assertEqual(a.json, b.json)
        self.assertEqual(len(self.calls), 1)
        self.app.config["AIRLABS_API_KEY"] = ""
        unavailable = self.client.get("/api/flights/lookup?number=AA101")
        self.assertEqual(unavailable.status_code, 503)
        self.assertIn("manually", unavailable.json["error"]["message"])

    def test_quota_empty_results_downtime_and_secret_redaction(self):
        self.app.config["AIRLABS_MONTHLY_LIMIT"] = 1
        self.flight_response = {"error": {"code": "not_found"}}
        self.assertIsNone(self.client.get("/api/flights/lookup?number=AA100").json["flight"])
        limited = self.client.get("/api/flights/lookup?number=AA101")
        self.assertEqual(limited.status_code, 429)
        self.assertEqual(limited.headers["Retry-After"], "60")
        self.app.config["AIRLABS_MONTHLY_LIMIT"] = 10
        def down(url):
            raise ProviderError("The provider is unavailable.")
        self.app.config["HTTP_FETCH"] = down
        response = self.client.get("/api/flights/lookup?number=AA102")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("test-only", json.dumps(response.json))
        self.assertNotIn("api_key", json.dumps(response.json))
        self.assertEqual(self.client.get("/api/rates").json["rates"], {"USD": 1})

    def test_provider_selection_checks_date_and_route_before_saving(self):
        flight = self.client.get("/api/flights/lookup?number=AA100").json["flight"]
        payload = {key: flight[key] for key in ("flightNumber", "origin", "destination", "departureDate", "lookupId")}
        payload.update(clientId="linked", fare=0, currency="USD", logExpense=False)
        payload["departureDate"] = "2027-01-01"
        url = "/api/trips/" + self.trip["id"] + "/flights"
        self.assertEqual(self.client.post(url, json=payload).status_code, 400)
        payload["departureDate"] = flight["departureDate"]
        response = self.client.post(url, json=payload)
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual(response.json["source"], "AirLabs")
        self.assertEqual(self.client.get("/api/trips/" + self.trip["id"]).json["summary"]["spent"], 0)

    def test_stale_real_rates_have_an_expiry_and_never_invent_a_rate(self):
        self.client.get("/api/rates")
        db = connect_database(self.path)
        db.execute("UPDATE provider_cache SET expires_at=0")
        db.commit()
        self.app.config["HTTP_FETCH"] = lambda url: (_ for _ in ()).throw(ProviderError("Down"))
        self.assertTrue(self.client.get("/api/rates").json["stale"])
        db.execute("UPDATE provider_cache SET created_at=?", (time.time() - 8 * 86400,))
        db.commit(); db.close()
        unavailable = self.client.get("/api/rates").json
        self.assertTrue(unavailable["unavailable"])
        self.assertNotIn("EUR", unavailable["rates"])


if __name__ == "__main__":
    unittest.main()
````

## backend/tests/test_fares.py

````python
"""Fare contract/failure tests use fixtures only in temporary databases."""
import copy
import io
import json
import tempfile
import time
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from backend.app import create_app, connect_database
from backend.ignav import post_json
from backend.providers import ProviderError


class FareTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self.temp.name) / "fares.db")
        self.calls = []
        self.segment = {"marketing_carrier_code": "AA", "flight_number": "100",
                        "departure_airport": "JFK", "arrival_airport": "LHR",
                        "departure_time_local": "2027-01-08T18:00:00", "arrival_time_local": "2027-01-09T06:00:00"}
        self.offer = {"ignav_id": "fixture-only-offer", "price": {"amount": 299, "currency": "USD", "status": "verified"},
                      "outbound": {"carrier": "American Airlines", "segments": [self.segment]}, "cabin_class": "economy"}
        self.response = {"observed_at": "2026-11-08T12:00:00Z", "itineraries": [self.offer]}
        def transport(endpoint, payload, key):
            self.calls.append((endpoint, copy.deepcopy(payload)))
            return copy.deepcopy(self.response)
        self.config = {"TESTING": True, "DATABASE_PATH": self.db_path,
                       "IGNAV_API_KEY": "fixture-secret", "IGNAV_HTTP": transport}
        self.app = create_app(self.config)
        self.client = self.app.test_client()
        self.trip = self.client.post("/api/trips", json={"name": "QA", "destination": "London",
            "budget": 1000, "currency": "USD", "localCurrency": "GBP", "startDate": "2027-01-08", "endDate": "2027-01-15"}).json
        self.base = "/api/trips/" + self.trip["id"]
        self.query = {"origin": "JFK", "destination": "LHR", "departureDate": (date.today() + timedelta(days=30)).isoformat()}

    def tearDown(self):
        self.temp.cleanup()

    def search(self, **extra):
        return self.client.post(self.base + "/fare-search", json=self.query | extra)

    def test_contract_cache_and_durable_quotes_never_change_spending(self):
        first = self.search()
        self.assertEqual(first.status_code, 200, first.json)
        self.assertFalse(first.json["cached"])
        self.assertTrue(self.search().json["cached"])
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.calls[0][0], "one-way")
        self.assertNotIn("currency", self.calls[0][1])  # Market, not a fabricated currency parameter.
        selection = {"searchId": first.json["searchId"], "offerId": "fixture-only-offer", "clientId": "save-one"}
        saved = self.client.post(self.base + "/fare-quotes", json=selection)
        self.assertEqual(saved.status_code, 201, saved.json)
        self.assertEqual(self.client.post(self.base + "/fare-quotes", json=selection).status_code, 200)
        restarted = create_app(self.config).test_client()
        self.assertEqual(len(restarted.get(self.base + "/fare-quotes").json), 1)
        self.assertEqual(restarted.get(self.base).json["summary"]["spent"], 0)
        self.assertEqual(restarted.get(self.base + "/expenses").json, [])
        self.assertNotIn("fixture-secret", json.dumps(first.json))

    def test_validation_round_trip_and_unverified_prices(self):
        self.assertEqual(self.search(origin="JFK", destination="JFK").status_code, 400)
        self.assertEqual(self.search(departureDate="2000-01-01").status_code, 400)
        self.assertEqual(self.search(returnDate="2000-01-01").status_code, 400)
        self.assertEqual(self.search(nonstop="true").status_code, 400)
        self.assertEqual(self.calls, [])
        self.response["itineraries"][0]["inbound"] = copy.deepcopy(self.offer["outbound"])
        result = self.search(returnDate=self.query["departureDate"], nonstop=True)
        self.assertEqual(self.calls[0][0], "round-trip")
        self.assertEqual(self.calls[0][1]["max_stops"], 0)
        self.assertEqual(len(result.json["offers"][0]["legs"]), 2)
        self.response["itineraries"][0]["price"]["status"] = "unverified"
        self.assertEqual(self.search(destination="CDG").json["offers"], [])

    def test_empty_malformed_quota_and_missing_key(self):
        self.response["itineraries"] = []
        self.assertEqual(self.search().json["offers"], [])
        self.app.config["IGNAV_DAILY_LIMIT"] = 1
        limited = self.search(destination="CDG")
        self.assertEqual(limited.status_code, 429)
        self.assertEqual(len(self.calls), 1)
        self.assertTrue(self.search().json["cached"])  # Cached results consume no allowance.
        self.app.config["IGNAV_API_KEY"] = ""
        self.assertEqual(self.search().json["error"]["code"], "not_configured")

    def test_expired_or_forged_selection_cannot_be_saved(self):
        result = self.search().json
        data = {"searchId": result["searchId"], "offerId": "forged", "clientId": "one"}
        self.assertEqual(self.client.post(self.base + "/fare-quotes", json=data).status_code, 400)
        db = connect_database(self.db_path)
        db.execute("UPDATE provider_cache SET expires_at=0"); db.commit(); db.close()
        data["offerId"] = "fixture-only-offer"
        self.assertEqual(self.client.post(self.base + "/fare-quotes", json=data).status_code, 400)

    def test_booking_coverage_secure_links_and_cache(self):
        result = self.search().json
        self.response = {"itinerary": self.offer, "booking_options": [
            {"legs": ["outbound"], "links": [
                {"url": "javascript:alert(1)", "provider_name": "Bad"},
                {"url": "https://example.com/ticket", "provider_name": "Fixture seller", "specificity": "search_results"}]}]}
        selection = {"searchId": result["searchId"], "offerId": "fixture-only-offer"}
        booking = self.client.post(self.base + "/fare-booking-links", json=selection)
        self.assertEqual(booking.status_code, 200, booking.json)
        self.assertEqual(booking.json["options"][0]["legs"], ["outbound"])
        self.assertEqual(len(booking.json["options"][0]["links"]), 1)
        self.client.post(self.base + "/fare-booking-links", json=selection)
        self.assertEqual(len(self.calls), 2)

    def test_failure_cooldown_and_transport_redacts_provider_body(self):
        def unavailable(*args):
            raise ProviderError("Flight search is unavailable.")
        self.app.config["IGNAV_HTTP"] = unavailable
        self.assertEqual(self.search().status_code, 503)
        self.app.config["IGNAV_HTTP"] = lambda *args: self.fail("Cooldown should prevent another call")
        self.assertEqual(self.search().status_code, 503)
        for status in (400, 401, 402, 403, 404, 429, 503):
            error = HTTPError("https://ignav.com/api/fares/one-way", status, "failed", {},
                              io.BytesIO(b'{"error":{"message":"fixture-secret"}}'))
            with patch("backend.ignav.urlopen", side_effect=error):
                with self.assertRaises(ProviderError) as caught:
                    post_json("one-way", {}, "fixture-secret")
                self.assertNotIn("fixture-secret", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
````

## frontend/public/sw.js

````javascript
const CACHE = 'carryon-shell-v6';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    // Vite names the JS and CSS files with content hashes. Cache the assets
    // named by the built page during installation so one online visit is enough.
    const index = await cache.match('/index.html');
    const html = await index.text();
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map((match) => match[1]);
    await cache.addAll(assets);
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('carryon-shell-') && key !== CACHE).map((key) => caches.delete(key)))),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put('/index.html', copy));
      }
      return response;
    }).catch(async () => (await caches.match('/index.html')) || Response.error()));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});
````

## frontend/src/App.jsx

````jsx
import React, { useEffect, useRef, useState } from 'react';
import Icon from './components/Icons';
import Today from './components/Today';
import Expenses from './components/Expenses';
import Plan from './components/Plan';
import TripForm from './components/TripForm';
import ExpenseForm from './components/ExpenseForm';
import useCarryOn from './hooks/useCarryOn';
import { timing } from './lib';

export default function App() {
  const data = useCarryOn();
  const [tab, setTab] = useState(() => ['today', 'expenses', 'plan'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today');
  const [newTrip, setNewTrip] = useState(false), [expenseModal, setExpenseModal] = useState(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const headingRef = useRef(null), first = useRef(true);
  function navigate(next) { setTab(next); location.hash = next; window.scrollTo({ top: 0 }); }
  function openNewTrip() { setNewTrip(true); navigate('plan'); }
  useEffect(() => {
    const changed = () => { const next = location.hash.slice(1); if (['today', 'expenses', 'plan'].includes(next)) setTab(next); };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const heading = headingRef.current?.querySelector('h1');
    heading?.setAttribute('tabindex', '-1'); heading?.focus();
  }, [tab, newTrip, data.trip?.id]);
  const showNew = !data.loading && (!data.trip || newTrip) && (tab === 'plan' || !data.trip);
  const section = !data.trip ? 'plan' : tab;
  const activeTab = showNew ? 'plan' : tab;
  return <div className={'app-shell section-' + section}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="site-header"><div className="header-inner">
      <a className="brand" href="#today" aria-label="CarryOn home" onClick={() => { setNewTrip(false); navigate('today'); }}><Icon name="plane" size={24}/><span>carryon<span className="brand-dot">.</span></span></a>
      <div className="header-actions"><label className="trip-select-label"><span className="sr-only">Current trip</span><select value={showNew ? '__new' : data.trip?.id || '__new'} onChange={(e) => { if (e.target.value === '__new') openNewTrip(); else { setNewTrip(false); data.selectTrip(e.target.value); } }}>
        {data.trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.destination}</option>)}<option value="__new">+ New trip</option>
      </select></label><button className="icon-button" aria-label="Connection information" aria-expanded={statusOpen} aria-controls="connection-panel" onClick={() => setStatusOpen(!statusOpen)}><Icon name="bell"/></button></div></div></header>
    {statusOpen && <div className="alerts-panel" id="connection-panel"><strong>{data.online ? 'Connected to CarryOn' : 'Offline or server unavailable'}</strong><span>Saved expenses and trips remain on this device. Flight status is a snapshot checked when you request a lookup.</span><button className="button outline" onClick={() => setStatusOpen(false)}>Close</button></div>}
    <main className="content" id="main-content" ref={headingRef} tabIndex="-1">
      {!data.online && <div className="offline-banner" role="status">Offline or server unavailable · new expenses stay on this device</div>}
      {data.message && <div className="status-banner" role="status"><span>{data.message}</span><button className="icon-button" onClick={() => data.setMessage('')} aria-label="Dismiss message"><Icon name="close" size={16}/></button></div>}
      {data.rates.unavailable && data.trip && <p className="rate-note">Exchange-rate service unavailable. Home-currency expenses still work.</p>}
      {data.rates.stale && <p className="rate-note">Using cached exchange rates. Check the rate date before recording a foreign-currency expense.</p>}
      {data.loading && !data.trip ? <section className="intro" role="status"><h1>Loading your trips…</h1></section> : showNew ?
        <TripForm onCreate={async (payload) => { await data.createTrip(payload); setNewTrip(false); navigate('plan'); }} onCancel={data.trip ? () => setNewTrip(false) : undefined}/> :
        data.trip && <>
          {tab === 'today' && <Today {...data} onAdd={() => setExpenseModal({})} onEdit={setExpenseModal} onViewExpenses={() => navigate('expenses')}/>}
          {tab === 'expenses' && <Expenses {...data} onAdd={() => setExpenseModal({})} onEdit={setExpenseModal} onPlan={() => { setNewTrip(false); navigate('plan'); }}/>}
          {tab === 'plan' && <Plan key={data.trip.id} {...data} onSave={data.savePlan} onNewTrip={openNewTrip} onRefresh={data.refresh}/>}
        </>}
      {data.trip && <p className="sr-only">Selected trip: {data.trip.name}. {timing(data.trip).phase}.</p>}
    </main>
    <nav className="bottom-nav" aria-label="Main navigation"><div className="nav-inner">{[['today', 'Today', 'today'], ['expenses', 'Expenses', 'expenses'], ['plan', 'Plan', 'edit']].map(([id, label, icon]) => <button key={id} className={(activeTab === id ? 'active ' : '') + 'nav-' + id} onClick={() => { setNewTrip(false); navigate(id); }} aria-current={activeTab === id ? 'page' : undefined}><Icon name={icon}/><span>{label}</span></button>)}</div></nav>
    {expenseModal && data.trip && <ExpenseForm trip={data.trip} categories={data.categories} rates={data.rates} expense={expenseModal.id ? expenseModal : undefined} onSave={data.saveExpense} onClose={() => setExpenseModal(null)}/>}
  </div>;
}
````

## frontend/src/components/ExpenseForm.jsx

````jsx
import React, { useState } from 'react';
import Modal from './Modal';
import Icon from './Icons';
import { CATEGORIES, CURRENCIES, estimate, localDate, money, positiveAmount } from '../lib';
export default function ExpenseForm({ trip, rates, categories, expense, onClose, onSave }) {
  const choices = Array.from(new Set([...CATEGORIES, ...categories]));
  const [form, setForm] = useState({ amount: expense?.amount ?? '', currency: expense?.currency || trip.localCurrency,
    category: expense?.category || 'Food', note: expense?.note || '', date: expense?.date || localDate(), custom: '' });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const amount = Number(String(form.amount).replace(',', '.'));
  const home = estimate(amount, form.currency, trip.currency, rates);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  async function submit(event) {
    event.preventDefault(); setError('');
    if (!positiveAmount(form.amount)) { setError('Enter a positive amount with up to two decimal places.'); return; }
    if (home === null) { setError('No exchange rate is available. Try later or enter your actual home-currency charge.'); return; }
    const category = form.category === 'Other' ? form.custom.trim().replace(/\s+/g, ' ') : form.category;
    if (!category) { setError('Give your custom category a name.'); return; }
    setBusy(true);
    try { await onSave({ amount, currency: form.currency, category, note: form.note.trim(), date: form.date }, expense); onClose(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  const rateDate = rates.dates?.[form.currency === 'USD' ? trip.currency : form.currency];
  return <Modal title={expense ? 'Edit expense' : 'Add an expense'} onClose={onClose}><form onSubmit={submit}>
    <label className="field-label" htmlFor="expense-amount">Amount</label>
    <div className="amount-field"><select aria-label="Expense currency" value={form.currency} onChange={(e) => update('currency', e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
      <input id="expense-amount" type="text" inputMode="decimal" required pattern="(?:[0-9]+(?:[.,][0-9]{1,2})?|[.,][0-9]{1,2})" maxLength="16" value={form.amount} onChange={(e) => update('amount', e.target.value)} placeholder="0.00" aria-describedby="conversion-help" data-initial-focus autoFocus /></div>
    <p id="conversion-help" className="field-help" aria-live="polite">{home === null ? 'Exchange rate unavailable. Choose your home currency or try again later.' : 'About ' + money(home, trip.currency) + ' in your home currency.'} {form.currency !== trip.currency && home !== null && <>Frankfurter reference rate{rateDate ? ' dated ' + rateDate : ''}{rates.stale ? ' (cached)' : ''}. Your bank may charge a different rate or fees.</>}</p>
    <label className="field-label" htmlFor="expense-note">What was it for? <span className="optional">(optional)</span></label>
    <input id="expense-note" className="text-input" maxLength="200" value={form.note} onChange={(e) => update('note', e.target.value)} placeholder="Coffee near the station" />
    <label className="field-label" htmlFor="expense-category">Category</label>
    <select id="expense-category" className="text-input" value={form.category} onChange={(e) => update('category', e.target.value)}>{choices.filter((c) => c !== 'Other').map((c) => <option key={c}>{c}</option>)}<option value="Other">Other — add a category</option></select>
    {form.category === 'Other' && <><label className="field-label" htmlFor="custom-category">Custom category name</label><input id="custom-category" className="text-input" value={form.custom} onChange={(e) => update('custom', e.target.value)} maxLength="40" required aria-describedby="custom-help"/><p id="custom-help" className="field-help">Saved categories will be available on future expenses. Names ignore capitalization.</p></>}
    <label className="field-label" htmlFor="expense-date">Date</label><input id="expense-date" className="text-input" type="date" required value={form.date} onChange={(e) => update('date', e.target.value)}/>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button primary full" disabled={busy}>{busy ? 'Saving…' : expense ? 'Save changes' : 'Save expense'} <Icon name="arrow"/></button>
  </form></Modal>;
}
````

## frontend/src/components/ExpenseRow.jsx

````jsx
import React from 'react';
import Icon from './Icons';
import { money, shortDate } from '../lib';
export default function ExpenseRow({ expense, homeCurrency, onEdit }) {
  return <div className="expense-row"><div className="expense-mark" aria-hidden="true">{expense.category.slice(0, 1)}</div>
    <div className="expense-main"><strong>{expense.note || expense.category}</strong><span>{expense.category} · {shortDate(expense.date)}{expense.pending ? ' · Waiting to sync' : ''}</span></div>
    <div className="expense-amount"><strong>{money(expense.amountBase, homeCurrency)}</strong><span>{expense.currency !== homeCurrency ? money(expense.amount, expense.currency) : homeCurrency}</span></div>
    <button className="icon-button row-edit" onClick={() => onEdit(expense)} aria-label={'Edit ' + (expense.note || expense.category)}><Icon name="edit" size={16}/></button>
  </div>;
}
````

## frontend/src/components/Expenses.jsx

````jsx
import React from 'react';
import Icon from './Icons';
import ExpenseRow from './ExpenseRow';
import SpendingCharts from './SpendingCharts';
import { CategoryBudgets, DailySpending } from './TravelerInsights';
import { money, timing, PREPARATION } from '../lib';
export default function Expenses({ trip, expenses, summary, onAdd, onEdit, onPlan }) {
  const checked = PREPARATION.filter(([id]) => trip.preparation?.[id]).length;
  return <><section className="intro"><span className="eyebrow">Every little thing</span><h1>Expenses</h1><p>See where your money is going, in one place.</p></section>
    <section className="expenses-total"><span className="eyebrow">Total spent</span><h2>{money(summary.spent, trip.currency)}</h2><p>{expenses.length} expenses logged · {timing(trip).phase}</p></section>
    <div className="section-heading"><h2>By category</h2></div><SpendingCharts expenses={expenses} currency={trip.currency}/>
    <DailySpending trip={trip} expenses={expenses}/><CategoryBudgets trip={trip} expenses={expenses}/>
    <div className="preparation-summary"><span>Before you go: {checked} of {PREPARATION.length} checks complete</span><button className="text-link" onClick={onPlan}>Review on Plan <Icon name="arrow" size={16}/></button></div>
    <div className="section-heading"><h2>All expenses</h2><button className="text-link" onClick={onAdd}><Icon name="plus" size={17}/> Add</button></div>
    <section className="list-card">{expenses.length ? expenses.map((expense) => <ExpenseRow key={expense.clientId} expense={expense} homeCurrency={trip.currency} onEdit={onEdit}/>) : <p className="empty-list">No expenses yet. Add your first purchase.</p>}</section>
    <p className="field-help">Each expense shows its saved home-currency value and original currency amount. Converted values are reference estimates; your bank statement is the final charge.</p>
  </>;
}
````

## frontend/src/components/FareOffer.jsx

````jsx
import React from 'react';
import { estimate, money } from '../lib';

export default function FareOffer({ offer, trip, rates, children }) {
  const home = estimate(offer.amount, offer.currency, trip.currency, rates);
  const budget = Number(trip.categoryBudgets.Flights || trip.categoryBudgets.Transit || 0);
  return <article className="saved-flight fare-offer">
    <h4>From {money(offer.amount, offer.currency)} · {offer.legs.length > 1 ? 'round trip' : 'one way'}</h4>
    <p>1 adult · economy · total itinerary estimate</p>
    {offer.legs.map((leg) => <div key={leg.direction} className="fare-leg">
      <strong>{leg.direction === 'inbound' ? 'Return' : 'Outbound'}{leg.carrier ? ' · ' + leg.carrier : ''}</strong>
      <p>{leg.segments.length === 1 ? 'Nonstop' : (leg.segments.length - 1) + ' stop(s)'}</p>
      <ul>{leg.segments.map((segment, index) => <li key={index}>
        {segment.marketing_carrier_code}{segment.flight_number} · {segment.departure_airport} → {segment.arrival_airport}<br/>
        {segment.departure_time_local.replace('T', ' ')} → {segment.arrival_time_local.replace('T', ' ')} (each airport’s local time)
      </li>)}</ul>
    </div>)}
    <p>{home === null ? 'Home-currency estimate unavailable.' : 'About ' + money(home, trip.currency) +
      (budget ? ' · ' + (home / budget * 100).toFixed(1) + '% of your ' + (trip.categoryBudgets.Flights ? 'Flights' : 'Transit') + ' budget.' : ' in your home currency.')}</p>
    <p className="field-help">Source: {offer.source || 'Ignav'} · Retrieved {offer.observedAt || 'time not supplied'}. Prices can change; confirm baggage, fees and the final total with the seller.</p>
    {children}
  </article>;
}
````

## frontend/src/components/FlightFareSearch.jsx

````jsx
import React, { useEffect, useRef, useState } from 'react';
import FareOffer from './FareOffer';
import { api, localDate, money } from '../lib';

export default function FlightFareSearch({ trip, rates }) {
  const path = '/api/trips/' + trip.id;
  const [form, setForm] = useState({ origin: '', destination: '', departureDate: trip.startDate < localDate() ? '' : trip.startDate, returnDate: '', nonstop: false });
  const [result, setResult] = useState(null), [saved, setSaved] = useState([]), [bookings, setBookings] = useState({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const ids = useRef({});
  async function load() { setSaved(await api(path + '/fare-quotes')); }
  useEffect(() => { load().catch((e) => setError(e.message)); }, [path]);
  const change = (key, value) => { setForm((f) => ({ ...f, [key]: value })); setResult(null); setBookings({}); setMessage(''); setError(''); };
  async function search(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage(''); setResult(null); setBookings({});
    try {
      const data = await api(path + '/fare-search', { method: 'POST', body: JSON.stringify(form) });
      setResult(data);
      setMessage(data.offers.length ? data.offers.length + ' fare estimates found.' : 'No verified fare estimates were returned. Try another route or date, or enter a fare from the airline manually.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function select(offer, action) {
    setBusy(true); setError(''); setMessage('');
    const selection = { searchId: result.searchId, offerId: offer.offerId };
    try {
      if (action === 'save') {
        const identity = result.searchId + ':' + offer.offerId;
        ids.current[identity] ||= crypto.randomUUID();
        await api(path + '/fare-quotes', { method: 'POST', body: JSON.stringify({ ...selection, clientId: ids.current[identity] }) });
        await load(); setMessage('Estimate saved. Your spending and budget have not changed. Record a ticket below only after paying.');
      } else {
        const data = await api(path + '/fare-booking-links', { method: 'POST', body: JSON.stringify(selection) });
        setBookings((previous) => ({ ...previous, [offer.offerId]: data }));
        setMessage(data.options.length ? 'Booking options ready. Confirm the total on the seller’s website.' : 'No secure booking links were returned. Check the airline directly.');
      }
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <section className="fare-search" aria-labelledby="fare-search-heading" aria-busy={busy}>
    <h3 id="fare-search-heading">Find a flight estimate</h3>
    <p className="card-description">Compare fares with your plan before buying. Searches are for one adult in economy, priced in the US market. Returned currencies are shown explicitly.</p>
    <form onSubmit={search}><fieldset disabled={busy} className="fare-fields"><legend className="sr-only">Flight search</legend>
      <div className="field-grid">{[['origin', 'From airport or city'], ['destination', 'To airport or city']].map(([key, label]) => <div key={key}>
        <label className="field-label" htmlFor={'fare-' + key}>{label}</label><input id={'fare-' + key} className="text-input" value={form[key]} required pattern="[A-Za-z]{3}" maxLength="3" placeholder={key === 'origin' ? 'DTW' : 'PAR'} aria-describedby="fare-airport-help" onChange={(e) => change(key, e.target.value.toUpperCase())}/>
      </div>)}</div><p id="fare-airport-help" className="field-help">Use a three-letter airport or city code: DTW (Detroit), CDG (Paris airport), PAR (all Paris airports), LON (London).</p>
      <div className="field-grid"><div><label className="field-label" htmlFor="fare-departure">Departure</label><input className="text-input" id="fare-departure" type="date" required min={localDate()} value={form.departureDate} onChange={(e) => change('departureDate', e.target.value)}/></div>
        <div><label className="field-label" htmlFor="fare-return">Return (optional)</label><input className="text-input" id="fare-return" type="date" min={form.departureDate || localDate()} value={form.returnDate} onChange={(e) => change('returnDate', e.target.value)}/></div></div>
      <label className="check-option"><input type="checkbox" checked={form.nonstop} onChange={(e) => change('nonstop', e.target.checked)}/>Nonstop only</label>
      <button className="button primary full">{busy ? 'Working…' : 'Search fares'}</button>
    </fieldset></form>
    <p className="field-help">Searches can take up to a minute. Estimates are cached for 15 minutes; Ignav may reuse results for up to 30 minutes. No automatic searches or price alerts run.</p>
    <div role="status" aria-live="polite">{busy ? 'Contacting the flight provider…' : message}</div>
    {error && <p role="alert" className="form-error">{error}</p>}
    {result && <div><p className="field-help">{result.cached ? 'Cached search' : 'Search completed'} · checked {result.checkedAt}. {result.omittedCount > 0 ? 'Unverified or additional fares were omitted; showing up to 20 verified results.' : ''}</p>
      {result.offers.map((offer) => <FareOffer key={offer.offerId} offer={{ ...offer, source: result.source, observedAt: result.observedAt }} trip={trip} rates={rates}>
        <div className="fare-actions"><button className="button outline" disabled={busy} onClick={() => select(offer, 'save')}>Save estimate</button><button className="button outline" disabled={busy} onClick={() => select(offer, 'book')}>Check booking options</button></div>
        {bookings[offer.offerId] && <div className="booking-options"><p>Choose one seller from each purchase below to cover the trip. Separate purchases may have different conditions.</p>
          {bookings[offer.offerId].updatedQuote && <p>Latest provider estimate: {money(bookings[offer.offerId].updatedQuote.amount, bookings[offer.offerId].updatedQuote.currency)}. It may differ from your saved estimate.</p>}
          {bookings[offer.offerId].options.map((option, index) => <div key={index}><strong>Purchase {index + 1}: {option.legs.join(' + ') || 'check coverage with seller'}</strong><ul>{option.links.map((link) => <li key={link.url}><a href={link.url} target="_blank" rel="noopener noreferrer">{link.provider} (opens new tab)</a>{link.specificity === 'search_results' ? ' · select your flight again' : ' · confirm flight and fare'}</li>)}</ul></div>)}
        </div>}
      </FareOffer>)}
    </div>}
    {saved.length > 0 && <details className="saved-fare-quotes"><summary>Saved fare estimates ({saved.length})</summary><p className="field-help">Historical snapshots, not tickets or current offers. These amounts are not deducted from your budget. Search again for current availability.</p>
      {saved.map((offer) => <FareOffer key={offer.id} offer={offer} trip={trip} rates={rates}/>)}</details>}
  </section>;
}
````

## frontend/src/components/FlightPanel.jsx

````jsx
import React, { useEffect, useState } from 'react';
import SavedFlights from './SavedFlights';
import FlightFareSearch from './FlightFareSearch';
import { api, CURRENCIES, estimate, money, localDate } from '../lib';
export default function FlightPanel({ trip, rates, onSaved }) {
  const [flights, setFlights] = useState([]), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [searched, setSearched] = useState(false);
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState({ flightNumber: '', departureDate: '', origin: '', destination: '', fare: '', currency: trip.currency, logExpense: false });
  const [lookup, setLookup] = useState(null);
  const change = (key, value) => { setForm((f) => ({ ...f, [key]: value })); if (['flightNumber', 'origin', 'destination', 'departureDate'].includes(key)) setLookup(null); };
  async function load() { const rows = await api('/api/trips/' + trip.id + '/flights'); setFlights(rows); }
  useEffect(() => { load().catch((e) => setError(e.message)); }, [trip.id]);
  async function search() {
    setBusy(true); setError(''); setMessage(''); setSearched(false); setLookup(null);
    try {
      const result = await api('/api/flights/lookup?number=' + encodeURIComponent(form.flightNumber));
      setSearched(true);
      if (!result.flight) { setMessage('No current flight found. Future dates may not be available. Enter details from your ticket.'); return; }
      const flight = result.flight;
      setForm((f) => ({ ...f, flightNumber: flight.flightNumber, origin: flight.origin, destination: flight.destination, departureDate: flight.departureDate }));
      setLookup(flight.lookupId);
      setMessage('Flight found. Confirm the route and date match your ticket. This is the closest scheduled/live flight, not a future-date search.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function submit(event) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      await api('/api/trips/' + trip.id + '/flights', { method: 'POST', body: JSON.stringify({ ...form, fare: Number(form.fare), clientId: submissionId, lookupId: lookup, paymentDate: localDate() }) });
      await load(); await onSaved(); setSubmissionId(crypto.randomUUID());
      setMessage(form.logExpense ? 'Flight saved and actual fare recorded once as a Flights expense.' : 'Flight saved. No expense was recorded.');
      setForm({ flightNumber: '', departureDate: '', origin: '', destination: '', fare: '', currency: trip.currency, logExpense: false }); setLookup(null);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const home = estimate(form.fare, form.currency, trip.currency, rates);
  const planned = Number(trip.categoryBudgets.Flights || trip.categoryBudgets.Transit || 0);
  return <details className="flight-panel"><summary>Flights · fare search and tickets</summary><div className="flight-body">
    <FlightFareSearch trip={trip} rates={rates}/>
    <h3>Add a ticket you purchased</h3><SavedFlights flights={flights} currency={trip.currency}/>
    <p className="card-description">Enter your actual ticket details below. Optional current-status lookup uses AirLabs and needs a separate server key. Fare search above uses Ignav. CarryOn does not sell or book tickets.</p>
    <form onSubmit={submit}><label className="field-label" htmlFor="flight-number">Flight code on your ticket</label><div className="lookup-row"><input id="flight-number" className="text-input" placeholder="e.g. AA100" required maxLength="10" value={form.flightNumber} onChange={(e) => change('flightNumber', e.target.value.toUpperCase().replace(/\s/g, ''))}/><button type="button" className="button outline" disabled={busy || !form.flightNumber.trim()} onClick={search}>{busy ? 'Working…' : 'Look up'}</button></div>
      <div className="field-grid">{[['origin', 'Departure airport'], ['destination', 'Arrival airport']].map(([key, label]) => <div key={key}><label className="field-label" htmlFor={'flight-' + key}>{label}</label><input id={'flight-' + key} className="text-input" required pattern="[A-Za-z]{3}" maxLength="3" value={form[key]} onChange={(e) => change(key, e.target.value.toUpperCase())} aria-describedby="airport-help"/></div>)}</div><p id="airport-help" className="field-help">Three-letter airport codes, such as DTW or CDG. Some free lookup fields may be unavailable.</p>
      <label className="field-label" htmlFor="flight-date">Departure date (airport local date)</label><input id="flight-date" className="text-input" type="date" required value={form.departureDate} onChange={(e) => change('departureDate', e.target.value)}/>
      <div className="field-grid"><div><label className="field-label" htmlFor="flight-fare">Fare from your ticket</label><input id="flight-fare" className="text-input" type="number" min={form.logExpense ? '.01' : '0'} step=".01" required value={form.fare} onChange={(e) => change('fare', e.target.value)}/></div><div><label className="field-label" htmlFor="flight-currency">Fare currency</label><select id="flight-currency" className="text-input" value={form.currency} onChange={(e) => change('currency', e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div></div>
      {Number(form.fare) > 0 && <p className="field-help" aria-live="polite">{home === null ? 'Home-currency estimate unavailable.' : money(home, trip.currency) + ' estimated · ' + (planned ? (home / planned * 100).toFixed(1) + '% of your ' + (trip.categoryBudgets.Flights ? 'Flights' : 'Transit') + ' budget.' : 'Set a Flights budget to compare this cost.')} This compares with your plan, not typical market fares.</p>}
      <label className="check-option"><input type="checkbox" checked={form.logExpense} onChange={(e) => change('logExpense', e.target.checked)}/>I paid this fare. Record it once as a Flights expense today.</label>
      {lookup && <button type="button" className="text-link" onClick={() => setLookup(null)}>Save as my ticket details instead of provider information</button>}
      {message && <p role="status" className="save-message success">{message}</p>}{error && <p role="alert" className="form-error">{error}</p>}{searched && !lookup && <p className="field-help">Manual ticket details can still be saved.</p>}
      <button className="button primary full" disabled={busy}>{busy ? 'Working…' : 'Save flight'}</button>
    </form><p className="field-help">Status is a saved snapshot, not an airline guarantee. Check your airline for current travel information.</p></div></details>;
}
````

## frontend/src/components/Icons.jsx

````jsx
import React from 'react';
export default function Icon({ name, size = 21 }) {
  const paths = {
    today: <><path d="M3 11 12 4l9 7v10H3Z"/><path d="M9 21v-7h6v7"/></>,
    expenses: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
    edit: <><path d="m4 17 13-13 3 3L7 20H4v-3Z"/><path d="m15 6 3 3"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
    close: <path d="M5 5 19 19M19 5 5 19"/>,
    plane: <><path d="m2 10 20-8-8 20-4-8Z"/><path d="m10 14 12-12"/></>,
    check: <path d="m4 12 5 5L20 6"/>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9ZM10 21h4"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
````

## frontend/src/components/Modal.jsx

````jsx
import React, { useEffect, useRef } from 'react';
import Icon from './Icons';
export default function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current, previous = document.activeElement;
    dialog.showModal();
    dialog.querySelector('[data-initial-focus]')?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { dialog.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  function containFocus(event) {
    if (event.key !== 'Tab') return;
    const controls = Array.from(ref.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter((el) => el.getClientRects().length);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return <dialog ref={ref} className="modal" aria-labelledby="modal-title" onKeyDown={containFocus} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="modal-head"><h2 id="modal-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close form"><Icon name="close"/></button></div>
    {children}
  </dialog>;
}
````

## frontend/src/components/Plan.jsx

````jsx
import React, { useState } from 'react';
import Icon from './Icons';
import FlightPanel from './FlightPanel';
import { PreparationChecklist } from './TravelerInsights';
import { CATEGORIES, EXTRA_COSTS, money } from '../lib';
export default function Plan({ trip, summary, categories, rates, onSave, onNewTrip, onRefresh }) {
  const [budget, setBudget] = useState(String(trip.budget)), [limits, setLimits] = useState({ ...trip.categoryBudgets });
  const [extras, setExtras] = useState(trip.overlookedCosts?.length ? trip.overlookedCosts : EXTRA_COSTS);
  const [preparation, setPreparation] = useState(trip.preparation || {});
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const allocated = Object.values(limits).reduce((s, v) => s + Number(v || 0), 0);
  const extraTotal = extras.filter((r) => r.checked).reduce((s, r) => s + Number(r.estimate || 0), 0);
  const choices = Array.from(new Set([...CATEGORIES.filter((c) => c !== 'Other'), ...categories, ...Object.keys(limits), 'Buffer']));
  async function submit(event) {
    event.preventDefault(); setError(''); setMessage(''); setBusy(true);
    try { await onSave({ budget: Number(budget), categoryBudgets: limits, overlookedCosts: extras, preparation }); setMessage('Plan and checklist saved.'); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <><section className="intro"><h1>Your plan</h1></section>
    <section className="plan-total"><div><span className="eyebrow">Trip budget</span><h2>{money(budget, trip.currency)}</h2><p>{money(summary.remaining, trip.currency)} currently available</p></div><button className="button outline small" onClick={onNewTrip}><Icon name="plus" size={17}/> New trip</button></section>
    <form onSubmit={submit}><div className="section-heading"><h2>Budget by category</h2></div>
      <section className="plan-card"><label className="field-label" htmlFor="total-budget">Total budget ({trip.currency})</label><div className="dollar-input"><span>{trip.currency}</span><input id="total-budget" type="number" min=".01" step=".01" required value={budget} onChange={(e) => setBudget(e.target.value)}/></div>
        <div className="category-list">{choices.map((category) => <label className="category-budget" key={category}><span>{category === 'Buffer' ? 'Buffer / just in case' : category}</span><div className="dollar-input compact"><span>{trip.currency}</span><input type="number" min="0" step=".01" aria-label={category + ' budget'} value={limits[category] ?? ''} onChange={(e) => setLimits((current) => ({ ...current, [category]: e.target.value || 0 }))}/></div></label>)}</div>
        <div className={'allocation ' + (allocated > Number(budget) ? 'over' : '')}><span>Allocated across categories</span><strong>{money(allocated, trip.currency)} / {money(budget, trip.currency)}</strong></div>
        {allocated > Number(budget) && <p className="form-error">Category allocations exceed your total budget.</p>}
      </section><div className="section-heading"><h2>Extra trip costs</h2></div>
      <section className="plan-card"><p className="card-description">Enter your own estimates for costs that are easy to miss. No costs are assumed.</p>{extras.map((item, index) => <div className="extra-row" key={item.id}><label><input type="checkbox" checked={item.checked} onChange={(e) => setExtras((rows) => rows.map((r, i) => i === index ? { ...r, checked: e.target.checked } : r))}/><span>{item.label}</span></label><div className="dollar-input compact"><span>{trip.currency}</span><input type="number" min="0" step=".01" aria-label={item.label + ' estimate'} value={item.estimate} onChange={(e) => setExtras((rows) => rows.map((r, i) => i === index ? { ...r, estimate: e.target.value || 0 } : r))}/></div></div>)}
        <div className="allocation"><span>Potential extra costs</span><strong>{money(extraTotal, trip.currency)}</strong></div><p className="field-help">These are planning reminders. Include them in your category budgets; they are not deducted from your balance until recorded as expenses.</p></section>
      <PreparationChecklist value={preparation} onChange={setPreparation}/>
      {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="save-message success" role="status">{message}</p>}
      <button className="button primary full plan-save" disabled={busy}>{busy ? 'Saving…' : 'Save plan'} <Icon name="arrow"/></button>
    </form><FlightPanel key={trip.id} trip={trip} rates={rates} onSaved={onRefresh}/>
  </>;
}
````

## frontend/src/components/SavedFlights.jsx

````jsx
import React from 'react';
import { money } from '../lib';
export default function SavedFlights({ flights, currency }) {
  return <div aria-live="polite">{flights.length ? flights.map((flight) => <article className="saved-flight" key={flight.id}>
    <h3>{flight.flightNumber} · {flight.origin} → {flight.destination}</h3><p>{flight.departureDate}{flight.departureTime ? ' · ' + flight.departureTime + ' (departure airport local time)' : ''}</p>
    <p>Status: {flight.status}. Source: {flight.source}{flight.checkedAt ? ' · Last checked ' + flight.checkedAt : ''}.</p>
    <p>Fare entered: {money(flight.fare, flight.currency)}. {flight.expenseId ? 'Recorded in Flights expenses.' : 'Itinerary only; not deducted from your ' + currency + ' budget.'}</p>
  </article>) : <p className="field-help">No flights saved yet. Add ticket details below, or look up a current flight.</p>}</div>;
}
````

## frontend/src/components/SpendingCharts.jsx

````jsx
import React from 'react';
import { byCategory, money } from '../lib';
// Dark variants of the Okabe–Ito hues; labels/percentages carry the meaning too.
export const CHART_COLORS = ['#00689D', '#A84400', '#00745A', '#894970', '#806100', '#286A7A'];
export function chartGroups(expenses) {
  const rows = byCategory(expenses), total = rows.reduce((s, r) => s + r.total, 0);
  const large = [], small = [];
  rows.forEach((row) => (row.category !== 'Other' && row.total / total >= .03 && large.length < 5 ? large : small).push(row));
  if (small.length) large.push({ category: 'Other', total: small.reduce((s, r) => s + r.total, 0), members: small.map((r) => r.category) });
  return { rows: large, total };
}
export default function SpendingCharts({ expenses, currency }) {
  const { rows, total } = chartGroups(expenses);
  let offset = 0;
  if (!rows.length) return <p className="empty-list">Add an expense to see your spending distribution.</p>;
  return <div className="chart-grid">
    <section className="category-summary" aria-labelledby="bar-title"><h3 id="bar-title">Category totals</h3>{rows.map((row, index) => <div className="summary-row" key={row.category}><span>{index + 1}. {row.category}</span><div className="summary-bar" aria-hidden="true"><i style={{ width: (row.total / total * 100) + '%', background: CHART_COLORS[index] }}/></div><strong>{money(row.total, currency)}</strong></div>)}</section>
    <figure className="donut-card"><figcaption>Share of total spending</figcaption>
      <svg viewBox="0 0 140 140" className="category-donut" role="img" aria-labelledby="donut-title donut-desc"><title id="donut-title">Spending by category</title><desc id="donut-desc">Category amounts and percentages are listed immediately below this chart.</desc>{rows.map((row, index) => {
        const percent = row.total / total * 100, gap = Math.min(.5, percent * .1), start = offset; offset += percent;
        return <circle key={row.category} cx="70" cy="70" r="48" fill="none" pathLength="100" stroke={CHART_COLORS[index]} strokeWidth="21" strokeDasharray={(percent - gap) + ' ' + (100 - percent + gap)} strokeDashoffset={-start} transform="rotate(-90 70 70)"/>;
      })}<text x="70" y="72" textAnchor="middle" className="donut-total">100%</text><text x="70" y="88" textAnchor="middle" className="donut-caption">of logged spending</text></svg>
      <ol className="chart-legend">{rows.map((row, i) => <li key={row.category}><span className="legend-swatch" style={{ background: CHART_COLORS[i] }} aria-hidden="true"/><span>{i + 1}. {row.category}</span><strong>{(row.total / total * 100).toFixed(1)}%</strong></li>)}</ol>
      {rows.some((r) => r.members) && <details><summary>What’s grouped in Other?</summary><p>Categories below 3% and categories beyond the five largest are combined: {rows.find((r) => r.members).members.join(', ')}. Their individual amounts remain in your expense history and category budgets.</p></details>}
    </figure>
  </div>;
}
````

## frontend/src/components/Today.jsx

````jsx
import React, { useState } from 'react';
import Icon from './Icons';
import ExpenseRow from './ExpenseRow';
import { DailySpending } from './TravelerInsights';
import { money, timing, shortDate } from '../lib';
export default function Today({ trip, expenses, summary, onAdd, onEdit, onViewExpenses }) {
  const [whatIf, setWhatIf] = useState('');
  const time = timing(trip), projected = summary.remaining - (Number(whatIf) || 0);
  const percent = Math.min(100, Math.max(0, summary.percentUsed));
  const recent = [...expenses].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return <>
    <section className="intro"><h1>Hey, Ashley</h1><p>Here’s where you stand on your {trip.destination} trip.</p><p className="trip-phase">{time.phase}</p></section>
    <section className="budget-card" aria-labelledby="budget-heading"><div className="budget-card-top"><span className="eyebrow">Available to spend</span><span className="small-tag">{shortDate(trip.startDate)}–{shortDate(trip.endDate)}</span></div>
      <div className="budget-hero"><div><h2 id="budget-heading">{money(summary.remaining, trip.currency)}</h2><p>left of {money(trip.budget, trip.currency)} budget</p></div><div className="donut" style={{ '--percent': percent + '%' }} role="img" aria-label={Math.round(summary.percentUsed) + ' percent of budget spent'}><div><strong>{Math.round(summary.percentUsed)}%</strong><span>spent</span></div></div></div>
      <div className="budget-guidance"><Icon name="check" size={19}/><span>{summary.remaining < 0 ? money(-summary.remaining, trip.currency) + ' over budget. Review your plan.' : time.remaining ? 'About ' + money(summary.remaining / time.remaining, trip.currency) + ' per remaining trip day.' : 'Trip complete. ' + money(summary.remaining, trip.currency) + ' remains.'}</span></div>
    </section>
    <button className="add-expense-card" onClick={onAdd}><span className="plus-square"><Icon name="plus"/></span><span><strong>Add an expense</strong><small>Keep your budget up to date</small></span><Icon name="arrow"/></button>
    <DailySpending trip={trip} expenses={expenses}/>
    <section className="impact-card"><span className="eyebrow">Before you buy</span><h2>Can I afford an extra plan?</h2><p>Try a possible purchase to see what would remain.</p><label className="field-label" htmlFor="what-if">Possible purchase ({trip.currency})</label><div className="impact-input"><span>{trip.currency}</span><input id="what-if" type="number" inputMode="decimal" min="0" step=".01" value={whatIf} onChange={(e) => setWhatIf(e.target.value)} placeholder="0.00"/></div>
      {Number(whatIf) > 0 && <div className={'impact-result ' + (projected < 0 ? 'negative' : '')} aria-live="polite"><strong>{projected < 0 ? money(-projected, trip.currency) + ' over budget' : money(projected, trip.currency) + ' would remain'}</strong><span>{time.remaining ? money(projected / time.remaining, trip.currency) + ' per remaining trip day after this purchase.' : 'Your trip has ended.'}</span></div>}
    </section>
    <div className="section-heading"><h2>Recent expenses</h2><button className="text-link" onClick={onViewExpenses}>See all <Icon name="arrow" size={16}/></button></div>
    <section className="list-card">{recent.length ? recent.slice(0, 3).map((expense) => <ExpenseRow key={expense.clientId} expense={expense} homeCurrency={trip.currency} onEdit={onEdit}/>) : <p className="empty-list">No expenses yet. Add one to see your balance change.</p>}</section>
  </>;
}
````

## frontend/src/components/TravelerInsights.jsx

````jsx
import React from 'react';
import { localDate, money, timing, byCategory, PREPARATION } from '../lib';
export function DailySpending({ trip, expenses }) {
  const time = timing(trip), spent = expenses.filter((e) => e.date === localDate()).reduce((sum, e) => sum + Number(e.amountBase), 0);
  const target = trip.budget / time.total, left = target - spent;
  return <section aria-labelledby="daily-heading"><div className="section-heading"><h2 id="daily-heading">Daily spending</h2></div>
    <div className="daily-grid"><div className="metric-card"><span className="eyebrow">Spent today</span><strong>{money(spent, trip.currency)}</strong><small>{localDate()} · {trip.currency}</small></div>
      <div className="metric-card"><span className="eyebrow">Daily budget</span><strong>{money(target, trip.currency)}</strong><small>Total budget ÷ {time.total} trip days</small></div></div>
    {time.active ? <p className={'pace-note ' + (left < 0 ? 'over' : '')}>{left < 0 ? 'Over today’s target by ' + money(-left, trip.currency) : money(left, trip.currency) + ' left against today’s target'}. Prepaid flights and lodging are included, so use this as a guide.</p> : <p className="field-help">{time.phase}. Daily pace applies during your trip; expenses entered today are still shown.</p>}
  </section>;
}
export function CategoryBudgets({ trip, expenses }) {
  const totals = byCategory(expenses);
  const categories = Array.from(new Set([...Object.keys(trip.categoryBudgets), ...totals.map((r) => r.category)])).filter((c) => c !== 'Buffer');
  return <section className="plan-card" aria-labelledby="category-budget-heading"><h2 id="category-budget-heading">Category budgets remaining</h2>
    {categories.length ? categories.map((category) => {
      const planned = Number(trip.categoryBudgets[category] || 0), spent = totals.find((r) => r.category === category)?.total || 0;
      const remaining = planned - spent;
      return <div className="category-progress" key={category}><div><strong>{category}</strong><span>{planned ? (remaining < 0 ? money(-remaining, trip.currency) + ' over' : money(remaining, trip.currency) + ' left') : 'No budget set'}</span></div>
        {planned > 0 && <progress value={Math.min(spent, planned)} max={planned} aria-label={category + ': ' + money(spent, trip.currency) + ' spent of ' + money(planned, trip.currency)}/>}
        <small>{money(spent, trip.currency)} spent{planned > 0 ? ' / ' + money(planned, trip.currency) + ' planned' : ''}</small></div>;
    }) : <p className="field-help">Set category budgets on Plan to see what remains.</p>}
  </section>;
}
export function PreparationChecklist({ value, onChange }) {
  return <section className="plan-card" aria-labelledby="preparation-heading"><h2 id="preparation-heading">Before you go</h2><p className="card-description">General reminders. Requirements depend on your nationality, destination, and dates.</p>
    <div className="preparation-list">{PREPARATION.map(([id, label, hint]) => <label key={id}><input type="checkbox" checked={Boolean(value[id])} onChange={(e) => onChange({ ...value, [id]: e.target.checked })}/><span><strong>{label}</strong><small>{hint}</small></span></label>)}</div>
    <p className="field-help">Use Save plan to keep your checklist. Checking an item does not record an expense.</p>
  </section>;
}
````

## frontend/src/components/TripForm.jsx

````jsx
import React, { useState } from 'react';
import Icon from './Icons';
import { CURRENCIES, positiveAmount } from '../lib';
export default function TripForm({ onCreate, onCancel }) {
  const [form, setForm] = useState({ name: '', destination: '', startDate: '', endDate: '', budget: '', currency: 'USD', localCurrency: 'EUR' });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  async function submit(event) {
    event.preventDefault(); setError('');
    if (!positiveAmount(form.budget)) { setError('Enter a budget greater than zero with up to two decimal places.'); return; }
    if (form.endDate < form.startDate) { setError('The end date must be on or after the start date.'); return; }
    setBusy(true);
    try { await onCreate({ ...form, budget: Number(form.budget) }); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <section aria-labelledby="new-trip-heading"><div className="intro"><h1 id="new-trip-heading" tabIndex="-1">Add new trip</h1></div>
    <form className="plan-card" onSubmit={submit}>
      <label className="field-label" htmlFor="trip-name">Trip name</label><input id="trip-name" className="text-input" maxLength="100" required value={form.name} onChange={(e) => update('name', e.target.value)}/>
      <label className="field-label" htmlFor="trip-destination">Destination</label><input id="trip-destination" className="text-input" maxLength="100" required value={form.destination} onChange={(e) => update('destination', e.target.value)}/>
      <div className="field-grid">{[['startDate', 'Start date'], ['endDate', 'End date']].map(([key, label]) => <div key={key}><label className="field-label" htmlFor={key}>{label}</label><input id={key} className="text-input" type="date" required min={key === 'endDate' ? form.startDate : undefined} value={form[key]} onChange={(e) => update(key, e.target.value)}/></div>)}</div>
      <label className="field-label" htmlFor="trip-budget">Total budget (USD)</label><input id="trip-budget" className="text-input" type="number" min="0.01" step="0.01" required value={form.budget} onChange={(e) => update('budget', e.target.value)}/>
      <label className="field-label" htmlFor="trip-local">Local currency</label><select id="trip-local" className="text-input" value={form.localCurrency} onChange={(e) => update('localCurrency', e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button className="button primary" disabled={busy}>{busy ? 'Creating…' : 'Create trip'} <Icon name="plus"/></button>{onCancel && <button className="button outline" type="button" onClick={onCancel}>Cancel</button>}</div>
    </form></section>;
}
````

## frontend/src/hooks/useCarryOn.js

````javascript
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, EMPTY_RATES, estimate, readSaved, save } from '../lib';

export default function useCarryOn() {
  const [trips, setTrips] = useState(() => readSaved('trips', []));
  const [selectedId, setSelectedId] = useState(() => readSaved('selected', ''));
  const [expensesByTrip, setExpensesByTrip] = useState(() => readSaved('expenses', {}));
  const [queue, setQueue] = useState(() => readSaved('queue', []));
  const [rates, setRates] = useState(() => readSaved('rates', EMPTY_RATES));
  const [categories, setCategories] = useState(() => readSaved('categories', []));
  const [online, setOnline] = useState(navigator.onLine), [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const syncing = useRef(false);
  const trip = trips.find((row) => row.id === selectedId) || trips[0];
  const refreshExpenses = useCallback(async (id) => {
    const rows = await api('/api/trips/' + id + '/expenses');
    setExpensesByTrip((current) => { const next = { ...current, [id]: rows }; save('expenses', next); return next; });
    return rows;
  }, []);
  const refresh = useCallback(async () => {
    try {
      const [rows, fx, cats] = await Promise.all([api('/api/trips'), api('/api/rates'), api('/api/categories')]);
      setTrips(rows); save('trips', rows); setRates(fx); save('rates', fx); setCategories(cats.custom); save('categories', cats.custom);
      const id = readSaved('selected', '');
      const active = rows.find((row) => row.id === id)?.id || rows[0]?.id;
      if (active) { setSelectedId(active); save('selected', active); await refreshExpenses(active); }
      setOnline(true);
    } catch (error) { setOnline(false); setMessage('Could not reach the server. Saved information is available on this device.'); }
    finally { setLoading(false); }
  }, [refreshExpenses]);
  const syncQueue = useCallback(async () => {
    if (syncing.current || !navigator.onLine) return;
    const pending = readSaved('queue', []);
    if (!pending.length) return;
    syncing.current = true;
    const done = [];
    try {
      for (const item of pending) {
        await api('/api/trips/' + item.tripId + '/expenses', { method: 'POST', body: JSON.stringify(item.payload) });
        done.push(item.payload.clientId);
      }
      setMessage('Expenses saved and synced.');
    } catch (error) {
      setMessage(error.status && error.status < 500 ? 'An expense needs attention: ' + error.message + ' Open it to edit.' : 'Saved on this device. Sync will retry when the server is available.');
    } finally {
      await refresh();
      const remaining = readSaved('queue', []).filter((item) => !done.includes(item.payload.clientId));
      save('queue', remaining); setQueue(remaining); syncing.current = false;
    }
  }, [refresh]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const connected = () => { setOnline(true); refresh(); syncQueue(); };
    const disconnected = () => setOnline(false);
    window.addEventListener('online', connected); window.addEventListener('offline', disconnected);
    return () => { window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected); };
  }, [refresh, syncQueue]);
  useEffect(() => {
    syncQueue();
    const timer = setInterval(syncQueue, 30000);
    return () => clearInterval(timer);
  }, [syncQueue]);
  const expenses = useMemo(() => {
    if (!trip) return [];
    const saved = expensesByTrip[trip.id] || [], ids = new Set(saved.map((row) => row.clientId));
    const pending = queue.filter((row) => row.tripId === trip.id && !ids.has(row.payload.clientId)).map((row) => ({
      ...row.payload, id: 'pending-' + row.payload.clientId, amountBase: row.amountBase,
      pending: true, createdAt: row.createdAt,
    }));
    return [...pending, ...saved];
  }, [trip, expensesByTrip, queue]);
  const summary = useMemo(() => {
    const spent = expenses.reduce((s, row) => s + Number(row.amountBase), 0), budget = Number(trip?.budget || 0);
    return { spent, remaining: budget - spent, percentUsed: budget ? spent / budget * 100 : 0 };
  }, [expenses, trip]);
  async function selectTrip(id) {
    setSelectedId(id); save('selected', id);
    try { await refreshExpenses(id); } catch { setMessage('Showing the last saved expenses for this trip.'); }
  }
  async function saveExpense(payload, original) {
    if (original && !original.pending) {
      await api('/api/expenses/' + original.id, { method: 'PATCH', body: JSON.stringify(payload) });
      await refresh(); setMessage('Expense updated.'); return;
    }
    const amountBase = estimate(payload.amount, payload.currency, trip.currency, rates);
    if (amountBase === null) throw new Error('An exchange rate is unavailable for this currency.');
    const clientId = original?.clientId || crypto.randomUUID();
    const next = readSaved('queue', []).filter((row) => row.payload.clientId !== clientId);
    next.push({ tripId: trip.id, payload: { ...payload, clientId }, amountBase, createdAt: new Date().toISOString() });
    save('queue', next); setQueue(next);
    setCategories((current) => Array.from(new Set([...current, payload.category])));
    setMessage('Expense saved on this device. Foreign-currency estimates may change when synced.');
    await syncQueue();
  }
  async function savePlan(payload) {
    const updated = await api('/api/trips/' + trip.id, { method: 'PATCH', body: JSON.stringify(payload) });
    setTrips((rows) => { const next = rows.map((row) => row.id === updated.id ? updated : row); save('trips', next); return next; });
  }
  async function createTrip(payload) {
    const created = await api('/api/trips', { method: 'POST', body: JSON.stringify(payload) });
    save('selected', created.id); setSelectedId(created.id); await refresh(); return created;
  }
  const categoryChoices = Array.from(new Set([...categories, ...queue.map((item) => item.payload.category)]));
  return { trips, trip, expenses, summary, categories: categoryChoices, rates, online, loading, message, setMessage,
    selectTrip, saveExpense, savePlan, createTrip, refresh };
}
````

## frontend/src/lib.js

````javascript
export const CATEGORIES = ['Stay', 'Transit', 'Flights', 'Food', 'Activities', 'Shopping', 'Other'];
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'NZD'];
export const EMPTY_RATES = { base: 'USD', rates: { USD: 1 }, dates: {}, unavailable: true };
export const EXTRA_COSTS = ['Passport renewal', 'Visa or entry fees', 'Travel insurance', 'Airport transfer', 'SIM / eSIM', 'Foreign transaction fees', 'Baggage fees', 'Emergency cushion'].map((label, i) => ({ id: 'extra-' + i, label, checked: false, estimate: 0 }));
export const PREPARATION = [
  ['passport', 'Passport validity checked', 'Check the destination’s validity and blank-page rules.'],
  ['visa', 'Entry / visa requirements checked', 'Use the destination government’s official website for your nationality.'],
  ['insurance', 'Travel insurance reviewed', 'Check medical cover, exclusions, and your existing policy.'],
  ['sim', 'SIM / eSIM planned', 'Check phone compatibility and roaming costs.'],
  ['fees', 'Card and ATM fees checked', 'Ask your bank about foreign transaction and cash withdrawal fees.'],
  ['baggage', 'Baggage allowance checked', 'Confirm the allowance and extra charges with your airline.'],
];
export function readSaved(key, fallback) {
  try { return JSON.parse(localStorage.getItem('carryon:v2:' + key)) ?? fallback; } catch { return fallback; }
}
export function save(key, value) { localStorage.setItem('carryon:v2:' + key, JSON.stringify(value)); }
export function localDate() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
export function money(amount, currency = 'USD', digits = 2) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(amount) || 0);
}
export function shortDate(value) { return value ? new Date(value + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; }
export function dayNumber(value) { return value ? Date.parse(value + 'T00:00:00Z') / 86400000 : null; }
export function timing(trip, today = localDate()) {
  const start = dayNumber(trip.startDate), end = dayNumber(trip.endDate), now = dayNumber(today);
  if (start === null || end === null) return { total: 1, remaining: 1, phase: 'Add trip dates on Plan', active: false };
  const total = Math.max(1, end - start + 1);
  return { total, remaining: now > end ? 0 : now < start ? total : end - now + 1,
    phase: now < start ? (start - now) + ' days until departure' : now > end ? 'Trip completed' : 'Day ' + (now - start + 1) + ' of ' + total,
    active: now >= start && now <= end };
}
export function estimate(amount, currency, home, rates) {
  if (currency === home) return Number(amount);
  return rates.rates?.[currency] && rates.rates?.[home] ? Number(amount) * rates.rates[home] / rates.rates[currency] : null;
}
export function positiveAmount(value) { return /^(?:\d+(?:[.,]\d{1,2})?|[.,]\d{1,2})$/.test(String(value)) && Number(String(value).replace(',', '.')) > 0; }
export async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error?.message || body.message || 'Something went wrong. Please try again.');
    error.status = response.status; throw error;
  }
  return body;
}
export function byCategory(expenses) {
  const totals = new Map();
  expenses.forEach((row) => totals.set(row.category, (totals.get(row.category) || 0) + Number(row.amountBase || 0)));
  return Array.from(totals, ([category, total]) => ({ category, total })).filter((row) => row.total > 0).sort((a, b) => b.total - a.total);
}
````

## frontend/src/main.jsx

````jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}
````

## frontend/src/styles.css

````css
:root { font-family: 'DM Sans', Arial, sans-serif; color: #171717; background: #f7f7f5; font-synthesis: none; text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; }
* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; }
button, input, select { font: inherit; }
button { cursor: pointer; }
button:disabled { cursor: not-allowed; opacity: .48; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.app-shell { min-height: 100vh; padding-bottom: 94px; }
.site-header { background: #fff; border-bottom: 2px solid #171717; position: sticky; top: 0; z-index: 20; }
.header-inner { max-width: 780px; min-height: 69px; padding: 0 22px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.brand { display: flex; align-items: center; gap: 7px; font-size: 25px; line-height: 1; font-weight: 800; letter-spacing: -.065em; white-space: nowrap; }
.brand-dot { color: #7a7a7a; }
.header-actions { display: flex; align-items: center; gap: 7px; }
.trip-select-label { position: relative; }
.trip-select-label::after { content: '⌄'; position: absolute; right: 12px; top: 8px; pointer-events: none; font-size: 16px; font-weight: 800; }
.trip-select-label select { appearance: none; border: 1.7px solid #171717; background: #fff; border-radius: 5px; font-size: 12px; font-weight: 800; max-width: 160px; padding: 9px 28px 9px 12px; text-overflow: ellipsis; }
.icon-button { width: 38px; height: 38px; display: inline-grid; place-items: center; border: 0; background: transparent; color: inherit; border-radius: 4px; }
.icon-button:hover, .icon-button:focus-visible { background: #ebebe8; }
.bell { position: relative; }
.bell::after { content: ''; width: 5px; height: 5px; border-radius: 50%; background: #171717; position: absolute; top: 5px; right: 6px; }
.alerts-panel { position: fixed; z-index: 30; top: 64px; right: max(20px, calc((100vw - 760px) / 2)); display: grid; gap: 5px; background: #fff; border: 2px solid #171717; box-shadow: 5px 5px 0 #171717; padding: 18px 20px; width: min(300px, calc(100vw - 40px)); font-size: 13px; }
.alerts-panel span { color: #555; }
.content { max-width: 780px; margin: 0 auto; padding: 27px 22px 45px; }
.eyebrow { display: block; color: #505050; font-size: 10px; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; }
.intro { margin: 6px 0 25px; }
.intro h1 { font-size: clamp(31px, 6vw, 43px); letter-spacing: -.055em; line-height: 1.03; margin: 9px 0 8px; font-weight: 800; }
.intro p { color: #555; font-size: 14px; margin: 0; line-height: 1.5; }
.wave { font-size: .63em; vertical-align: 6px; margin-left: 3px; }
.budget-card { color: #fff; background: #171717; border: 2px solid #171717; border-radius: 6px; padding: 22px 23px 0; overflow: hidden; }
.budget-card .eyebrow { color: #cfcfcf; }
.budget-card-top { display: flex; align-items: center; justify-content: space-between; gap: 15px; }
.small-tag { font-size: 10px; font-weight: 700; border: 1px solid #a7a7a7; border-radius: 3px; padding: 5px 8px; white-space: nowrap; }
.budget-hero { display: flex; align-items: center; justify-content: space-between; gap: 18px; min-height: 150px; }
.budget-hero h2 { font-size: clamp(43px, 10vw, 62px); line-height: 1; letter-spacing: -.07em; margin: 3px 0 9px; }
.budget-hero p { color: #c9c9c9; margin: 0; font-size: 13px; }
.donut { width: 106px; aspect-ratio: 1; flex: 0 0 auto; border-radius: 50%; background: conic-gradient(#fff var(--percent), #636363 var(--percent)); display: grid; place-items: center; }
.donut > div { width: 76px; aspect-ratio: 1; border-radius: 50%; background: #171717; display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.05; }
.donut strong { font-size: 21px; }
.donut span { color: #c9c9c9; font-size: 10px; margin-top: 4px; }
.budget-guidance { background: #292929; margin: 0 -23px; padding: 14px 23px; display: flex; align-items: center; gap: 10px; color: #e4e4e4; font-size: 12px; line-height: 1.45; }
.budget-guidance strong { color: #fff; }
.guidance-dot { display: inline-block; width: 8px; height: 8px; background: #fff; border-radius: 50%; flex: 0 0 auto; }
.add-expense-card { width: 100%; display: flex; align-items: center; gap: 14px; text-align: left; padding: 16px; margin: 16px 0 29px; border: 2px solid #171717; border-radius: 5px; background: #fff; box-shadow: 4px 4px 0 #171717; transition: transform .15s, box-shadow .15s; }
.add-expense-card:hover { transform: translate(2px,2px); box-shadow: 2px 2px 0 #171717; }
.add-expense-card > span:nth-child(2) { flex: 1; display: grid; gap: 3px; }
.add-expense-card strong { font-size: 15px; }
.add-expense-card small { font-size: 11px; color: #666; }
.plus-square { display: grid; place-items: center; background: #171717; color: #fff; width: 42px; height: 42px; border-radius: 3px; }
.section-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin: 27px 0 12px; }
.section-heading h2, .impact-card h2 { margin: 5px 0 0; font-size: 20px; line-height: 1.1; letter-spacing: -.035em; }
.daily-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.metric-card { display: grid; align-content: start; gap: 7px; background: #fff; border: 1.7px solid #171717; border-radius: 4px; padding: 18px; min-height: 128px; }
.metric-card strong { font-size: clamp(22px, 5vw, 28px); line-height: 1; letter-spacing: -.05em; }
.metric-card small { font-size: 11px; color: #666; }
.impact-card { background: #f0f0ed; border: 1.7px solid #171717; border-radius: 4px; padding: 19px; margin-top: 26px; }
.impact-card p { color: #555; font-size: 12px; margin: 8px 0 14px; }
.impact-input { background: #fff; border: 1.6px solid #171717; border-radius: 3px; display: flex; align-items: center; padding: 0 14px; font-weight: 800; }
.impact-input input { width: 100%; height: 42px; border: 0; outline: 0; padding: 0 8px; background: transparent; font-size: 14px; }
.impact-result { display: grid; gap: 3px; margin-top: 12px; padding: 11px 12px; background: #fff; border-left: 4px solid #171717; font-size: 12px; }
.impact-result strong { font-size: 14px; }
.impact-result span { color: #555; }
.impact-result.negative { border-left-color: #bd4b3c; }
.text-link { display: inline-flex; align-items: center; gap: 4px; border: 0; background: none; font-size: 11px; font-weight: 800; text-decoration: underline; padding: 4px; white-space: nowrap; }
.list-card, .category-summary { background: #fff; border: 1.7px solid #171717; border-radius: 4px; padding: 0 16px; }
.expense-row { display: flex; align-items: center; gap: 11px; min-height: 72px; padding: 10px 0; border-bottom: 1px solid #dededb; }
.expense-row:last-child { border-bottom: 0; }
.expense-mark { display: grid; place-items: center; width: 35px; height: 35px; background: #eeeeeb; border: 1px solid #171717; border-radius: 3px; font-weight: 800; font-size: 15px; flex: 0 0 auto; }
.expense-main { display: grid; gap: 3px; min-width: 0; flex: 1; }
.expense-main strong, .expense-main span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.expense-main strong { font-size: 12px; }
.expense-main span { color: #666; font-size: 10px; }
.expense-amount { display: grid; text-align: right; gap: 2px; white-space: nowrap; }
.expense-amount strong { font-size: 12px; }
.expense-amount span { color: #666; font-size: 10px; }
.row-edit { width: 28px; height: 28px; flex: 0 0 auto; }
.empty-list { color: #666; font-size: 12px; padding: 22px 4px; }
.rate-note { margin: 12px 0 0; color: #777; font-size: 10px; }
.bottom-nav { position: fixed; bottom: 0; left: 0; right: 0; z-index: 20; background: #fff; border-top: 2px solid #171717; }
.nav-inner { max-width: 780px; margin: 0 auto; display: grid; grid-template-columns: repeat(3, 1fr); }
.nav-inner button { height: 67px; display: grid; align-content: center; justify-items: center; gap: 3px; border: 0; border-top: 3px solid transparent; background: #fff; color: #6a6a6a; font-size: 10px; font-weight: 800; }
.nav-inner button.active { color: #171717; border-top-color: #171717; }
.nav-inner button:hover { background: #f2f2f0; }
.plan-total, .expenses-total { display: flex; align-items: center; justify-content: space-between; gap: 15px; background: #171717; color: #fff; border: 2px solid #171717; border-radius: 5px; padding: 22px; }
.plan-total .eyebrow, .expenses-total .eyebrow { color: #bbb; }
.plan-total h2, .expenses-total h2 { font-size: 36px; letter-spacing: -.06em; margin: 8px 0 4px; line-height: 1; }
.plan-total p, .expenses-total p { color: #c9c9c9; margin: 0; font-size: 11px; }
.button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 42px; padding: 10px 15px; border: 2px solid #171717; border-radius: 3px; font-size: 12px; font-weight: 800; }
.button.primary { color: #fff; background: #171717; }
.button.primary:hover { background: #333; }
.button.outline { color: #171717; background: #fff; }
.button.outline:hover { background: #f0f0ed; }
.button.small { min-height: 36px; padding: 7px 10px; font-size: 10px; }
.button.full { width: 100%; justify-content: space-between; margin-top: 20px; }
.plan-card { background: #fff; border: 1.7px solid #171717; border-radius: 4px; padding: 18px; }
.field-label { display: block; font-size: 11px; font-weight: 800; margin: 16px 0 7px; }
.field-label:first-child { margin-top: 0; }
.text-input { width: 100%; height: 43px; border: 1.5px solid #171717; border-radius: 3px; background: #fff; padding: 0 12px; color: #171717; font-size: 13px; }
.dollar-input { height: 42px; display: flex; align-items: center; border: 1.5px solid #171717; border-radius: 3px; padding: 0 10px; font-size: 13px; font-weight: 800; }
.dollar-input input { width: 100%; height: 100%; border: 0; background: transparent; outline: 0; padding: 0 0 0 3px; text-align: right; font-weight: 700; }
.dollar-input.compact { width: 110px; height: 36px; flex: 0 0 auto; }
.category-list { margin-top: 13px; border-top: 1px solid #dededb; }
.category-budget, .extra-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 11px 0; border-bottom: 1px solid #e4e4e1; font-size: 12px; font-weight: 700; }
.category-budget:last-child, .extra-row:last-child { border-bottom: 0; }
.allocation { display: flex; justify-content: space-between; gap: 10px; border-top: 1.7px solid #171717; margin-top: 7px; padding-top: 14px; font-size: 11px; }
.allocation.over strong { color: #ad3d31; }
.card-description { color: #555; font-size: 12px; line-height: 1.45; margin: 0 0 10px; }
.extra-row label { display: flex; align-items: center; gap: 9px; }
.extra-row input[type="checkbox"] { appearance: none; width: 18px; height: 18px; border: 1.5px solid #171717; border-radius: 2px; flex: 0 0 auto; margin: 0; }
.extra-row input[type="checkbox"]:checked { background: #171717; box-shadow: inset 0 0 0 3px #fff; }
.field-help { color: #777; font-size: 10px; line-height: 1.4; margin: 8px 0 0; }
.save-message { font-size: 11px; padding: 11px 12px; background: #fff2ed; border: 1px solid #b75843; margin: 15px 0 0; }
.save-message.success { background: #e9f0e7; border-color: #567a50; }
.plan-save { margin-top: 16px; }
.expenses-total { display: block; }
.summary-row { display: grid; grid-template-columns: 90px 1fr 75px; align-items: center; gap: 10px; min-height: 47px; border-bottom: 1px solid #e3e3e0; font-size: 11px; }
.summary-row:last-child { border-bottom: 0; }
.summary-row > span { font-weight: 700; }
.summary-row strong { text-align: right; }
.summary-bar { height: 7px; background: #e3e3e0; border-radius: 30px; overflow: hidden; }
.summary-bar i { display: block; height: 100%; background: #171717; border-radius: inherit; }
.offline-banner, .status-banner { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #fff; border: 1.5px solid #171717; font-size: 11px; margin-bottom: 16px; }
.offline-dot { width: 7px; height: 7px; border-radius: 50%; background: #b77444; }
.status-banner button { margin-left: auto; border: 0; background: none; display: inline-grid; place-items: center; }
.modal-backdrop { position: fixed; inset: 0; z-index: 40; background: rgb(0 0 0 / .55); display: flex; align-items: flex-end; justify-content: center; overflow-y: auto; }
.modal { width: min(100%, 520px); max-height: min(94vh, 900px); overflow-y: auto; background: #fff; border: 2px solid #171717; border-radius: 9px 9px 0 0; padding: 22px; box-shadow: 0 -5px 0 rgb(0 0 0 / .08); }
.modal-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
.modal-head h2 { margin: 5px 0 0; font-size: 25px; letter-spacing: -.05em; }
.amount-field { display: flex; align-items: center; border: 2px solid #171717; border-radius: 3px; height: 58px; }
.amount-field select { align-self: stretch; width: 80px; border: 0; border-right: 1.5px solid #171717; padding: 0 10px; background: #f2f2f0; font-weight: 800; font-size: 13px; }
.amount-field input { min-width: 0; flex: 1; height: 100%; border: 0; padding: 0 13px; outline: 0; font-size: 28px; font-weight: 800; letter-spacing: -.04em; }
.chip-group { display: flex; flex-wrap: wrap; gap: 7px; }
.chip { min-height: 34px; padding: 7px 12px; border: 1.5px solid #171717; background: #fff; border-radius: 30px; font-size: 11px; font-weight: 700; }
.chip.selected { color: #fff; background: #171717; }
.field-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.form-error { color: #a83326; font-size: 11px; }
@media (min-width: 650px) { .content { padding-top: 38px; } .modal-backdrop { align-items: center; } .modal { border-radius: 8px; } }
@media (max-width: 420px) { .header-inner { padding: 0 15px; } .brand { font-size: 22px; } .content { padding-left: 16px; padding-right: 16px; } .budget-card { padding-left: 17px; padding-right: 17px; } .budget-guidance { margin-left: -17px; margin-right: -17px; padding-left: 17px; padding-right: 17px; } .donut { width: 88px; } .donut > div { width: 62px; } .donut strong { font-size: 17px; } .budget-hero { min-height: 133px; } .trip-select-label select { max-width: 124px; } }

/* Refinement tokens: existing card order, container width, and navigation placement stay intact. */
:root { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #182a35; background: #f4f7f8; --ink: #182a35; --muted: #475b67; --line: #526772; }
.section-today { --accent: #075f68; --tint: #e9f5f3; }
.section-expenses { --accent: #654398; --tint: #f3eef9; }
.section-plan { --accent: #8a4b08; --tint: #fff4e5; }
a { color: #064f78; }
.brand { color: var(--ink); text-decoration: none; }
.brand-dot { color: var(--accent); }
.site-header, .bottom-nav { border-color: #c3d0d5; }
.site-header { border-top: 4px solid var(--accent); }
.content { scroll-margin-top: 90px; }
.content h1 { scroll-margin-top: 100px; }
.intro p, .eyebrow, .metric-card small, .expense-main span, .expense-amount span,
.rate-note, .field-help, .card-description, .impact-card p, .impact-result span, .empty-list { color: var(--muted); }
.eyebrow, .field-label, .metric-card small, .field-help, .rate-note, .expense-main span, .expense-amount span,
.button.small, .small-tag, .text-link, .nav-inner button, .summary-row, .allocation, .save-message, .form-error { font-size: 12px; }
.field-help, .rate-note { line-height: 1.55; }
.trip-phase { margin-top: 12px !important; font-size: 13px !important; font-weight: 650; }
.budget-card, .plan-total, .expenses-total { background: var(--accent); border-color: var(--accent); }
.budget-card .eyebrow, .plan-total .eyebrow, .expenses-total .eyebrow,
.budget-hero p, .plan-total p, .expenses-total p { color: #fff; }
.budget-hero h2 { font-size: clamp(34px, 8vw, 57px); letter-spacing: -.05em; overflow-wrap: anywhere; }
.budget-hero > div:first-child { min-width: 0; }
.donut { background: conic-gradient(#fff var(--percent), #456d73 var(--percent)); }
.donut > div { background: var(--accent); }
.donut span { color: #fff; }
.budget-guidance { background: rgb(0 0 0 / .18); color: #fff; }
.add-expense-card { border-color: var(--accent); box-shadow: 3px 3px 0 var(--accent); }
.plus-square, .button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.button.primary:hover { background: #183b4a; }
.button.outline { border-color: var(--accent); color: var(--accent); }
.add-expense-card small { color: var(--muted); }
.metric-card, .plan-card, .list-card, .category-summary, .impact-card { border-color: #aabcc5; border-radius: 8px; }
.impact-card { background: var(--tint); }
.impact-result { border-left-color: var(--accent); }
.impact-result.negative, .allocation.over strong, .form-error, .pace-note.over { color: #9d291e; }
.nav-inner button { min-height: 72px; color: #475b67; gap: 5px; }
.nav-inner .nav-today.active { color: #075f68; border-top-color: #075f68; background: #e9f5f3; }
.nav-inner .nav-expenses.active { color: #654398; border-top-color: #654398; background: #f3eef9; }
.nav-inner .nav-plan.active { color: #8a4b08; border-top-color: #8a4b08; background: #fff4e5; }
.nav-inner .active span { text-decoration: underline; text-underline-offset: 4px; }
.nav-inner button:focus-visible { outline-offset: -6px; }
.nav-inner .nav-plan { display: flex; align-items: center; justify-content: center; gap: 6px; }
.text-input, .dollar-input, .amount-field, .amount-field select, .impact-input, .trip-select-label select { border-color: var(--line); }
.text-input { height: 46px; font-size: 16px; }
.dollar-input input, .impact-input input { font-size: 16px; }
.dollar-input.compact { width: 139px; min-height: 44px; }
.field-label { line-height: 1.5; }
.button, .icon-button, .text-link { min-height: 44px; }
.icon-button { min-width: 44px; }
.trip-select-label select { min-height: 44px; font-size: 13px; }
.row-edit { width: 44px; }
.expense-main strong, .expense-amount strong { font-size: 13px; }
.expense-main strong, .expense-main span { white-space: normal; overflow-wrap: anywhere; }
.expense-row { gap: 8px; }
.expense-amount { flex: 0 0 auto; }
input[type=number] { appearance: textfield; -moz-appearance: textfield; }
input::-webkit-inner-spin-button, input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible, [tabindex]:focus-visible { outline: 3px solid #165bb1; outline-offset: 3px; }
.amount-field:focus-within, .dollar-input:focus-within, .impact-input:focus-within { outline: 3px solid #165bb1; outline-offset: 3px; }
.amount-field input:focus-visible, .dollar-input input:focus-visible, .impact-input input:focus-visible { outline: none; }
.skip-link { position: fixed; z-index: 100; left: 12px; top: -100px; padding: 12px; background: #fff; color: #182a35; }
.skip-link:focus { top: 12px; }
.modal { position: fixed; inset: auto 0 0; margin: 0 auto; max-height: 90dvh; border-color: #526772; border-radius: 12px 12px 0 0; color: var(--ink); --accent: #654398; }
.modal::backdrop { background: rgb(15 30 40 / .65); }
.modal-head h2 { margin-top: 3px; }
.modal .field-help { font-size: 12px; }
.amount-field select { font-size: 14px; width: 84px; }
.optional { color: var(--muted); font-weight: 400; }
.form-actions { display: flex; gap: 12px; margin-top: 20px; flex-wrap: wrap; }
.plan-card h2 { font-size: 19px; margin-top: 0; }
.plan-card h3, .category-summary h3 { font-size: 15px; }
.pace-note { padding: 12px 14px; border-left: 4px solid var(--accent); background: var(--tint); font-size: 13px; line-height: 1.5; }
.chart-grid { display: grid; gap: 14px; }
.chart-grid > * { min-width: 0; }
.category-summary { padding-bottom: 12px; }
.summary-row { grid-template-columns: minmax(75px, 1fr) minmax(32px, 1fr) auto; gap: 8px; }
.summary-row > span { overflow-wrap: anywhere; }
.summary-bar { height: 10px; background: #dbe4e9; }
.donut-card { margin: 0; padding: 18px; border: 1px solid #aabcc5; border-radius: 8px; background: #fff; }
.donut-card figcaption { font-size: 15px; font-weight: 700; }
.category-donut { display: block; width: 180px; max-width: 100%; margin: 10px auto; }
.donut-total { font-size: 18px; font-weight: 750; fill: #182a35; }
.donut-caption { font-size: 7px; fill: #475b67; }
.chart-legend { list-style: none; margin: 0; padding: 0; display: grid; gap: 9px; }
.chart-legend li { display: grid; grid-template-columns: 14px 1fr auto; gap: 7px; font-size: 12px; align-items: center; overflow-wrap: anywhere; }
.legend-swatch { height: 12px; width: 12px; border-radius: 2px; border: 1px solid #182a35; }
.donut-card details { margin-top: 14px; font-size: 12px; line-height: 1.5; }
summary { cursor: pointer; padding: 12px 0; min-height: 44px; font-weight: 650; }
.category-progress { padding: 13px 0; border-bottom: 1px solid #dce4e7; font-size: 13px; }
.category-progress:last-child { border: 0; }
.category-progress > div { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; }
.category-progress small { display: block; color: var(--muted); margin-top: 5px; }
progress { display: block; width: 100%; height: 12px; accent-color: var(--accent); }
.preparation-list { display: grid; gap: 10px; }
.preparation-list label { display: flex; align-items: flex-start; gap: 12px; padding: 8px 0; min-height: 44px; }
.preparation-list strong { font-size: 13px; }
.preparation-list small { display: block; color: var(--muted); font-size: 12px; line-height: 1.5; margin-top: 4px; }
input[type=checkbox], .extra-row input[type=checkbox] { appearance: auto; width: 24px; height: 24px; flex: 0 0 24px; margin: 0; accent-color: var(--accent); }
.preparation-summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 18px 0; background: var(--tint); padding: 12px; border-radius: 6px; font-size: 13px; }
.plan-card:has(.preparation-list), .category-progress, .flight-panel { margin-top: 16px; }
.flight-panel { border: 1px solid #aabcc5; background: #fff; border-radius: 8px; padding: 0 18px; }
.flight-panel > summary { padding-block: 18px; }
.flight-body { padding-bottom: 18px; }
.fare-search { border-bottom: 1px solid #aabcc5; padding-bottom: 22px; margin-bottom: 22px; }
.fare-fields { border: 0; padding: 0; margin: 0; min-width: 0; }
.fare-offer h4 { font-size: 1rem; margin: 0 0 8px; }
.fare-offer li, .booking-options a { overflow-wrap: anywhere; }
.fare-offer ul { padding-left: 20px; }
.fare-leg { margin-block: 12px; }
.fare-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.fare-actions .button { flex: 1 1 180px; }
.saved-fare-quotes { margin-top: 18px; }
.saved-flight { border-left: 4px solid var(--accent); padding: 8px 12px; margin-block: 12px; background: var(--tint); }
.saved-flight h3 { font-size: 15px; margin: 4px 0; }
.saved-flight p { font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.lookup-row { display: flex; gap: 8px; }
.lookup-row input { min-width: 0; }
.lookup-row button { flex-shrink: 0; }
.check-option { display: flex; align-items: flex-start; gap: 10px; margin-top: 20px; font-size: 13px; line-height: 1.6; }
.status-banner, .offline-banner { font-size: 13px; line-height: 1.5; border-radius: 6px; border-color: #526772; }
.status-banner { align-items: flex-start; }
.save-message.success { color: #204f35; background: #eef7f0; border-color: #48785a; }
@media (min-width: 650px) { .chart-grid { grid-template-columns: 1fr 1fr; } .modal { inset: 0; margin: auto; height: fit-content; border-radius: 12px; } }
@media (max-width: 420px) { .expense-mark { display: none; } .daily-grid { gap: 8px; } .metric-card { padding: 14px; } .metric-card strong { font-size: 23px; } .summary-row { font-size: 11px; } .dollar-input.compact { width: 120px; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; scroll-behavior: auto !important; } }
@media (forced-colors: active) { .legend-swatch, .budget-card, .nav-inner .active { border: 2px solid CanvasText; } .summary-bar i { background: CanvasText !important; } }
````
