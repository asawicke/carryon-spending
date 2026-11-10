# Azure student pilot

CarryOn uses one **Azure Functions Flex Consumption** app and one **Azure Database for PostgreSQL** server in **North Central US**, plus private package storage. The initial App Service and Static Web Apps choices were blocked by the student subscription's quotas/region policy and are not deployed.

## Runtime and data

- React and Flask share one HTTPS origin. `function_app.py` uses Microsoft's WSGI adapter; `host.json` preserves Flask routes. Azure runs Python 3.12 and manages the worker, so Gunicorn is not the hosted entry point.
- The app scales to zero with no always-ready instances. Its maximum-instance cap is two, not two reserved servers.
- Local development keeps SQLite. Production requires PostgreSQL with `sslmode=verify-full`, verified CA certificates, secure HttpOnly session cookies, trusted-host checks, HTTPS and a Content Security Policy.
- Cloud data starts empty; no personal local databases or backups are uploaded. Cloud device-trip import is disabled. Accounts own their trips, expenses and custom categories.
- The database uses PostgreSQL 16, one burstable B1ms instance, 32 GB storage without auto-growth, and seven days of backups. The application login has no superuser, role-creation or database-creation privileges. Azure's default `public` schema requires explicit `USAGE, CREATE` permission for that login.
- The app uses `vnet-carryon-pilot/functions` and a private PostgreSQL endpoint at `10.77.0.36`, with private DNS. This avoids changing serverless egress IPs. Public database access will be disabled after live verification; the temporary laptop/firewall rules are not required for the hosted app.
- Capped Azure Monitor startup logs are configured separately from user records. Never log passwords, provider keys, tokens or request bodies.

## Cookie compatibility

Azure Functions serialized host-only cookies with an empty domain, so clients rejected them. Production cookies explicitly use the exact app hostname; the same scope and secure attributes apply to creation and deletion of session and Google nonce cookies. Local cookies remain host-only. Deployment checks verify this behavior.

## Private app settings

Set these in the Azure function app configuration, never the frontend or Git:

| Setting | Value |
|---|---|
| `CARRYON_ENV` | `production` |
| `DATABASE_URL` | Private app-login URI ending with `?sslmode=verify-full` |
| `PUBLIC_ORIGIN` | Actual HTTPS website origin |
| `IGNAV_API_KEY` | Private flight-provider key |
| `IGNAV_DAILY_LIMIT` | `10`, shared across users |
| `FLIGHT_PROVIDER` | `ignav` |
| `GOOGLE_CLIENT_ID` | Optional web client ID after Google setup |

The function runtime manages storage settings. Flex deployments use `--build-remote true`; do not add App Service/Oryx build settings intended for other hosting plans.

## Archive permissions

Package entries must use `0644`. Python ZIP defaults (`0600`) caused Azure to reject `host.json` because the build and runtime use different users. The packager normalizes non-secret files and a regression check verifies every entry. Private configuration is supplied separately through Azure settings.

## Verify and release

```sh
python -m pip install -r requirements.txt
python -m unittest discover -s backend/tests -v
npm ci --prefix frontend
npm test --prefix frontend
npm run build --prefix frontend
python scripts/package_deployment.py /tmp/carryon-deploy.zip
az functionapp deployment source config-zip --name carryon-spending-asawicke --resource-group rg-carryon-student --subscription e74af78f-6a46-4955-b048-1ea528267acb --src /tmp/carryon-deploy.zip --build-remote true
```

The packaging allowlist excludes `.env`, databases, test accounts and unrelated project files. GitHub's verification workflow runs real PostgreSQL tests in disposable schemas and produces an archive. Deployment is currently manual; automatic production releases are not enabled.

After release, check `/api/health`, create a test account/trip/expense, verify account isolation, restart the app, and confirm saved data remains. Keep database backups independent of source releases; code rollback does not reverse migrations.

## Pilot costs and status

Use only the personal **Azure for Students** subscription; spending protection was confirmed **On**. No payment card or pay-as-you-go upgrade was added. PostgreSQL, storage and logs can consume the student credit even with little traffic. Credit exhaustion/expiration can suspend service; review usage during the three-month pilot.

**Live verification is pending.** The host exists at `https://carryon-spending-asawicke.azurewebsites.net`, but a provisioned hostname is not proof of a working app. Google sign-in code exists; its client configuration and a real login are also pending.

## Official references

- [Flask through Azure Functions](https://learn.microsoft.com/en-us/samples/azure-samples/flask-app-on-azure-functions/azure-functions-python-create-flask-app/)
- [Flex Consumption setup, deployment and diagnostics](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-how-to)
- [Function IP addresses and scaling](https://learn.microsoft.com/en-us/azure/azure-functions/ip-addresses)
- [PostgreSQL flexible server](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/quickstart-create-server)
