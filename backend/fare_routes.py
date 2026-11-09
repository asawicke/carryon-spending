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
