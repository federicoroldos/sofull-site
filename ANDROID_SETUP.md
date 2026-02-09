# Android Setup (Capacitor)

This project ships the Android app by wrapping the existing Vite + React app with Capacitor.

## Prerequisites

- Node.js + npm
- Android Studio (includes Android SDK + platform tools)
- Java JDK 17+

## 1) Install dependencies

```bash
npm install
```

## 2) Configure Firebase + Google Sign-In

This app uses Firebase Auth (Google provider) plus Google Drive scopes. The Android app must use the **same** Firebase project as the web app (do not create a new Firebase project).

1. In Firebase Console, add a new **Android app** inside the **existing** Firebase project used by the web app.
   - Package name must match `appId` in `capacitor.config.ts` (default `com.sofull.app`).
   - Download `google-services.json` and place it at `android/app/google-services.json`.

2. In Firebase Authentication, enable **Google** as a sign-in provider.

3. In Google Cloud Console for the same project:
   - Enable the **Google Drive API**.
   - Configure the OAuth consent screen.
   - Ensure the following scopes are enabled for your app:
     - `https://www.googleapis.com/auth/drive.appdata`
     - `https://www.googleapis.com/auth/drive.file`

4. Add SHA-1 fingerprints for Android:
   - Debug keystore (default):
     ```bash
     keytool -list -v -keystore %USERPROFILE%\.android\debug.keystore -alias androiddebugkey -storepass android -keypass android
     ```
   - Release keystore (use your release keystore path + alias).
   - Add these SHA-1 values in **Firebase Console > Project Settings > Your Android App**.

5. Ensure the Android OAuth client is created in the Google Cloud Console for the same package name + SHA-1.

## 3) Environment variables

Create `.env` from `.env.example` and set:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_AUTH_EMAIL_ENDPOINT`

For Android builds, `VITE_AUTH_EMAIL_ENDPOINT` should be a **full HTTPS URL** to your serverless endpoint, for example:

```
VITE_AUTH_EMAIL_ENDPOINT=https://sofull-site.vercel.app/api/auth-email
```

## 4) Sync Capacitor

```bash
npm run android:build
```

This builds the web app and syncs it into the Android project.

## 5) Run on emulator or device

- Terminal 1 (dev server):
  ```bash
  npm run dev
  ```
- Terminal 2 (Capacitor live reload):
  ```bash
  npm run android:dev
  ```

If you prefer static builds:

```bash
npm run android:build
npm run android:open
```

Then run from Android Studio.

## 6) Build APK / AAB

- Debug APK:
  ```bash
  npm run android:apk
  ```
  Output: `android/app/build/outputs/apk/debug/app-debug.apk`

- Release AAB (requires signing config in `android/app/build.gradle`):
  ```bash
  npm run android:aab
  ```
  Output: `android/app/build/outputs/bundle/release/app-release.aab`

## Troubleshooting

- **Blank screen on device**: Ensure `VITE_AUTH_EMAIL_ENDPOINT` is HTTPS and reachable.
- **Google Sign-In fails**: Verify the Android package name and SHA-1 in Firebase Console.
- **Drive API errors**: Confirm the Drive API is enabled and the OAuth consent screen is published.
- **CORS errors**: The email API allows `capacitor://localhost` and `http://localhost` by default. For custom domains, add them to `CORS_ORIGINS` on the serverless provider.
