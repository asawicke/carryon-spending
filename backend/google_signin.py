"""Optional Google Identity Services sign-in; no account linking by email alone."""
import hashlib
import re
import secrets
import time
from .database import IntegrityErrors

from flask import request, make_response
from werkzeug.security import generate_password_hash

NONCE_COOKIE = "carryon_google_nonce"


def verify_google_token(credential, client_id):
    from google.oauth2 import id_token
    from google.auth.transport.requests import Request

    class BoundedRequest(Request):
        def __call__(self, *args, **kwargs):
            kwargs["timeout"] = 8
            return super().__call__(*args, **kwargs)

    return id_token.verify_oauth2_token(credential, BoundedRequest(), client_id)


def register_google(app, helpers, signed_in, limit_login):
    db, body, error = (helpers[key] for key in ("get_db", "body_object", "ApiError"))

    def configured():
        client_id = app.config.get("GOOGLE_CLIENT_ID", "")
        if not client_id:
            raise error("Google sign-in needs setup. Continue with email.", 503, "google_not_configured")
        return client_id

    @app.get("/api/account/google/challenge")
    def challenge():
        configured()
        nonce = request.cookies.get(NONCE_COOKIE, "")
        digest = hashlib.sha256(nonce.encode()).hexdigest()
        timestamp = time.time()
        db().execute("DELETE FROM login_nonces WHERE expires<?", (timestamp,))
        if not nonce or not db().execute("SELECT 1 FROM login_nonces WHERE digest=?", (digest,)).fetchone():
            nonce = secrets.token_urlsafe(32)
            db().execute("INSERT INTO login_nonces VALUES (?,?)", (hashlib.sha256(nonce.encode()).hexdigest(), timestamp + 1800))
        db().commit()
        response = make_response({"nonce": nonce})
        response.set_cookie(NONCE_COOKIE, nonce, max_age=1800, httponly=True, samesite="Strict", secure=app.config.get("COOKIE_SECURE", False))
        return response

    @app.post("/api/account/google")
    def google_login():
        client_id = configured()
        key = limit_login()
        data = body(); helpers["require_allowed"](data, {"credential"})
        credential, nonce = data.get("credential"), request.cookies.get(NONCE_COOKIE, "")
        if not isinstance(credential, str) or not 1 <= len(credential) <= 16000 or not nonce:
            raise error("Refresh the page and try Google sign-in again.", 401)
        digest = hashlib.sha256(nonce.encode()).hexdigest()
        if not db().execute("SELECT 1 FROM login_nonces WHERE digest=? AND expires>?", (digest, time.time())).fetchone():
            raise error("Google sign-in expired. Refresh the page and try again.", 401)
        try:
            claims = verify_google_token(credential, client_id)
        except ValueError:
            raise error("Google could not verify this sign-in. Try again or use email.", 401)
        except Exception:
            # Do not expose provider responses, credentials, or transport diagnostics.
            raise error("Google sign-in is temporarily unavailable. Continue with email or try again later.", 503)
        if (claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com")
                or claims.get("aud") != client_id or not isinstance(claims.get("exp"), (int, float))
                or claims["exp"] <= time.time() or not secrets.compare_digest(str(claims.get("nonce", "")), nonce)
                or not isinstance(claims.get("sub"), str) or not 1 <= len(claims["sub"]) <= 255
                or claims.get("email_verified") is not True):
            raise error("Google could not verify this sign-in. Refresh the page and try again.", 401)
        email = str(claims.get("email", "")).strip().casefold()
        if len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            raise error("Google did not provide a verified email address. Use email sign-in.", 401)
        try:
            db().execute("BEGIN IMMEDIATE")
            # Atomic consumption prevents replay and two simultaneous successful callbacks.
            if not db().execute("DELETE FROM login_nonces WHERE digest=? AND expires>?", (digest, time.time())).rowcount:
                db().rollback(); raise error("This sign-in was already used. Refresh the page.", 401)
            user = db().execute("SELECT u.* FROM users u JOIN google_identities i ON i.user_id=u.id WHERE i.subject=?", (claims["sub"],)).fetchone()
            if not user:
                if db().execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
                    db().rollback()
                    raise error("This email already has a CarryOn account. Sign in with its password. Google linking is not available yet.", 409)
                name = str(claims.get("given_name") or claims.get("name") or "Traveler").strip()[:60] or "Traveler"
                user = {"id": secrets.token_hex(16), "email": email, "name": name}
                db().execute("INSERT INTO users VALUES (?,?,?,?)", (user["id"], email, name, generate_password_hash(secrets.token_urlsafe(48))))
                db().execute("INSERT INTO google_identities VALUES (?,?)", (claims["sub"], user["id"]))
            db().execute("DELETE FROM login_attempts WHERE key=?", (key,)); db().commit()
        except IntegrityErrors:
            db().rollback(); raise error("This account changed during sign-in. Refresh and try again.", 409)
        response = signed_in(user)
        response.delete_cookie(NONCE_COOKIE)
        return response
