# Internal Notes

This document is for development and operations only.

## Architecture

- Frontend: Vite + React, hosted as static assets (GitHub Pages).
- Auth: Firebase Authentication (Google provider).
- Storage: Google Drive AppData + Drive folders.
- Email API: Serverless endpoint (Vercel) that verifies Firebase ID tokens and sends via Brevo.

## Environment Variables

Client (Vite) variables:
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_GOOGLE_WEB_CLIENT_ID` (required for native sign-in)
- `VITE_AUTH_EMAIL_ENDPOINT` (email API URL)
- `VITE_SESSION_DURATION_DAYS` (optional, defaults to 180)
- `VITE_ACCESS_TOKEN_TTL_MS` (optional)
- `VITE_ENFORCE_ACCESS_TOKEN_EXPIRY` (optional)

Server (email API) variables:
- `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `PUBLIC_SITE_URL` (for links/logos in emails)
- `SUPPORT_EMAIL`
- `EMAIL_LOGO_URL` (optional)
- `LOGIN_EMAIL_COOLDOWN_SECONDS` (optional throttling)
- `CORS_ORIGINS`, `DEV_CORS_ORIGINS`, `ALLOW_LOCALHOST_ORIGIN`
- `AUTH_EMAIL_RATE_LIMIT_MAX`, `AUTH_EMAIL_RATE_LIMIT_WINDOW_SECONDS`

## Deployment (GitHub Pages + Vercel API)

Frontend (GitHub Pages):
- Build in GitHub Actions with `VITE_AUTH_EMAIL_ENDPOINT` pointing to the Vercel API URL.
- Example: `VITE_AUTH_EMAIL_ENDPOINT=https://sofull-site.vercel.app/api/auth-email`

Email API (Vercel):
- Set `CORS_ORIGINS=https://sofull.site` (and optionally the Vercel domain).
- Keep all email secrets in Vercel Environment Variables only.

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from the example:

```bash
cp .env.example .env
```

3. Fill in the Firebase credentials in `.env`.

4. Start the dev server:

```bash
npm run dev
```

## Android

See `ANDROID_SETUP.md` for full Android + Google Sign-In setup steps. Quick start:

```bash
npm install
npm run android:build
npm run android:open
```

For live reload on device/emulator:

```bash
npm run android:dev
npx cap run android -l --external
```

## Google OAuth + Drive Configuration

1. Create a Firebase project.
2. Enable **Google** as a Sign-in provider in Firebase Authentication.
3. In Google Cloud Console for the same project:
   - Enable the **Google Drive API**.
   - Configure the OAuth consent screen.
   - Add the scope `https://www.googleapis.com/auth/drive.appdata`.
   - Add the scope `https://www.googleapis.com/auth/drive.file`.
4. Add your local dev domain in Firebase Auth (e.g. `localhost`).
5. Copy the Firebase web app config values into `.env`:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_APP_ID`
6. Optional session duration:
   - `VITE_SESSION_DURATION_DAYS` (defaults to `180`)

## CI

- CI runs `npm run scan:secrets` to block accidental secret commits.
