# 배불러! (So Full!)

A personal food & drink log for ramyeon, snacks, drinks, and ice cream.
Try it out [here](https://sofull.site).

## What It Does

- Log entries with name, brand, category, rating, and category-specific details.
- Track ramyeon form factor (packet/cup), ice cream form factor (bar/cream), and spiciness levels.
- Add optional descriptions and images (URL or upload).
- Sort by latest, best rated, or alphabetical (Hangul/English).
- Search by name or brand.
- Edit or delete entries with confirmation.

## How It Works

This is a fully client-side app. Google Sign-In identifies the user, and a JSON file is stored
in Google Drive `appDataFolder`. The file is created on first login and updated on every change.
If you upload an image, it is stored in your Google Drive in a `배불러! (So Full!)/images` folder
and referenced by its Drive file ID. If you use an image URL, it must be `https://`.
When signed out, the app shows a demo entry to preview the layout.
Logins persist on the same device/browser profile for up to 6 months by default.

## Email Notifications

- On first sign-up, a single signup confirmation email is sent.
- Each subsequent login sends one login notification email.
- Sign-up does not also send a login email.
- Emails are branded to match the site and include privacy/terms links.
- Login emails include sign-in time, device/browser, and approximate city/country when available, plus a Google security callout.

Environment variables for email delivery:
- `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`
- `FIREBASE_SERVICE_ACCOUNT_JSON` (Firebase Admin service account JSON string)
- `PUBLIC_SITE_URL` (used for links/logos in email templates)
- `SUPPORT_EMAIL` (used in email footer)
- `EMAIL_LOGO_URL` (optional override for the header logo image; use a PNG/JPG/GIF for best email client support)
- `LOGIN_EMAIL_COOLDOWN_SECONDS` (optional throttling)
- `CORS_ORIGINS` (comma-separated allowlist for the email API, ex: `https://sofull.site`)
- `DEV_CORS_ORIGINS` (optional dev allowlist, ex: `http://localhost:5173`)
- `ALLOW_LOCALHOST_ORIGIN` (set to `true` to include common localhost origins)
- `AUTH_EMAIL_RATE_LIMIT_MAX`, `AUTH_EMAIL_RATE_LIMIT_WINDOW_SECONDS`
- `CAPTCHA_SECRET_KEY` (optional; enables CAPTCHA verification)
- `CAPTCHA_PROVIDER` (`hcaptcha` or `recaptcha`), `CAPTCHA_VERIFY_URL` (optional override), `CAPTCHA_MIN_SCORE` (optional)

## Deployment (GitHub Pages + Vercel API)

The app is static and can be hosted on GitHub Pages, while the email API
(`api/auth-email`) must be hosted on a serverless provider (Vercel).

Frontend (GitHub Pages):
- Build in GitHub Actions with `VITE_AUTH_EMAIL_ENDPOINT` pointing to the Vercel API URL.
- Example: `VITE_AUTH_EMAIL_ENDPOINT=https://sofull-site.vercel.app/api/auth-email`

Email API (Vercel):
- Set `CORS_ORIGINS=https://sofull.site` (and optionally the Vercel domain).
- Keep all email secrets in Vercel Environment Variables only.

Security notes:
- Server-side secrets (Brevo + Firebase Admin) must live only in Vercel Environment Variables.
- Prefer Vercel "Sensitive" environment variables for secrets so values are write-only after creation.
- Never commit `.env`, service account JSON files, or private keys to the repository.
- Client-side env vars must use the `VITE_` prefix and must never contain secrets.
- The email API defaults to 5 requests per 10 minutes per IP unless overridden.

Secret rotation checklist (if a leak is suspected):
1. Revoke and recreate the Brevo API key, then update the Vercel environment variable.
2. Rotate the Firebase Admin service account key and update `FIREBASE_SERVICE_ACCOUNT_JSON` in Vercel.
3. Review recent deployments, Vercel logs, and Git history for exposure.
4. Redeploy to ensure new secrets are in use.
5. If needed, invalidate user sessions in Firebase Auth.

## Idea Evolution

This started as a tiny ramyeon-only list to remember favorite packs and cups. Once it was useful
for rankings and rebuys, it expanded to cover snacks, drinks, and ice cream so the same workflow
could capture the full convenience-store haul. Ratings and attribute tags made comparisons easier,
Drive-based storage kept the data private and portable, and image support turned the log into a
memory of what each item looked like.

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

See `ANDROID_SETUP.md` for full instructions (Firebase setup, SHA-1, emulator/device, APK/AAB).

Quick commands:
- `npm install`
- `npm run android:build`
- `npm run android:open`
- `npm run android:apk`
- `npm run android:aab`

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

## Notes

- If you refresh and Drive actions stop working, sign out and sign back in to refresh the access token.
- For security, image URLs must use `https://` (non-HTTPS URLs are rejected).
- Persistent login is device/browser-specific; a new device or profile will require a fresh sign-in.
- CI runs `npm run scan:secrets` to block accidental secret commits.
