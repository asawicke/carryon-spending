"""Real PostgreSQL integration checks; each test owns an isolated, disposable schema."""
import os
import tempfile
import time
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

import psycopg
from psycopg import sql
from backend.app import create_app, connect_database
from backend.providers import put_cache, cached
from test_app import fixture_http


@unittest.skipUnless(os.environ.get('CARRYON_TEST_POSTGRES_URL'), 'Set a disposable PostgreSQL test connection.')
class PostgresTests(unittest.TestCase):
    def setUp(self):
        self.base = os.environ['CARRYON_TEST_POSTGRES_URL']
        self.schema = 'carryon_test_' + uuid.uuid4().hex
        with psycopg.connect(self.base, autocommit=True) as db:
            db.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(self.schema)))
        url = urlsplit(self.base)
        query = dict(parse_qsl(url.query)); query['options'] = '-c search_path=' + self.schema
        self.url = urlunsplit(url._replace(query=urlencode(query, quote_via=quote)))
        self.config = {'TESTING': True, 'DATABASE_PATH': self.url, 'HTTP_FETCH': fixture_http}
        self.app = create_app(self.config); self.client = self.app.test_client()
        self.user = self.register(self.client, 'first@example.test')

    def tearDown(self):
        with psycopg.connect(self.base, autocommit=True) as db:
            db.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(self.schema)))

    def register(self, client, email):
        response = client.post('/api/account/register', json={'name': 'Postgres tester', 'email': email, 'password': 'isolated-testing-passphrase-2026'})
        self.assertEqual(response.status_code, 201, response.json)
        return response.json['user']

    def trip(self, **values):
        response = self.client.post('/api/trips', json={'name':'Database test','destination':'Paris','budget':1000,
            'currency':'USD','localCurrency':'EUR','categoryBudgets':{'Food':500,'Flights':500}, **values})
        self.assertEqual(response.status_code, 201, response.json)
        return response.json

    def test_migrations_restart_isolation_and_big_money(self):
        trip = self.trip(budget='999999999.99')
        other = self.app.test_client(); self.register(other, 'second@example.test')
        self.assertEqual(other.get('/api/trips/' + trip['id']).status_code, 404)
        cookie = self.client.get_cookie('carryon_session')
        restarted = create_app(self.config).test_client(); restarted.set_cookie('carryon_session', cookie.value)
        self.assertEqual(restarted.get('/api/trips').json[0]['budget'], 999999999.99)
        self.assertEqual(restarted.get('/api/account').json['user']['id'], self.user['id'])
        self.assertEqual(self.client.post('/api/account/register', json={'name':'Duplicate','email':'first@example.test','password':'isolated-testing-passphrase-2026'}).status_code,409)
        self.assertEqual(self.client.get('/api/trips').status_code,200)

    def test_named_binding_expense_replay_categories_and_delete(self):
        trip = self.trip(); path = '/api/trips/' + trip['id'] + '/expenses'
        payload = {'clientId':'one','amount':46,'currency':'EUR','category':'Café tours','note':"A quote ' and ? :label 100%"}
        first = self.client.post(path,json=payload)
        self.assertEqual(first.status_code,201,first.json)
        self.assertEqual(first.json['amountBase'],50)
        self.assertEqual(self.client.post(path,json=payload).status_code,200)
        self.assertEqual(self.client.get('/api/trips/'+trip['id']).json['summary']['spent'],50)
        self.assertEqual(self.client.patch('/api/expenses/'+first.json['id'],json={'note':'Edited'}).status_code,200)
        self.assertEqual(self.client.delete('/api/categories/Café tours').status_code,204)
        self.assertEqual(self.client.get(path).json[0]['category'],'Café tours')
        self.assertEqual(self.client.delete('/api/expenses/'+first.json['id']).status_code,204)
        self.assertEqual(self.client.get('/api/trips/'+trip['id']).json['summary']['spent'],0)

    def test_atomic_concurrent_ticket_and_expense(self):
        trip = self.trip(); cookie = self.client.get_cookie('carryon_session')
        payload = {'clientId':'ticket-once','flightNumber':'AA100','origin':'JFK','destination':'CDG',
                   'departureDate':'2027-01-09','fare':17,'currency':'USD','logExpense':True}
        def submit(_):
            client = self.app.test_client(); client.set_cookie('carryon_session',cookie.value)
            return client.post('/api/trips/'+trip['id']+'/flights',json=payload)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(submit,range(2)))
        self.assertEqual(sorted(row.status_code for row in results),[200,201], [row.json for row in results])
        self.assertEqual(self.client.get('/api/trips/'+trip['id']).json['summary']['spent'],17)
        self.assertEqual(len(self.client.get('/api/trips/'+trip['id']+'/expenses').json),1)

    def test_cache_upsert_precision_and_login_limit(self):
        db=connect_database(self.url)
        put_cache(db,'test',{'version':1},300); put_cache(db,'test',{'version':2},300)
        row=cached(db,'test'); self.assertIn('2',row['data'])
        self.assertLess(abs(row['created_at']-time.time()),1)
        self.assertAlmostEqual(row['expires_at']-row['created_at'],300,places=2); db.close()
        self.client.post('/api/account/logout',json={})
        for _ in range(10):
            self.assertEqual(self.client.post('/api/account/login',json={'email':'first@example.test','password':'wrong'}).status_code,401)
        self.assertEqual(self.client.post('/api/account/login',json={'email':'first@example.test','password':'wrong'}).status_code,429)


if __name__ == '__main__':
    unittest.main()
