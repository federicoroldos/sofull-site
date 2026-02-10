# Security Notes

## Server-side secrets

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

## Client-safe environment variables

Client code may only use `VITE_*` variables (non-secret):

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_AUTH_EMAIL_ENDPOINT`
- `VITE_SESSION_DURATION_DAYS`

## Common leak vectors

- Committing `.env` or service account JSON files
- Logging secrets or tokens in serverless logs
- Returning sensitive fields in API responses
- Accidentally bundling server-only env vars in Vite
- Overly broad CORS (`*`) on email endpoints

## Mitigations applied

- Serverless email endpoint validates payloads and redacts sensitive log fields.
- Rate limiting is enforced per IP and per user.
- CORS is restricted to explicit allowlists (including Capacitor mobile origins).
- Client uses Firebase ID tokens for auth-email requests; no server secrets are exposed.
