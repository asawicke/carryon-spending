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
