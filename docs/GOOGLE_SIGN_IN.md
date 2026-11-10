# Google sign-in setup

Email/password sign-in works immediately. The hosted pilot now has a Google web client configured in project `carryon-spending`; a real Google login still needs verification by a consenting user. The initial hosted check rendered the official Google button and passed the server challenge/cookie checks, but Google returned an origin-not-allowed message despite the exact origin being saved. Google’s console warns that new settings may take five minutes to a few hours to apply. Retry after propagation; do not mark real sign-in verified until a consented login succeeds.

Authorized pilot origins are `https://carryon-spending-asawicke.azurewebsites.net`, `http://127.0.0.1:5050`, and `http://localhost:5050`. The client uses the External testing audience and basic identity only. Google documents an exception to the test-user allowlist for apps requesting only `openid`, `email`, and `profile`; university administrator restrictions can still apply. No sensitive Google API access is requested.

## Enable it locally

1. Open [Google Auth Platform](https://console.developers.google.com/auth/clients), select or create your team's project, and configure the app's branding and audience. For apps requesting more than basic identity, configure the appropriate test-user allowlist. A university-only internal audience requires an eligible university-managed project; otherwise choose the appropriate external audience.
2. Create an OAuth client with application type **Web application**. Add the exact origins you use under **Authorized JavaScript origins**:
   - `http://localhost:5050`
   - `http://127.0.0.1:5050`
   - For Vite development, also add its actual printed origin, for example `http://localhost:5173`.
3. Set `GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com` in your existing `.env`, keeping the flight key intact. The client ID is public; this Google Identity Services popup flow does **not** need a client secret or redirect callback URL.
4. Install the updated Python requirements, rebuild the frontend, restart Flask, and open CarryOn at one of those authorized origins:

   ```sh
   source .venv/bin/activate
   python -m pip install -r backend/requirements.txt
   npm ci --prefix frontend
   npm run build --prefix frontend
   PORT=5050 python -m backend.app
   ```

The official Google button replaces the disabled setup placeholder. Only identity information is requested; this feature does not request Drive, Gmail or Calendar access. Configure production HTTPS origins separately when deploying. Google or university account policies may restrict which users can authorize your app.

## What the implementation does

- `GoogleSignIn.jsx` loads Google's hosted library only when configured, renders its official button, and submits the returned credential through a same-origin JSON request. Email sign-in remains usable if the script or Google is unavailable.
- The server creates a 30-minute random challenge bound to an HttpOnly, SameSite cookie and database record. The signed token's nonce must match; successful challenges are consumed atomically to prevent reuse.
- `google-auth` checks the Google signature, issuer, intended client and expiration. The adapter also requires the nonce, subject and verified email, uses an eight-second transport timeout, and reuses the local sign-in attempt limit.
- The stable Google subject maps to a local account with isolated trips and the existing revocable session cookie. Provider credentials are neither logged nor stored. A matching email **never automatically merges accounts**: an existing password account must continue using its password; linking is not implemented.
- The hosted PostgreSQL database keeps the same account’s trips available across browsers. Local SQLite data is separate. Account recovery and email verification for password-created accounts are not included. Reloading the app while the server is unavailable shows the connection message on the login page; an already open workspace can still queue expenses offline.

## Verification

Automated checks cover the default auth gate, session revocation and restart, invalid audience/issuer/expiration/nonce, unverified email, consumed challenges, account collision, invalid-token rejection and provider downtime using isolated fixtures. These checks do not claim that a live Google popup has succeeded.

After setup, manually verify: create a Google account session; reload and confirm its trips remain; sign out and confirm the login screen; sign back in; try another Google account and confirm trip isolation; block the Google script and confirm email sign-in still works. Use a separate test database for these checks.

## Official references consulted November 10, 2026

- [Google Identity Services setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)
- [Server-side ID-token verification and existing account handling](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)
- [JavaScript initialization, nonce and button reference](https://developers.google.com/identity/gsi/web/reference/js-reference)
- [Google testing audiences and identity-only exception](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)
