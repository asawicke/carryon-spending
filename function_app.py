"""Expose the existing Flask PWA through Azure Functions' supported WSGI adapter."""
import azure.functions as func

from wsgi import app as flask_app

# Authentication remains in Flask; anonymous here lets the sign-in page load.
app = func.WsgiFunctionApp(app=flask_app.wsgi_app, http_auth_level=func.AuthLevel.ANONYMOUS)
