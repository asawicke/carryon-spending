"""Load only supported local configuration; never execute a .env file as code."""
import os
from pathlib import Path


def load_local_environment():
    path = Path(__file__).resolve().parent.parent / ".env"
    if not path.exists():
        return
    allowed = {"IGNAV_API_KEY", "IGNAV_DAILY_LIMIT", "FLIGHT_PROVIDER", "AIRLABS_API_KEY",
               "AIRLABS_MONTHLY_LIMIT", "CARRYON_DB_PATH", "PORT", "COOKIE_SECURE", "GOOGLE_CLIENT_ID",
               "DATABASE_URL", "CARRYON_ENV", "PUBLIC_ORIGIN"}
    for line in path.read_text().splitlines():
        key, separator, value = line.strip().partition("=")
        if separator and key in allowed:
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            os.environ.setdefault(key, value)
