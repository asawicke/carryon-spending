"""Real, attributed reference catalogs shipped with the app for reliable startup."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "resources"
CURRENCIES = json.loads((ROOT / "currencies.json").read_text())
COUNTRIES = json.loads((ROOT / "countries.json").read_text())
PRICE_LEVELS = json.loads((ROOT / "price_levels.json").read_text())
CURRENCY_CODES = tuple(row["code"] for row in CURRENCIES)
COUNTRY_CODES = {row["code"] for row in COUNTRIES}
COUNTRY_BY_CODE = {row["code"]: row for row in COUNTRIES}


def catalog_payload():
    return {"currencies": CURRENCIES, "countries": COUNTRIES,
            "sources": {"currencies": "https://frankfurter.dev", "countries": "https://data.worldbank.org"},
            "retrieved": "2026-11-09"}
