"""Transparent budget templates; country indexes weight a user-defined daily pool."""
from datetime import date
from .itineraries import destination_context
import json


def suggested_categories(total_cents, fixed, reserve_cents):
    pool = total_cents - sum(fixed.values()) - reserve_cents
    if pool < 0:
        raise ValueError("Fixed costs and emergency reserve exceed the total budget.")
    parts = {"Food": pool * 50 // 100, "Activities": pool * 30 // 100, "Shopping": pool * 10 // 100}
    parts["Other"] = pool - sum(parts.values())
    return fixed | parts | {"Buffer": reserve_cents}


def register_planning(app, helpers):
    @app.post("/api/trips/<trip_id>/budget-suggestion")
    def suggestion(trip_id):
        trip = helpers["trip_row"](trip_id)
        data = helpers["body_object"]()
        helpers["require_allowed"](data, {"budget", "fixedCosts", "reserve"})
        cents = lambda value, label: helpers["to_cents"](helpers["decimal_money"](value, label, allow_zero=True))
        total = cents(data.get("budget", trip["budget_cents"] / 100), "Total budget")
        raw_fixed = data.get("fixedCosts", {})
        if not isinstance(raw_fixed, dict) or set(raw_fixed) - {"Flights", "Stay", "Transit"}:
            raise helpers["ApiError"]("Enter fixed estimates for Flights, Stay and Transit.")
        fixed = {name: cents(raw_fixed.get(name, 0), name) for name in ("Flights", "Stay", "Transit")}
        reserve = cents(data.get("reserve", total / 1000), "Emergency reserve")
        try:
            values = suggested_categories(total, fixed, reserve)
        except ValueError as exc:
            raise helpers["ApiError"](str(exc)) from None
        stops, weights = destination_context(json.loads(trip["destinations_json"])), []
        for stop in stops:
            days = (date.fromisoformat(stop["endDate"]) - date.fromisoformat(stop["startDate"])).days + 1
            weight = stop["priceLevel"]["value"] / 100 if stop["priceLevel"] else 1
            weights.append({"id": stop["id"], "place": stop["place"], "days": days, "weight": weight,
                            "priceLevel": stop["priceLevel"], "source": stop["priceSource"]})
        flexible = total - sum(fixed.values()) - reserve
        denominator = sum(row["days"] * row["weight"] for row in weights)
        for row in weights:
            row["dailyEstimate"] = round(flexible / 100 * row["weight"] / denominator, 2) if denominator else None
        return {"categoryBudgets": {key: value / 100 for key, value in values.items()}, "destinations": weights,
                "explanation": "After your fixed costs and reserve: 50% food, 30% activities, 10% shopping, 10% other. This editable starting template is not based on typical traveler prices.",
                "countryNote": "Country weights use the World Bank GDP price level index, not tourist prices. Missing data gets equal weight. Adjust for your itinerary and travel style."}
