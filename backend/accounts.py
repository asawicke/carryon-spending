"""Local accounts with hashed passwords, revocable sessions and isolated trip ownership."""
import hashlib
import re
import secrets
import time
from .database import table_columns, IntegrityErrors
from .cookies import cookie_options

from flask import g, request, make_response, has_request_context
from werkzeug.security import generate_password_hash, check_password_hash

COOKIE = "carryon_session"


def owner_key():
    return getattr(g, "owner_key", "device") if has_request_context() else "device"


def migrate_accounts(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires DOUBLE PRECISION NOT NULL);
        CREATE TABLE IF NOT EXISTS login_attempts (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at DOUBLE PRECISION NOT NULL);
        CREATE TABLE IF NOT EXISTS google_identities (
            subject TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id));
        CREATE TABLE IF NOT EXISTS login_nonces (digest TEXT PRIMARY KEY, expires DOUBLE PRECISION NOT NULL);
    """)
    columns = table_columns(db, 'trips')
    if "owner_key" not in columns:
        db.execute("ALTER TABLE trips ADD COLUMN owner_key TEXT NOT NULL DEFAULT 'device'")
    columns = table_columns(db, 'categories')
    if "owner_key" not in columns:
        db.executescript("""ALTER TABLE categories RENAME TO legacy_categories;
            CREATE TABLE categories (owner_key TEXT NOT NULL, name_key TEXT NOT NULL, name TEXT NOT NULL,
                                     PRIMARY KEY(owner_key,name_key));
            INSERT INTO categories SELECT 'device',name_key,name FROM legacy_categories;
            DROP TABLE legacy_categories;""")
    columns = table_columns(db, 'categories')
    if "active" not in columns:
        db.execute("ALTER TABLE categories ADD COLUMN active INTEGER NOT NULL DEFAULT 1")


def register_accounts(app, helpers):
    db, body, error = (helpers[key] for key in ("get_db", "body_object", "ApiError"))

    @app.before_request
    def identify_account():
        g.app_db_path = app.config["DATABASE_PATH"]
        g.owner_key, g.user = "device", None
        token = request.cookies.get(COOKIE, "")
        if token:
            row = db().execute("SELECT u.id,u.name,u.email FROM users u JOIN sessions s ON u.id=s.user_id "
                               "WHERE s.token_hash=? AND s.expires>?", (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()
            if row:
                g.owner_key, g.user = row["id"], dict(row)
            elif request.path.startswith("/api/") and not request.path.startswith("/api/account"):
                raise error("Your session expired. Sign in again to access your saved trips.", 401, "session_expired")
        public = request.path == "/api/health" or request.path == "/api/account" or request.path.startswith("/api/account/")
        legacy_fixture = app.testing and app.config.get("ALLOW_LEGACY_DEVICE_ACCESS", False)
        if request.path.startswith("/api/") and not public and not g.user and not legacy_fixture:
            raise error("Sign in to access your trips.", 401, "signin_required")
        if request.method in ("POST", "PATCH", "DELETE") and request.path.startswith("/api/"):
            origin = request.headers.get("Origin")
            expected_origin = app.config.get('PUBLIC_ORIGIN') or request.host_url.rstrip('/')
            if request.headers.get("Sec-Fetch-Site") == "cross-site" or (origin and origin != expected_origin):
                raise error("Open CarryOn directly before saving changes.", 403, "origin_rejected")
            if request.method != "DELETE" and not request.is_json:
                raise error("Use a JSON request for changes.", 415, "json_required")

    def signed_in(user):
        token = secrets.token_urlsafe(32)
        db().execute("INSERT INTO sessions VALUES (?,?,?)", (hashlib.sha256(token.encode()).hexdigest(), user["id"], time.time() + 7 * 86400))
        db().commit()
        response = make_response({"user": {key: user[key] for key in ("id", "name", "email")}})
        response.set_cookie(COOKIE, token, max_age=7 * 86400, **cookie_options(app))
        return response

    @app.get("/api/account")
    def account():
        response = make_response({"user": g.user, "googleClientId": app.config.get("GOOGLE_CLIENT_ID", ""),
                                  "canImportDevice": app.config.get('ALLOW_DEVICE_IMPORT', True)})
        if request.cookies.get(COOKIE) and not g.user:
            response.delete_cookie(COOKIE, **cookie_options(app))
        return response

    @app.post("/api/account/register")
    def register():
        data = body()
        helpers["require_allowed"](data, {"email", "name", "password"})
        email = helpers["text_field"](data.get("email"), "Email", maximum=254).casefold()
        name = helpers["text_field"](data.get("name"), "Name", maximum=60)
        password = data.get("password")
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or not isinstance(password, str) or not 12 <= len(password) <= 256:
            raise error("Enter a valid email and a password of 12–256 characters.")
        user = {"id": secrets.token_hex(16), "email": email, "name": name}
        try:
            db().execute("INSERT INTO users VALUES (?,?,?,?)", (user["id"], email, name, generate_password_hash(password)))
            db().commit()
        except IntegrityErrors:
            db().rollback()
            raise error("An account with that email already exists. Try signing in.", 409)
        return signed_in(user), 201

    def limit_login():
        # One local IP budget also limits attempts against many email addresses.
        key, timestamp = "login:" + str(request.remote_addr), time.time()
        db().execute("DELETE FROM login_attempts WHERE reset_at<?", (timestamp,))
        db().execute("INSERT INTO login_attempts VALUES (?,0,?) ON CONFLICT DO NOTHING", (key, timestamp + 900))
        allowed = db().execute("UPDATE login_attempts SET attempts=attempts+1 WHERE key=? AND attempts<10", (key,)).rowcount
        db().commit()
        if not allowed:
            raise error("Too many sign-in attempts. Try again in 15 minutes.", 429)
        return key

    @app.post("/api/account/login")
    def login():
        key = limit_login()
        data = body()
        helpers["require_allowed"](data, {"email", "password"})
        email = str(data.get("email", "")).strip().casefold()[:254]
        password = data.get("password")
        if not isinstance(password, str) or len(password) > 256:
            raise error("Email or password was not recognized.", 401)
        row = db().execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        valid = check_password_hash(row["password_hash"] if row else app.config["DUMMY_PASSWORD_HASH"], password)
        if not row or not valid:
            raise error("Email or password was not recognized.", 401)
        db().execute("DELETE FROM login_attempts WHERE key=?", (key,)); db().commit()
        return signed_in(row)

    @app.post("/api/account/logout")
    def logout():
        token = request.cookies.get(COOKIE, "")
        db().execute("DELETE FROM sessions WHERE token_hash=? OR expires<?", (hashlib.sha256(token.encode()).hexdigest(), time.time()))
        db().commit()
        response = make_response({"user": None}); response.delete_cookie(COOKIE, **cookie_options(app))
        return response

    @app.post("/api/account/import-device")
    def import_device():
        if not app.config.get('ALLOW_DEVICE_IMPORT', True):
            raise error('Device-trip import is only available on your local installation.', 403)
        if not g.user:
            raise error("Sign in first.", 401)
        if body() != {"confirm": True}:
            raise error("Confirm moving this device's trips into your account.")
        db().execute("UPDATE trips SET owner_key=? WHERE owner_key='device' AND id!='demo-paris'", (owner_key(),))
        db().execute("INSERT INTO categories SELECT ?,name_key,name,active FROM categories WHERE owner_key='device' ON CONFLICT DO NOTHING", (owner_key(),))
        db().commit()
        return {"message": "Existing device trips moved into your account."}

    from .google_signin import register_google
    register_google(app, helpers, signed_in, limit_login)
