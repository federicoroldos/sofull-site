# Ramyeon Dictionary

A personal dictionary for Korean ramyeon noodles with Google sign-in and Google Drive persistence.

## Features

- Dictionary-style list of ramyeon entries with name, brand, form factor, rating, and spiciness.
- Google sign-in to uniquely identify each user.
- Google Drive `appDataFolder` sync (JSON file auto-created and updated on every change).
- CRUD operations: add, edit, delete entries with confirmation.
- 5-star rating with half-star support.
- Sorting: alphabetical (Korean or English) and best rated.
- Optional search by name or brand.

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

This project follows the same Firebase + Google Drive appDataFolder flow used in the reference project.

1. Create a Firebase project.
2. Enable **Google** as a Sign-in provider in Firebase Authentication.
3. In Google Cloud Console for the same project:
   - Enable the **Google Drive API**.
   - Configure the OAuth consent screen.
   - Add the scope `https://www.googleapis.com/auth/drive.appdata`.
4. Add your local dev domain in Firebase Auth (e.g. `localhost`).
5. Copy the Firebase web app config values into `.env`:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_APP_ID`

## Data Storage

Ramyeon data is stored as a JSON file inside the user's Google Drive `appDataFolder`.
The file is created automatically on first login and updated on every create, edit, or delete.

## Notes

- If you refresh and Drive actions stop working, sign out and sign back in to refresh the access token.
- The app includes a demo entry when signed out to show the layout.
