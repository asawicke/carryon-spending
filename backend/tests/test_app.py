"""Behavioral checks for CarryOn's persistent prototype API."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.app import create_app


class CarryOnApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self.temp.name) / "carryon.db")
        self.app = create_app({"TESTING": True, "DATABASE_PATH": self.db_path, "SEED_DEMO": False})
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp.cleanup()

    def create_trip(self, **overrides):
        payload = {
            "name": "Test trip", "destination": "Paris", "budget": 100,
            "currency": "USD", "localCurrency": "EUR",
            "categoryBudgets": {"Food": 60, "Transit": 40},
            "overlookedCosts": [{"id": "insurance", "label": "Insurance", "estimate": 20, "checked": False}],
        }
        payload.update(overrides)
        response = self.client.post("/api/trips", json=payload)
        self.assertEqual(response.status_code, 201, response.json)
        return response.json

    def test_demo_seed_has_expected_remaining_budget_and_estimated_rates(self):
        demo_app = create_app({"TESTING": True, "DATABASE_PATH": str(Path(self.temp.name) / "demo.db")})
        client = demo_app.test_client()
        trip = client.get("/api/trips").json[0]
        self.assertEqual(trip["id"], "demo-paris")
        self.assertEqual(trip["localCurrency"], "EUR")
        self.assertEqual(trip["summary"]["spent"], 1058.0)
        self.assertEqual(trip["summary"]["remaining"], 642.0)
        self.assertEqual(trip["summary"]["expenseCount"], 6)
        rates = client.get("/api/rates").json
        self.assertTrue(rates["estimated"])
        self.assertEqual(rates["rates"]["EUR"], 0.92)

    def test_trip_plan_survives_restart(self):
        trip = self.create_trip()
        trip_id = trip["id"]
        response = self.client.patch(f"/api/trips/{trip_id}", json={
            "budget": 120,
            "categoryBudgets": {"Food": 70, "Transit": 50},
            "overlookedCosts": [{"id": "insurance", "label": "Travel insurance", "estimate": 25, "checked": True}],
        })
        self.assertEqual(response.status_code, 200, response.json)
        restarted = create_app({"TESTING": True, "DATABASE_PATH": self.db_path, "SEED_DEMO": False})
        saved = restarted.test_client().get(f"/api/trips/{trip_id}").json
        self.assertEqual(saved["budget"], 120.0)
        self.assertEqual(saved["categoryBudgets"], {"Food": 70.0, "Transit": 50.0})
        self.assertTrue(saved["overlookedCosts"][0]["checked"])
        self.assertEqual(saved["localCurrency"], "EUR")

    def test_foreign_expense_replay_edit_and_delete_update_balance_once(self):
        trip_id = self.create_trip()["id"]
        payload = {"clientId": "offline-uuid-1", "amount": 46, "currency": "EUR",
                   "category": "Food", "note": "Dinner", "date": "2026-11-10"}
        first = self.client.post(f"/api/trips/{trip_id}/expenses", json=payload)
        self.assertEqual(first.status_code, 201, first.json)
        self.assertEqual(first.json["amountBase"], 50.0)
        self.assertAlmostEqual(first.json["rate"], 1 / 0.92, places=7)
        replay = self.client.post(f"/api/trips/{trip_id}/expenses", json=payload)
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json["id"], first.json["id"])

        restarted = create_app({"TESTING": True, "DATABASE_PATH": self.db_path, "SEED_DEMO": False})
        saved = restarted.test_client().get(f"/api/trips/{trip_id}").json
        self.assertEqual(saved["summary"]["spent"], 50.0)
        self.assertEqual(saved["summary"]["remaining"], 50.0)
        self.assertEqual(saved["summary"]["expenseCount"], 1)

        expense_id = first.json["id"]
        changed = self.client.patch(f"/api/expenses/{expense_id}", json={"amount": 23})
        self.assertEqual(changed.status_code, 200, changed.json)
        self.assertEqual(changed.json["amountBase"], 25.0)
        self.assertEqual(self.client.get(f"/api/trips/{trip_id}").json["summary"]["remaining"], 75.0)

        self.assertEqual(self.client.delete(f"/api/expenses/{expense_id}").status_code, 204)
        self.assertEqual(self.client.get(f"/api/trips/{trip_id}").json["summary"]["remaining"], 100.0)
        self.assertEqual(self.client.get(f"/api/trips/{trip_id}/expenses").json, [])
        replay_after_delete = self.client.post(f"/api/trips/{trip_id}/expenses", json=payload)
        self.assertEqual(replay_after_delete.status_code, 200)
        self.assertEqual(replay_after_delete.json["id"], expense_id)
        self.assertIn("deletedAt", replay_after_delete.json)
        self.assertEqual(self.client.get(f"/api/trips/{trip_id}").json["summary"]["spent"], 0.0)

    def test_validation_and_currency_lock(self):
        trip_id = self.create_trip()["id"]
        endpoint = f"/api/trips/{trip_id}/expenses"
        bad_amount = self.client.post(endpoint, json={"clientId": "a", "amount": -1})
        self.assertEqual(bad_amount.status_code, 400)
        bad_currency = self.client.post(endpoint, json={"clientId": "b", "amount": 2, "currency": "XYZ"})
        self.assertEqual(bad_currency.status_code, 400)
        bad_date = self.client.post(endpoint, json={"clientId": "c", "amount": 2, "date": "2026-13-02"})
        self.assertEqual(bad_date.status_code, 400)
        good = self.client.post(endpoint, json={"clientId": "d", "amount": 2})
        self.assertEqual(good.status_code, 201)
        locked = self.client.patch(f"/api/trips/{trip_id}", json={"currency": "EUR"})
        self.assertEqual(locked.status_code, 409)
        self.assertEqual(locked.json["error"]["code"], "currency_locked")
        self.assertEqual(self.client.get("/api/missing").status_code, 404)


if __name__ == "__main__":
    unittest.main()
