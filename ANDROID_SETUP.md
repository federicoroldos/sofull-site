# Android Setup (So Full!)

This project ships an Android app via Capacitor (WebView wrapper) so the same React + TypeScript app runs on Android with the same Google Drive storage format.

## Prereqs

- Android Studio (SDK + Emulator)
- JDK 17+
- Node.js + npm

## App ID / Package Name

- Default: `com.sofull.site`
- If you change it, update `capacitor.config.ts` and recreate the Android OAuth client in Google Cloud.

## Environment Variables

Update `.env` (based on `.env.example`):

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_GOOGLE_WEB_CLIENT_ID` (required for Android Google Sign-In)
- `VITE_AUTH_EMAIL_ENDPOINT` (use a full HTTPS URL for Android builds)

If you host `api/auth-email` yourself, allow Capacitor origins in CORS (`http://localhost` and `capacitor://localhost`). The API already defaults to these in `api/auth-email.js`.

## Google Cloud + Firebase Setup (Android)

1. Use the same Google Cloud/Firebase project already used by the web app.
2. Enable **Google Drive API**.
3. Configure OAuth consent screen and add these scopes:
   - `https://www.googleapis.com/auth/drive.appdata`
   - `https://www.googleapis.com/auth/drive.file`
4. Firebase Auth:
   - Enable **Google** as a sign-in provider.
5. Create OAuth Client IDs:

### A) Web client ID (required by the Android plugin)

- Create **OAuth Client ID ? Web application**.
- Copy the **Client ID** into `.env` as `VITE_GOOGLE_WEB_CLIENT_ID`.

### B) Android client ID

- Create **OAuth Client ID ? Android**.
- Package name: `com.sofull.site` (or your custom appId).
- SHA-1 fingerprint:

Debug keystore (Windows):

```bash
keytool -list -v -alias androiddebugkey -keystore %USERPROFILE%\.android\debug.keystore -storepass android -keypass android
```

Debug keystore (macOS/Linux):

```bash
keytool -list -v -alias androiddebugkey -keystore ~/.android/debug.keystore -storepass android -keypass android
```

Release keystore (example):

```bash
keytool -genkeypair -v -keystore sofull-release.keystore -alias sofull -keyalg RSA -keysize 2048 -validity 10000
keytool -list -v -alias sofull -keystore sofull-release.keystore
```

Use the SHA-1 in Google Cloud for the Android OAuth client.

## Build & Run

Install deps:

```bash
npm install
```

Build + sync Android assets:

```bash
npm run android:build
```

Open Android Studio:

```bash
npm run android:open
```

Run on emulator/device (CLI):

```bash
npx cap run android
```

### Live reload (dev server)

Terminal 1:

```bash
npm run android:dev
```

Terminal 2:

```bash
npx cap run android -l --external
```

## APK / AAB

From `android/`:

Debug APK:

```bash
./gradlew assembleDebug
```

Release AAB:

```bash
./gradlew bundleRelease
```

For release builds, configure signing in `android/app/build.gradle` (keystore, key alias, passwords).

## Icons

The Android icons are generated from the web favicon:

- Source: `public/favicon.svg`
- Working copy: `assets/logo.svg`

To regenerate icons:

```bash
npx @capacitor/assets generate --android --iconBackgroundColor "#ffffff" --splashBackgroundColor "#ffffff"
```
