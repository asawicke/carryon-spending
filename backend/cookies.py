"""Consistent cookie scope, including Azure Functions' cookie serialization."""


def cookie_options(app):
    return {
        'domain': app.config.get('COOKIE_DOMAIN'),
        'secure': app.config.get('COOKIE_SECURE', False),
        'httponly': True,
        'samesite': 'Strict',
    }
