"""Destination/date validation and attributed country context."""
import json
import uuid
from datetime import date
from .catalog import COUNTRY_CODES, COUNTRY_BY_CODE, PRICE_LEVELS

DAILY_CATEGORIES = ["Food", "Activities", "Shopping", "Other"]


def normalize_itinerary(data, existing, start, end, helpers):
    error = helpers["ApiError"]
    raw = data.get("destinations", json.loads(existing["destinations_json"]) if existing else [])
    if not isinstance(raw, list) or len(raw) > 12:
        raise error("Add up to 12 destinations.")
    stops, ids = [], set()
    for item in raw:
        if not isinstance(item, dict) or set(item) - {"id", "place", "country", "currency", "startDate", "endDate"}:
            raise error("Destination details could not be read.")
        stop_id = helpers["text_field"](item.get("id", str(uuid.uuid4())), "Destination id", maximum=100)
        if stop_id in ids:
            raise error("Each destination needs its own id.")
        ids.add(stop_id)
        country = helpers["text_field"](item.get("country"), "Country", maximum=2).upper()
        if country not in COUNTRY_CODES:
            raise error("Choose a country from the list.")
        a, b = (helpers["parse_date"](item.get(key), label) for key, label in
                (("startDate", "Destination arrival"), ("endDate", "Destination last day")))
        if a > b or (start and a < start) or (end and b > end):
            raise error("Destination dates must be ordered and inside your trip dates.")
        stops.append({"id": stop_id, "place": helpers["text_field"](item.get("place"), "City or destination", maximum=100),
                      "country": country, "currency": helpers["currency_field"](item.get("currency")), "startDate": a, "endDate": b})
    stops.sort(key=lambda row: row["startDate"])
    for previous, current in zip(stops, stops[1:]):
        if current["startDate"] <= previous["endDate"]:
            raise error("Destination days overlap. Assign each spending day to one destination.")
    if stops and (stops[0]["startDate"] != start or stops[-1]["endDate"] != end):
        raise error("Your destinations must cover the first and last trip dates.")
    if stops:
        from datetime import timedelta
        for previous, current in zip(stops, stops[1:]):
            if date.fromisoformat(previous["endDate"]) + timedelta(days=1) != date.fromisoformat(current["startDate"]):
                raise error("Cover each trip day with a destination. Add travel days to the destination where you will spend them.")
    daily = data.get("dailyCategories", json.loads(existing["daily_categories_json"]) if existing else DAILY_CATEGORIES)
    if (not isinstance(daily, list) or len(daily) > 20 or any(not isinstance(c, str) or not c.strip() or len(c) > 40 for c in daily)
            or len(set(daily)) != len(daily) or "Buffer" in daily):
        raise error("Choose distinct daily spending categories. Keep the emergency reserve separate.")
    return {"destinations_json": json.dumps(stops), "daily_categories_json": json.dumps(daily)}


def destination_context(raw):
    result = []
    for stop in raw:
        country = COUNTRY_BY_CODE.get(stop["country"], {})
        level = PRICE_LEVELS["values"].get(country.get("iso3"))
        # Old observations remain attributable, but are not used as spending weights.
        usable = level and int(level["year"]) >= date.today().year - 5
        result.append(stop | {"countryName": country.get("name", stop["country"]),
                               "priceLevel": level if usable else None,
                               "priceSource": "World Bank · GDP price level index (US=100)"})
    return result
