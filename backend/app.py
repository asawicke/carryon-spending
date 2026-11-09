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
