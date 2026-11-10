"""Production entry point; Azure runs this behind its HTTPS frontend."""
from backend.app import create_app

app = create_app()
