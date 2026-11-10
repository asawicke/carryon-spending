"""Explicit production settings for the Azure HTTPS reverse proxy."""
import os
from urllib.parse import urlsplit, parse_qs

from flask import redirect, request
from werkzeug.middleware.proxy_fix import ProxyFix

from .database import is_postgres


def configure_deployment(app):
    production = app.config.get('PRODUCTION', os.environ.get('CARRYON_ENV') == 'production')
    app.config['PRODUCTION'] = production
    app.config.setdefault('ALLOW_DEVICE_IMPORT', not production)
    if not production:
        return
    origin = app.config.get('PUBLIC_ORIGIN') or os.environ.get('PUBLIC_ORIGIN', '')
    if not origin and os.environ.get('WEBSITE_HOSTNAME'):
        origin = 'https://' + os.environ['WEBSITE_HOSTNAME']
    parsed = urlsplit(origin)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.path not in ('', '/') or parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise RuntimeError('Production requires PUBLIC_ORIGIN with an HTTPS origin.')
    if not is_postgres(app.config['DATABASE_PATH']):
        raise RuntimeError('Production requires a persistent PostgreSQL DATABASE_URL.')
    if parse_qs(urlsplit(app.config['DATABASE_PATH']).query).get('sslmode') != ['verify-full']:
        raise RuntimeError('Production DATABASE_URL must use sslmode=verify-full.')
    app.config.update(PUBLIC_ORIGIN=origin.rstrip('/'), COOKIE_SECURE=True,
                      ALLOW_DEVICE_IMPORT=False, TRUSTED_HOSTS=[parsed.hostname])
    # App Service terminates TLS before its private app container. Never enable
    # this trust on a server exposed directly to untrusted clients.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=0)

    @app.before_request
    def require_https():
        if not request.is_secure and request.path != '/api/health':
            return redirect(app.config['PUBLIC_ORIGIN'] + request.full_path.rstrip('?'), code=308)

    @app.after_request
    def production_headers(response):
        response.headers['Strict-Transport-Security'] = 'max-age=15552000'
        response.headers['Cross-Origin-Opener-Policy'] = 'same-origin-allow-popups'
        response.headers['Content-Security-Policy'] = (
            "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; "
            "script-src 'self' https://accounts.google.com/gsi/client; "
            "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; "
            "frame-src https://accounts.google.com/gsi/; "
            "connect-src 'self' https://accounts.google.com/gsi/; "
            "img-src 'self' data:; font-src 'self'; worker-src 'self'; form-action 'self'"
        )
        return response
