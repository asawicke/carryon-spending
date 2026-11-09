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
