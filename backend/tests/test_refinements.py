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
        self.config = {"TESTING": True, "ALLOW_LEGACY_DEVICE_ACCESS": True, "DATABASE_PATH": self.path,
                       "HTTP_FETCH": transport, "AIRLABS_API_KEY": "test-only"}
        self.app = create_app(self.config)
        self.client = self.app.test_client()
        self.trip = self.client.post("/api/trips", json={"name": "QA", "destination": "London",
            "budget": 1000, "currency": "USD", "localCurrency": "GBP", "recordPast": True,
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
