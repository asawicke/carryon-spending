"""Default production auth gate and optional Google identity trust-boundary checks."""
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app import create_app, connect_database


class AuthEntryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / 'auth.db')
        self.config = {'TESTING': True, 'DATABASE_PATH': self.path, 'GOOGLE_CLIENT_ID': 'test.apps.googleusercontent.com'}
        self.app = create_app(self.config)
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp.cleanup()

    def challenge(self):
        response = self.client.get('/api/account/google/challenge')
        self.assertEqual(response.status_code, 200)
        self.assertIn('HttpOnly', response.headers['Set-Cookie'])
        return response.json['nonce']

    def claims(self, **overrides):
        return {'iss': 'https://accounts.google.com', 'aud': self.config['GOOGLE_CLIENT_ID'],
                'sub': 'test-google-subject', 'email': 'google@example.test', 'email_verified': True,
                'given_name': 'Real name', 'exp': time.time() + 300, 'nonce': self.challenge(), **overrides}

    def google(self, claims):
        with patch('backend.google_signin.verify_google_token', return_value=claims) as verify:
            response = self.client.post('/api/account/google', json={'credential': 'isolated-test-token'})
            if verify.called:
                verify.assert_called_once_with('isolated-test-token', self.config['GOOGLE_CLIENT_ID'])
            return response

    def test_signed_out_endpoints_require_login_and_signed_in_trip_persists(self):
        for path in ['/api/trips', '/api/categories', '/api/rates', '/api/services']:
            self.assertEqual(self.client.get(path).status_code, 401, path)
        self.assertEqual(self.client.post('/api/trips', json={}).status_code, 401)
        self.assertIsNone(self.client.get('/api/account').json['user'])
        registration = self.client.post('/api/account/register', json={'email': 'local@example.test', 'name': 'Account name', 'password': 'a-test-passphrase-2026'})
        self.assertEqual(registration.status_code, 201)
        trip = self.client.post('/api/trips', json={'name': 'Private trip', 'destination': 'Paris', 'budget': 100})
        self.assertEqual(trip.status_code, 201, trip.json)
        cookie = self.client.get_cookie('carryon_session')
        restarted = create_app(self.config).test_client(); restarted.set_cookie('carryon_session', cookie.value)
        self.assertEqual(restarted.get('/api/trips').json[0]['id'], trip.json['id'])
        self.assertEqual(restarted.get('/api/account').json['user']['name'], 'Account name')
        self.client.post('/api/account/logout', json={})
        self.assertEqual(self.client.get('/api/trips').status_code, 401)
        self.assertEqual(restarted.get('/api/trips').status_code, 401)

    def test_google_unconfigured_is_explicit(self):
        self.app.config['GOOGLE_CLIENT_ID'] = ''
        self.assertEqual(self.client.get('/api/account').json['googleClientId'], '')
        self.assertEqual(self.client.get('/api/account/google/challenge').status_code, 503)
        self.assertEqual(self.client.post('/api/account/google', json={'credential': 'test'}).status_code, 503)

    def test_google_session_replay_and_stable_subject(self):
        claims = self.claims()
        nonce_cookie = self.client.get_cookie('carryon_google_nonce')
        first = self.google(claims)
        self.assertEqual(first.status_code, 200, first.json)
        self.assertEqual(first.json['user']['name'], 'Real name')
        self.assertIsNone(self.client.get_cookie('carryon_google_nonce'))
        self.client.set_cookie('carryon_google_nonce', nonce_cookie.value)
        self.assertEqual(self.google(claims).status_code, 401)
        self.client.post('/api/account/logout', json={})
        # Subject, not changeable Google email, identifies returning Google users.
        second = self.google(self.claims(email='changed@example.test'))
        self.assertEqual(second.status_code, 200, second.json)
        self.assertEqual(second.json['user']['id'], first.json['user']['id'])

    def test_google_rejects_invalid_claims_missing_challenge_and_cross_site(self):
        self.assertEqual(self.client.post('/api/account/google', json={'credential': 'test'}).status_code, 401)
        for fields in [{'aud': 'another-client'}, {'iss': 'https://impostor.example'}, {'exp': 0}, {'nonce': 'wrong'}, {'email_verified': False}, {'sub': ''}]:
            self.assertEqual(self.google(self.claims(**fields)).status_code, 401, fields)
        self.assertEqual(self.client.post('/api/account/google', json={'credential': 'test'}, headers={'Origin': 'https://other.example'}).status_code, 403)
        db = connect_database(self.path)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM users').fetchone()[0], 0); db.close()

    def test_invalid_signature_or_provider_downtime_creates_no_session(self):
        self.challenge()
        for cause, status in [(ValueError('invalid signature'), 401), (OSError('private transport error'), 503)]:
            with patch('backend.google_signin.verify_google_token', side_effect=cause):
                response = self.client.post('/api/account/google', json={'credential': 'test'})
            self.assertEqual(response.status_code, status)
            self.assertNotIn('private transport', str(response.json))
            self.assertIsNone(self.client.get_cookie('carryon_session'))

    def test_google_never_links_password_account_by_matching_email(self):
        registration = self.client.post('/api/account/register', json={'email': 'google@example.test', 'name': 'Password owner', 'password': 'a-test-passphrase-2026'})
        self.client.post('/api/account/logout', json={})
        response = self.google(self.claims())
        self.assertEqual(response.status_code, 409)
        self.assertIsNone(self.client.get('/api/account').json['user'])
        login = self.client.post('/api/account/login', json={'email': 'google@example.test', 'password': 'a-test-passphrase-2026'})
        self.assertEqual(login.json['user']['id'], registration.json['user']['id'])

    def test_official_verifier_checks_real_signature_and_audience(self):
        # Local signing keys/certificate fixtures exercise google-auth without a network call.
        import json
        from datetime import datetime, timedelta, timezone
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from google.auth import crypt, jwt
        from backend.google_signin import verify_google_token
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(x509.NameOID.COMMON_NAME, 'Local test')])
        now = datetime.now(timezone.utc)
        cert = x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(1).not_valid_before(now - timedelta(minutes=1)).not_valid_after(now + timedelta(days=1)).sign(key, hashes.SHA256())
        pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        signer = crypt.RSASigner.from_string(pem, key_id='fixture')
        claims = self.claims(); claims['iat'] = int(time.time())
        token = jwt.encode(signer, claims).decode()
        class CertificateResponse:
            status = 200
            data = json.dumps({'fixture': cert.public_bytes(serialization.Encoding.PEM).decode()}).encode()
        with patch('google.auth.transport.requests.Request.__call__', return_value=CertificateResponse()) as transport:
            self.assertEqual(verify_google_token(token, self.config['GOOGLE_CLIENT_ID'])['sub'], claims['sub'])
            self.assertEqual(transport.call_args.kwargs['timeout'], 8)
            with self.assertRaises(ValueError):
                verify_google_token(token, 'wrong-client')
            pieces = token.split('.'); pieces[2] = ('A' if pieces[2][0] != 'A' else 'B') + pieces[2][1:]
            with self.assertRaises(ValueError):
                verify_google_token('.'.join(pieces), self.config['GOOGLE_CLIENT_ID'])


if __name__ == '__main__':
    unittest.main()
