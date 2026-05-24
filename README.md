# 배불러! (So Full!)

[![Pages deploy](https://github.com/federicoroldos/sofull-site/actions/workflows/pages.yml/badge.svg)](https://github.com/federicoroldos/sofull-site/actions/workflows/pages.yml)
[![Live demo](https://img.shields.io/badge/live-sofull.site-d1553d?style=flat)](https://sofull.site)
[![Built with](https://img.shields.io/badge/built%20with-React%20%7C%20Vite%20%7C%20Capacitor-1f2a2e?style=flat)](#tech-stack)

A personal food & drink log for ramyeon, snacks, drinks, and ice cream.
Try it out [here](https://sofull.site).

Release: 1.0 (public)

## Screenshots

Screenshots live in [`docs/screenshots/`](docs/screenshots/). See that folder's
README for the expected filenames and sizing; once the captures are dropped in,
uncomment the table below.

<!--
| Web (list view) | Web (add entry) | Android |
| --- | --- | --- |
| ![Web list](docs/screenshots/web-list.png) | ![Add entry modal](docs/screenshots/web-add.png) | ![Android home](docs/screenshots/android.png) |
-->


## Tech stack

- Frontend: Vite + React + TypeScript, deployed to GitHub Pages.
- Auth: Firebase Authentication (Google provider) with silent token refresh via Google Identity Services on web and Capacitor SocialLogin on Android.
- Storage: each user's own Google Drive. JSON catalog in the app's appdata folder, photos in a visible folder.
- Email: a single Vercel serverless function that verifies Firebase ID tokens, dedups via Firestore, and sends transactional emails through Resend.
- Mobile: Capacitor wrapper for Android, distributed through Google Play.

## Highlights

- Log entries with name, brand, category, rating, and category-specific details.
- Track ramyeon form factor (packet/cup), ice cream form factor (bar/cream), and spiciness levels.
- Add optional descriptions and images (URL or upload).
- Sort by latest, best rated, or alphabetical (Hangul/English).
- Search by name or brand.
- Edit or delete entries with confirmation.
- Email notifications for first sign-in and subsequent logins.

## How Data Works

- The app is fully client-side. Google Sign-In identifies the user.
- A JSON file is stored in Google Drive `appDataFolder` using the `drive.appdata` scope.
- Uploaded images are stored in your Google Drive in `배불러! (So Full!)/images` using the `drive.file` scope.
- When signed out, the app shows demo entries to preview the layout.
- Login sessions are stored locally (browser local storage) and default to 180 days.

## Email Notifications

The app calls a serverless endpoint (`api/auth-email`) to send:

- A welcome email on first sign-in.
- A login notification email on subsequent sign-ins.

Login emails include sign-in time, browser, approximate city/country, and a best-effort device label built from the client device model, OS, and device type when the platform exposes that metadata.
Examples: `iPhone`, `Android tablet`, `Samsung SM-T870`, `Windows PC`, `Mac`.

## Hosting

- Frontend: GitHub Pages.
- Email API: Vercel.

## Security & Privacy

- Security practices: see `SECURITY.md`.
- Privacy Policy: `public/privacy.html`.
- Terms of Service: `public/terms.html`.

## Support

For bugs or security issues, contact `support@sofull.site`.

## Notes

- If Drive actions stop working, sign out and sign back in to refresh the access token.
- Image URLs must use `https://` (non-HTTPS URLs are rejected).
- Persistent login is device/browser-specific; a new device or profile will require a fresh sign-in.
