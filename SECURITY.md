# Security Policy

Effective date: February 11, 2026

## Reporting a Vulnerability

Please report security issues by emailing **support@sofull.site** with:

- A clear description of the issue and impact.
- Steps to reproduce (including any proof-of-concept).
- Affected URLs, endpoints, or versions.

We will acknowledge reports and work on a fix as quickly as possible. Please do not publicly disclose issues until we confirm a resolution.

## Supported Versions

Only the latest production release is supported. Older builds may not receive security updates.

## Server-Side Secrets

These must **only** live in the serverless environment (Vercel or equivalent):

- `BREVO_API_KEY`
- `BREVO_SENDER_EMAIL`
- `BREVO_SENDER_NAME`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `SUPPORT_EMAIL`
- `EMAIL_LOGO_URL`
- `LOGIN_EMAIL_COOLDOWN_SECONDS`
- `AUTH_EMAIL_RATE_LIMIT_MAX`, `AUTH_EMAIL_RATE_LIMIT_WINDOW_SECONDS`
- `CORS_ORIGINS`, `DEV_CORS_ORIGINS`, `ALLOW_LOCALHOST_ORIGIN`
- `PUBLIC_SITE_URL`, `SITE_URL`, `APP_BASE_URL`

These **must never** be bundled into client assets or committed to Git.

## Client-Safe Environment Variables

Client code may only use `VITE_*` variables (non-secret):

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_GOOGLE_WEB_CLIENT_ID`
- `VITE_AUTH_EMAIL_ENDPOINT`
- `VITE_SESSION_DURATION_DAYS`
- `VITE_ACCESS_TOKEN_TTL_MS`
- `VITE_ENFORCE_ACCESS_TOKEN_EXPIRY`

## Common Leak Vectors

- Committing `.env` files or service account JSON files.
- Logging secrets or tokens in serverless logs.
- Returning sensitive fields in API responses.
- Accidentally bundling server-only env vars in Vite.
- Overly broad CORS (`*`) on email endpoints.

## Mitigations Applied

- Serverless email endpoint validates payloads and redacts sensitive log fields.
- Rate limiting is enforced per IP and per user.
- CORS is restricted to explicit allowlists (including Capacitor mobile origins).
- Client uses Firebase ID tokens for auth-email requests; no server secrets are exposed.

## If You Suspect a Leak

1. Revoke and recreate the Brevo API key, then update the serverless environment variable.
2. Rotate the Firebase Admin service account key and update `FIREBASE_SERVICE_ACCOUNT_JSON`.
3. Review deployments, logs, and Git history for exposure.
4. Redeploy to ensure new secrets are in use.
5. If needed, invalidate user sessions in Firebase Auth.
