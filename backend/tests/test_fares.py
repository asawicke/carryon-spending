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
        self.config = {"TESTING": True, "ALLOW_LEGACY_DEVICE_ACCESS": True, "DATABASE_PATH": self.db_path,
                       "IGNAV_API_KEY": "fixture-secret", "IGNAV_HTTP": transport}
        self.app = create_app(self.config)
        self.client = self.app.test_client()
        self.trip = self.client.post("/api/trips", json={"name": "QA", "destination": "London",
            "budget": 1000, "currency": "USD", "localCurrency": "GBP", "recordPast": True, "startDate": "2027-01-08", "endDate": "2027-01-15"}).json
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
