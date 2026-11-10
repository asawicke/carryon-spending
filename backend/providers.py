"""Real provider requests, bounded timeouts, persistent cache and quota protection."""
import json
import os
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from flask import current_app
from .catalog import CURRENCY_CODES

SUPPORTED_CURRENCIES = CURRENCY_CODES


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
    db.execute("INSERT INTO provider_cache VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET "
               "data=excluded.data,created_at=excluded.created_at,expires_at=excluded.expires_at",
               (key, json.dumps(data), time.time(), time.time() + ttl))
    db.commit()


def rates(db):
    key = "rates:USD:worldwide"
    row = cached(db, key)
    if row and row["expires_at"] > time.time():
        return json.loads(row["data"])
    try:
        query = urlencode({"base": "USD"})
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
                "unavailable": True, "message": "Exchange rates are unavailable. You can still record expenses in your trip's home currency."}


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
    db.execute("INSERT INTO provider_usage VALUES (?, 0) ON CONFLICT DO NOTHING", (month,))
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
