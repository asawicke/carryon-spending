"""Regression tests for accounts, itinerary planning, catalogs and housekeeping."""
import json
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from backend.app import create_app, connect_database
from backend.catalog import CURRENCIES
from test_app import fixture_http


class FeedbackTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.config = {"TESTING": True, "ALLOW_LEGACY_DEVICE_ACCESS": True, "DATABASE_PATH": str(Path(self.temp.name) / "feedback.db"), "HTTP_FETCH": fixture_http, "IGNAV_API_KEY": "fixture-only"}
        self.app = create_app(self.config)
        self.client = self.app.test_client()
        self.start = date.today() + timedelta(days=10)
        self.end = self.start + timedelta(days=3)

    def tearDown(self):
        self.temp.cleanup()

    def trip(self, client=None, **extra):
        response = (client or self.client).post('/api/trips', json={"name": "Europe", "destination": "Paris → Bangkok",
            "startDate": self.start.isoformat(), "endDate": self.end.isoformat(), "budget": 1000,
            "currency": "USD", "localCurrency": "EUR", "categoryBudgets": {"Flights": 300, "Stay": 200, "Food": 300, "Activities": 100, "Buffer": 100}, **extra})
        self.assertEqual(response.status_code, 201, response.json)
        return response.json

    def register(self, client, email):
        response = client.post('/api/account/register', json={"name": "Test traveler", "email": email, "password": "a-fixture-password-123"})
        self.assertEqual(response.status_code, 201, response.json)
        return response.json['user']

    def stops(self):
        return [{"id": "paris", "place": "Paris", "country": "FR", "currency": "EUR", "startDate": self.start.isoformat(), "endDate": (self.start + timedelta(days=1)).isoformat()},
                {"id": "bangkok", "place": "Bangkok", "country": "TH", "currency": "THB", "startDate": (self.start + timedelta(days=2)).isoformat(), "endDate": self.end.isoformat()}]

    def test_account_isolation_cookie_restart_and_logout(self):
        device = self.trip()
        a, b = self.app.test_client(), self.app.test_client()
        user = self.register(a, 'a@example.test')
        self.assertEqual(a.get('/api/trips').json, [])
        owned = self.trip(a)
        self.register(b, 'b@example.test')
        self.assertEqual(b.get('/api/trips/' + owned['id']).status_code, 404)
        self.assertEqual(b.get('/api/trips/' + owned['id'] + '/fare-quotes').status_code, 404)
        expense = a.post('/api/trips/' + owned['id'] + '/expenses', json={"clientId": "one", "amount": 10, "currency": "USD"}).json
        self.assertEqual(b.delete('/api/expenses/' + expense['id']).status_code, 404)
        cookie = a.get_cookie('carryon_session')
        restarted = create_app(self.config).test_client(); restarted.set_cookie('carryon_session', cookie.value)
        self.assertEqual(restarted.get('/api/account').json['user']['id'], user['id'])
        self.assertEqual(restarted.post('/api/account/logout', json={}).status_code, 200)
        a.set_cookie('carryon_session', cookie.value)
        self.assertEqual(a.get('/api/trips/' + owned['id']).status_code, 401)
        self.assertEqual(self.client.get('/api/trips').json[0]['id'], device['id'])
        db = connect_database(self.config['DATABASE_PATH'])
        stored = db.execute('SELECT password_hash FROM users WHERE id=?', (user['id'],)).fetchone()[0]
        db.close(); self.assertNotIn('a-fixture-password', stored)

    def test_import_requires_confirmation_and_preserves_expenses(self):
        device = self.trip()
        self.client.post('/api/trips/' + device['id'] + '/expenses', json={"clientId": "old", "amount": 12, "category": "Museums"})
        account = self.app.test_client(); self.register(account, 'import@example.test')
        self.assertEqual(account.post('/api/account/import-device', json={"confirm": False}).status_code, 400)
        self.assertEqual(account.post('/api/account/import-device', json={"confirm": True}).status_code, 200)
        self.assertEqual(account.get('/api/trips/' + device['id']).json['summary']['spent'], 12)
        self.assertEqual(self.client.get('/api/trips').json, [])
        self.assertIn('Museums', account.get('/api/categories').json['custom'])
        # Device entries queued before login can sync after the explicit move.
        # Retrying an interrupted import must never double-count them.
        payload = {'clientId': 'previously-offline', 'amount': 7, 'currency': 'USD', 'category': 'Food'}
        self.assertEqual(account.post('/api/trips/' + device['id'] + '/expenses', json=payload).status_code, 201)
        self.assertEqual(account.post('/api/account/import-device', json={'confirm': True}).status_code, 200)
        self.assertEqual(account.post('/api/trips/' + device['id'] + '/expenses', json=payload).status_code, 200)
        self.assertEqual(account.get('/api/trips/' + device['id']).json['summary']['spent'], 19)

    def test_csrf_and_login_failure_limits(self):
        self.assertEqual(self.client.post('/api/account/register', json={}, headers={'Origin': 'https://other.example'}).status_code, 403)
        self.register(self.client, 'login@example.test')
        self.client.post('/api/account/logout', json={})
        for _ in range(10):
            self.assertEqual(self.client.post('/api/account/login', json={"email": "login@example.test", "password": "wrong"}).status_code, 401)
        self.assertEqual(self.client.post('/api/account/login', json={"email": "login@example.test", "password": "wrong"}).status_code, 429)

    def test_new_past_trip_requires_explicit_intent_existing_can_be_edited(self):
        old = (date.today() - timedelta(days=5)).isoformat()
        response = self.client.post('/api/trips', json={"name": "Past", "destination": "Paris", "budget": 100, "startDate": old, "endDate": old})
        self.assertEqual(response.status_code, 400)
        trip = self.trip(startDate=old, endDate=old, recordPast=True)
        self.assertEqual(self.client.patch('/api/trips/' + trip['id'], json={'budget': 900}).status_code, 200)

    def test_multistop_currencies_dates_and_expense_destination(self):
        trip = self.trip(destinations=self.stops())
        self.assertEqual([row['currency'] for row in trip['destinations']], ['EUR','THB'])
        self.assertGreater(trip['destinations'][0]['priceLevel']['value'], trip['destinations'][1]['priceLevel']['value'])
        rows = self.stops(); rows[1]['startDate'] = rows[0]['endDate']
        self.assertEqual(self.client.patch('/api/trips/' + trip['id'], json={'destinations': rows}).status_code, 400)
        valid = self.client.post('/api/trips/' + trip['id'] + '/expenses', json={'clientId':'destination-one','amount':20,'currency':'USD','destinationId':'bangkok'})
        self.assertEqual(valid.status_code, 201, valid.json)
        self.assertEqual(valid.json['destinationId'],'bangkok')
        self.assertEqual(self.client.patch('/api/expenses/' + valid.json['id'], json={'destinationId':'forged'}).status_code,400)

    def test_suggestion_exact_totals_and_country_weights(self):
        trip = self.trip(destinations=self.stops())
        result = self.client.post('/api/trips/' + trip['id'] + '/budget-suggestion', json={'budget':1000,'fixedCosts':{'Flights':300,'Stay':200,'Transit':100},'reserve':100})
        self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(sum(result.json['categoryBudgets'].values()),1000)
        self.assertGreater(result.json['destinations'][0]['dailyEstimate'],result.json['destinations'][1]['dailyEstimate'])
        self.assertEqual(self.client.get('/api/trips/' + trip['id']).json['summary']['spent'],0)
        self.assertEqual(self.client.post('/api/trips/' + trip['id'] + '/budget-suggestion', json={'budget':10,'fixedCosts':{'Flights':20}}).status_code,400)

    def test_category_removal_keeps_history_and_survives_restart(self):
        trip = self.trip()
        row = self.client.post('/api/trips/' + trip['id'] + '/expenses', json={'clientId':'category-one','amount':10,'category':'Museums'}).json
        self.assertEqual(self.client.delete('/api/categories/Museums').status_code,204)
        restarted = create_app(self.config).test_client()
        self.assertNotIn('Museums',restarted.get('/api/categories').json['custom'])
        self.assertEqual(restarted.get('/api/trips/' + trip['id'] + '/expenses').json[0]['category'],'Museums')
        restarted.patch('/api/expenses/' + row['id'],json={'note':'Edited later'})
        self.assertNotIn('Museums',restarted.get('/api/categories').json['custom'])
        self.assertEqual(self.client.delete('/api/categories/Food').status_code,400)

    def test_catalog_service_configuration_and_airport_cache(self):
        catalog = self.client.get('/api/catalog').json
        self.assertGreater(len(catalog['currencies']),150)
        self.assertIn('THB',[row['code'] for row in catalog['currencies']])
        self.assertEqual(CURRENCIES,json.loads(Path('frontend/src/data/currencies.json').read_text()))
        calls=[]
        def transport(endpoint,payload,key):
            calls.append(endpoint)
            return [{'code':'CDG','name':'Charles de Gaulle','city':'Paris','country':'FR'}]
        self.app.config['IGNAV_HTTP']=transport
        first=self.client.post('/api/airports/search',json={'query':'Paris'})
        second=self.client.post('/api/airports/search',json={'query':'paris'})
        self.assertEqual(first.json['airports'][0]['code'],'CDG')
        self.assertTrue(second.json['cached']); self.assertEqual(calls,['airports'])
        self.assertNotIn('fixture-only',json.dumps(self.client.get('/api/services').json))


if __name__ == '__main__':
    unittest.main()
