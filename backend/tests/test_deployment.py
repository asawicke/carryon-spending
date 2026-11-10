"""HTTPS/proxy boundaries and deterministic, secret-free deployment packaging."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

from backend.app import create_app
from backend.database import bind_parameters
from scripts.package_deployment import package


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / 'deployment.db')
        self.local = create_app({'TESTING':True,'DATABASE_PATH':self.path})

    def tearDown(self):
        self.temp.cleanup()

    def production(self):
        with patch('backend.app.init_database'):
            return create_app({'TESTING':True,'PRODUCTION':True,
                'DATABASE_PATH':'postgresql://test@unused.example/test?sslmode=verify-full',
                'PUBLIC_ORIGIN':'https://carryon.example'})

    def test_no_silent_production_sqlite_or_unverified_tls(self):
        for values in [{'DATABASE_PATH':self.path,'PUBLIC_ORIGIN':'https://carryon.example'},
                       {'DATABASE_PATH':'postgresql://test@unused.example/test','PUBLIC_ORIGIN':'https://carryon.example'},
                       {'DATABASE_PATH':'postgresql://test@unused.example/test?sslmode=verify-full','PUBLIC_ORIGIN':'http://carryon.example'}]:
            with self.assertRaises(RuntimeError):
                create_app({'TESTING':True,'PRODUCTION':True,**values})

    def test_https_proxy_hosts_security_headers_and_private_import(self):
        client=self.production().test_client()
        response=client.get('/',base_url='http://carryon.example')
        self.assertEqual(response.status_code,308)
        self.assertEqual(response.headers['Location'],'https://carryon.example/')
        response=client.get('/api/account',base_url='http://carryon.example',headers={'X-Forwarded-Proto':'https'})
        self.assertEqual(response.status_code,200)
        self.assertFalse(response.json['canImportDevice'])
        self.assertIn('max-age=',response.headers['Strict-Transport-Security'])
        self.assertIn("object-src 'none'",response.headers['Content-Security-Policy'])
        self.assertEqual(client.get('/api/account',base_url='https://impostor.example',headers={'X-Forwarded-Host':'carryon.example'}).status_code,400)
        self.assertEqual(client.post('/api/account/import-device',base_url='https://carryon.example',json={}).status_code,403)

    def test_secure_cookie_and_production_origin(self):
        from backend.database import connect_database
        client=self.production().test_client()
        # This test isolates the HTTPS/cookie layer. Separate integration tests use real PostgreSQL.
        with patch('backend.app.connect_database',side_effect=lambda _:connect_database(self.path)):
            response=client.post('/api/account/register',base_url='http://carryon.example',
                headers={'X-Forwarded-Proto':'https','Origin':'https://carryon.example'},
                json={'name':'Hosted tester','email':'hosted@example.test','password':'isolated-test-passphrase-2026'})
            self.assertEqual(response.status_code,201,response.json)
            cookie=response.headers['Set-Cookie']
            self.assertIn('Secure;',cookie); self.assertIn('HttpOnly;',cookie); self.assertIn('SameSite=Strict',cookie)
            response=client.post('/api/account/logout',base_url='https://carryon.example',headers={'Origin':'https://impostor.example'},json={})
            self.assertEqual(response.status_code,403)

    def test_parameter_binding_preserves_literal_sql_and_bound_data(self):
        self.assertEqual(bind_parameters("SELECT '?' AS literal, ? AS value, ':name' AS text"),"SELECT '?' AS literal, %s AS value, ':name' AS text")
        self.assertEqual(bind_parameters('INSERT INTO demo VALUES (:id,:note)'), 'INSERT INTO demo VALUES (%(id)s,%(note)s)')

    def test_package_allowlist_excludes_database_keys_and_test_accounts(self):
        dist=Path(self.temp.name)/'dist'; dist.mkdir(); (dist/'index.html').write_text('<h1>Test build</h1>')
        archive=package(Path(self.temp.name)/'app.zip',dist)
        with ZipFile(archive) as bundle:
            names=bundle.namelist()
            self.assertIn('backend/database.py',names); self.assertIn('frontend/dist/index.html',names)
            self.assertFalse(any('.env' in name or '/data/' in name or '/tests/' in name or '.venv' in name for name in names))


if __name__ == '__main__':
    unittest.main()
