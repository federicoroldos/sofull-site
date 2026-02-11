# 배불러! (So Full!)

A personal food & drink log for ramyeon, snacks, drinks, and ice cream.
Try it out [here](https://sofull.site).

Release: 1.0 (public)

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

Login emails include sign-in time, device name/model when available, device/browser, and approximate city/country.

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
