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

## Email Notifications

- On first sign-up, a single signup confirmation email is sent.
- Each subsequent login sends one login notification email.
- Sign-up does not also send a login email.
- Emails are branded to match the site and include privacy/terms links.
- Login emails include sign-in time, device/browser, and approximate city/country when available, plus a Google security callout.

Environment variables for email delivery:
- `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`
- `PUBLIC_SITE_URL` (used for links/logos in email templates)
- `SUPPORT_EMAIL` (used in email footer)
- `EMAIL_LOGO_URL` (optional override for the header logo image; use a PNG/JPG/GIF for best email client support)
- `LOGIN_EMAIL_COOLDOWN_SECONDS` (optional throttling)

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

## Notes

- If you refresh and Drive actions stop working, sign out and sign back in to refresh the access token.
- For security, image URLs must use `https://` (non-HTTPS URLs are rejected).
