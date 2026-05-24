# CLAUDE.md

Onboarding notes for future agents (and future-me) working on this repo. Keep this file up to date when the architecture, conventions or commands change. Treat anything stated here as load-bearing.

## Purpose

배불러! (So Full!) is a personal food + drink log focused on Korean ramyeon, snacks, drinks and ice cream. The whole product is single-user: each Google account stores its own catalog in its own Google Drive. There is **no shared backend database**, no multi-user logic, no admin. The serverless API exists only to send transactional emails.

Live site: https://sofull.site
Public release: 1.0
Android: packaged via Capacitor, ships through Google Play (internal track today).

## Tech stack

- **Frontend**: Vite 7 + React 19 + TypeScript 5.9, static build deployed to GitHub Pages.
- **Auth**: Firebase Authentication (Google provider). Web uses `signInWithPopup`; Android uses `@capgo/capacitor-social-login` then `signInWithCredential`.
- **Storage**: Google Drive
  - JSON catalog file in `appDataFolder` (scope `drive.appdata`), filename `sofull.json` (legacy migration from `ramyeon-dictionary.json`).
  - User-visible folder `배불러! (So Full!)/images/` for uploads (scope `drive.file`).
- **Email API**: Single Vercel serverless function (`api/auth-email.js`). Verifies Firebase ID tokens, dedups via Firestore, sends welcome/login emails via Resend.
- **Mobile**: Capacitor 8, Android only. Uses `@capacitor/device` for native model/manufacturer metadata.
- **Device-name lookup**: `@naverpay/device-info` catalog for marketing names (Android codes → e.g. "Galaxy S21").

## Repo layout

```
/api/auth-email.js          Vercel serverless function (welcome + login mailer)
/src/
  App.tsx                   Single-component app shell (entry list, sync, modals)
  firebase.ts               Firebase app init from VITE_FIREBASE_* env vars
  main.tsx                  React entry point
  index.css                 All styles (single stylesheet)
  hooks/useGoogleAuth.ts    Auth state machine: web + native, token TTL, session restore
  components/               Presentational React components
    EntryCard.tsx           One row in the list
    EntryFormModal.tsx      Create/edit modal (largest component, ~450 lines)
    AttributeMeter.tsx      Spice/crunch/sweet/creamy meter
    IconRating.tsx          Star/pepper picker
    RatingStars.tsx         Read-only star row
  utils/
    googleDriveClient.ts    Thin fetch wrappers over Drive v3 REST API
    sanitize.ts             Input sanitization + legacy-entry normalization
    attribute.ts            Category → attribute label/icon mappings
    deviceMetadata.ts       Client-side device detection (UA + UA-CH + Capacitor Device)
  types/sofull.ts           Core types: SofullEntry, SofullDataFile, enums
/scripts/
  scan-secrets.mjs          CI guard: scans `git ls-files` for known secret patterns
  android-release-internal.mjs  Local one-shot release to Play internal track
/android/                   Capacitor Android wrapper (gradle project)
/public/                    Static assets, including privacy.html, terms.html, CNAME
/.github/workflows/
  pages.yml                 Build + deploy to GitHub Pages
  android-debug.yml         Debug APK on every PR
  android-release-aab.yml   Build signed AAB artifact (manual)
  android-release-internal.yml  Build + upload to Play internal track (manual)
```

Two doc files already exist alongside this one:
- `README.md` — user-facing description.
- `INTERNALS.md` — env vars, deployment topology, OAuth setup.
- `ANDROID_SETUP.md` — keystores, fingerprints, Play console.
- `SECURITY.md` — security policy / disclosure.
- `TODO.md` — punch list of known issues and the polish roadmap. **Read this before starting work.**

## Data model

The Drive JSON file is the single source of truth for entries:

```ts
interface SofullDataFile {
  version: number;       // currently 1
  updatedAt: string;     // ISO 8601
  entries: SofullEntry[];
}

interface SofullEntry {
  id: string;
  name: string;          // Korean (primary)
  nameEnglish?: string;
  brand: string;
  category: 'ramyeon' | 'snack' | 'drink' | 'ice_cream';
  formFactor: 'packet' | 'cup';          // ramyeon-only in UX
  iceCreamFormFactor: 'bar' | 'cream';   // ice-cream-only in UX
  rating: number;                        // 1..5, half-step
  spiciness: 'not-spicy'|'mild'|'medium'|'hot'|'extreme';  // also reused as crunch/sweet/creamy meter
  description?: string;
  imageUrl?: string;                     // HTTPS-only, validated by sanitize.ts
  imageDriveFileId?: string;             // file in user's Drive folder
  imageMimeType?: string;
  imageName?: string;
  createdAt: string;
  updatedAt: string;
}
```

Note: `spiciness` is **overloaded** — for non-ramyeon categories the same enum represents crunchiness/sweetness/creaminess. The label and icon are derived from `category` via [src/utils/attribute.ts](src/utils/attribute.ts). Don't add per-category fields; this is intentional and the renderer already handles it.

## Auth & session model

There are **two independent clocks** the user can lose. Always treat them as separate:

1. **Firebase session** — 180 days (configurable via `VITE_SESSION_DURATION_DAYS`). Persisted via `browserLocalPersistence` + `sofull-google-session-start` in localStorage. This is what gates "are you logged in".
2. **Google Drive access token** — ~50 min TTL (`VITE_ACCESS_TOKEN_TTL_MS`, default 3,000,000ms). This is what gates "can you read/write Drive". Stored as `sofull-google-access-token` in localStorage with `{ token, storedAt, expiresAt }` shape.

`isLoggedIn` is platform-dependent ([App.tsx:185](src/App.tsx#L185)):
- **Web**: `Boolean(user && accessToken)` — token loss boots you out of write UI.
- **Native**: `Boolean(user)` — token can be silently refreshed, so UI stays "logged in" even mid-refresh.

### Web flow

1. `signInWithPopup` → Firebase user + Google access token.
2. `shouldSendLoginEmail` checks a per-device entry in Firestore (`users/{uid}/devices/{deviceId}`) to decide whether to ping the email API. Device ID is a random UUID stored in `sofull-web-device-id`. The same gate runs on Android, keyed off `sofull-native-device-id` (resolved from `Capacitor.Device.getId()` with UUID fallback) — see "Email API" below for the dedup chain.
3. **Silent token refresh**: GIS token client (`google.accounts.oauth2.initTokenClient`) is used to refresh the Drive access token without a popup. Triggered both proactively (~5 min before expiry) and reactively (when the polling effect detects expiry). Requires `VITE_GOOGLE_WEB_CLIENT_ID` to be present at build time — without it, silent refresh degrades and the modal falls back to `signIn`. The GIS script is loaded from `https://accounts.google.com/gsi/client` in `index.html`, and the CSP already allows the relevant hosts.
4. If silent refresh fails (consent revoked, user signed out of Google, etc.), `tokenExpired=true` shows the **"Reconnect Google Drive"** modal. Clicking Reconnect calls `reconnectDrive()` which retries silent first, then `prompt: 'consent'` interactive, then falls back to full `signIn`.

### Android flow

1. `SocialLogin.initialize` (once per process) → `SocialLogin.login` with **empty scope list** first (just sign-in).
2. Then a second `SocialLogin.login` with the Drive scopes. The second call's email **must** match the first (`GOOGLE_ACCOUNT_MISMATCH_MESSAGE`); mismatches force a logout. This is the fix from commit `115f9e9`.
3. `notifyAuthEmail` is called after both prompts succeed.
4. Silent refresh runs every 10 min and on `user` change. It tries `SocialLogin.refresh` then falls back to `SocialLogin.getAuthorizationCode`. All native calls are wrapped in `withTimeout(15s)` ([useGoogleAuth.ts:66](src/hooks/useGoogleAuth.ts#L66)) — that fix landed in commit `368041a` to stop app-resume hangs.
5. If the user cancels the Drive prompt, `androidDriveScopeGranted` goes false. Subsequent refreshes request only `BASIC_SCOPES` until the user retries via the refresh button.

### Drive operation pattern

App-level Drive calls go through `runDriveOperationWithScopeRetry` ([App.tsx:198-214](src/App.tsx#L198-L214)). If a `403 scope insufficient` is thrown on Android, it reprompts for Drive scope once and retries. Use this wrapper for any new Drive call; don't `fetch` directly.

## Email API (`api/auth-email.js`)

Single endpoint, POST `/api/auth-email`. Auth is `Authorization: Bearer <firebase-id-token>`.

Pipeline:
1. CORS check against `resolveAllowedOrigins()` (env-driven + Capacitor schemes).
2. Rate limit twice (IP, then UID), using an in-memory `Map`. Limits are per-instance, so Vercel cold starts effectively reset them.
3. Verify ID token via firebase-admin.
4. Load `email_state/{uid}` from Firestore. Compute plan via `computeEmailPlan({ state, now, authTimeMs, loginCooldownMs })`:
   - `welcomeSent` flag controls the welcome email — sent once per account, ever.
   - `authTimeMs` (from the ID token's `auth_time`) dedupes the login email — if the incoming `auth_time` ≤ stored `lastAuthEventTime`, it's a duplicate.
   - `LOGIN_EMAIL_COOLDOWN_SECONDS` adds optional cooldown when `auth_time` is unavailable.
5. For each email type to send, `claimEmailEventInState` runs a transaction that writes a pending event keyed by `${type}_${authTimeMs|now}`. If the same event already exists in non-failed state, the send is skipped (idempotency).
6. Send via Resend (`https://api.resend.com/emails`). On failure, mark the event as `failed` and return 502.
7. On success, merge `welcomeSent`, `lastLoginEmailAt`, `lastAuthEventTime`, and `emailEvents` updates into Firestore.

The HTML email layout is hand-built (no template engine), uses the brand palette in `COLORS`, and renders a meta table with time/device/browser/location.

### Device-label rendering

Server-side: `formatDeviceLabel` calls `mapToMarketingName` against `@naverpay/device-info` to translate codenames like `SM-G991B` → `Galaxy S21`. Client sends hints via `X-Client-*` headers (from `utils/deviceMetadata.ts`); server falls back to UA parsing if hints are missing.

## Commands

```bash
# Dev
npm install
npm run dev                        # vite, port 5173

# Build / lint / secrets
npm run build                      # tsc -b && vite build
npm run lint
npm run scan:secrets               # CI-equivalent secret scan

# Android
npm run android:dev                # vite --host (for live reload on device)
npm run android:build              # build web + cap sync android
npm run android:open               # opens Android Studio
npm run android:release:internal   # build signed AAB + upload to Play internal
```

`vite.config.ts` flips `base` to `./` when `CAPACITOR=true` (relative paths for WebView).

## Environment variables

Client (Vite, must be prefixed `VITE_`):
- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`
- `VITE_GOOGLE_WEB_CLIENT_ID` — required for native sign-in AND for web silent token refresh via GIS.
- `VITE_AUTH_EMAIL_ENDPOINT` — full HTTPS URL for Android, relative `/api/auth-email` OK for web.
- `VITE_SESSION_DURATION_DAYS` — Firebase session length, default 180.
- `VITE_ACCESS_TOKEN_TTL_MS` — Drive token assumed lifetime, default 50 min.
- `VITE_ACCESS_TOKEN_REFRESH_INTERVAL_MS` — Android silent-refresh interval, default 10 min.
- `VITE_NATIVE_AUTH_TIMEOUT_MS` — native SocialLogin call timeout, default 15s.

Server (Vercel project env):
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- `FIREBASE_SERVICE_ACCOUNT_JSON` — raw JSON of the admin SDK service account.
- `PUBLIC_SITE_URL` — for links/logos in emails. Falls back to `https://sofull.site`.
- `SUPPORT_EMAIL` — default `support@sofull.site`.
- `EMAIL_LOGO_URL` — optional PNG override (SVG is skipped, most email clients block it).
- `LOGIN_EMAIL_COOLDOWN_SECONDS`, `AUTH_EMAIL_RATE_LIMIT_MAX`, `AUTH_EMAIL_RATE_LIMIT_WINDOW_SECONDS`
- `CORS_ORIGINS`, `DEV_CORS_ORIGINS`, `ALLOW_LOCALHOST_ORIGIN`

Android release (loaded by [scripts/android-release-internal.mjs](scripts/android-release-internal.mjs) from `.env.android.release.local`):
- `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH` (or paste JSON via `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`)
- `GOOGLE_PLAY_TRACK` (default `internal`), `GOOGLE_PLAY_RELEASE_STATUS` (default `draft`)

`.env.example` shows the client-side keys with placeholder values. The release env has its own template at `android.release.env.example`.

## Deployment topology

- **Frontend** is GitHub Pages, custom apex `sofull.site` via `public/CNAME`. The Pages workflow (`pages.yml`) injects all `VITE_*` secrets at build time.
- **API** is on Vercel under the project's `*.vercel.app` host. `vercel.json` disables framework detection and redirects everything outside `/api/*` to `https://sofull.site` so the Vercel domain isn't accidentally indexed.
- **Critical**: do NOT attach `sofull.site` to the Vercel project, or the redirect creates a loop. If a separate API host is ever needed, use `api.sofull.site` (the CSP already allows it).
- Email secrets live exclusively in Vercel env. Firebase Admin credentials must never be in any client-visible file.

## Conventions (read before writing code)

- **No comments unless they explain a non-obvious WHY.** Don't restate what code does or what task added it. This is enforced repo-wide.
- **One stylesheet**: `src/index.css`. No CSS-in-JS, no modules. Add new selectors there, keep them BEM-ish (`.refresh-button`, `.app__footer-links`).
- **No new components without need.** The app is intentionally single-`App.tsx`; split only when a piece is genuinely reusable or grows past ~150 lines of JSX.
- **Sanitize at the trust boundary.** Anything coming back from Drive goes through `sanitizeEntries`. Anything user-typed for image URLs goes through `sanitizeUrl` (HTTPS-only). Don't bypass either.
- **Drive calls go through `googleDriveClient.ts`.** No direct `fetch` to googleapis in components.
- **All native calls must be `withTimeout`-wrapped.** This isn't optional — `@capgo/capacitor-social-login` can deadlock during app resume. See [useGoogleAuth.ts:66-84](src/hooks/useGoogleAuth.ts#L66-L84).
- **Don't add per-category data fields.** The `spiciness` enum is reused for crunch/sweet/creamy by design; only the rendering layer is category-aware.
- **Commit messages**: short, lowercase, action verb (`fix x`, `add y`, `update z`). No conventional-commits prefixes, no scopes. Match what's already in `git log`.

## Things that look weird but are intentional

- **`spiciness` field for ice cream.** Yes. See above.
- **Two `signIn` calls in a row on Android.** Required: first one for basic sign-in, second to attach Drive scopes. The mid-flow account-match check exists because Google Sign-In on Android lets the user pick a different account in the second prompt, which would leak the wrong Drive.
- **`shouldSendLoginEmail` device gate runs on both web and Android.** Device ID source differs (random UUID on web, `Capacitor.Device.getId()` on native) but the Firestore document layout is identical. Server-side dedup still acts as the safety net.
- **localStorage `sofull-web-device-gate:` fallback.** Used when Firestore is unreachable; lets the email still fire once per device without infinite retries.
- **`base: './'` only when `CAPACITOR=true`.** GitHub Pages needs absolute, Capacitor WebView needs relative. The npm script sets the env var.

## Known bugs / inconsistencies

See [TODO.md](TODO.md) for the live punch list.

## CI

- `pages.yml` builds + deploys on push to `main`.
- All Android workflows are manually triggered.
- `scan:secrets` runs in CI; the pattern list in `scripts/scan-secrets.mjs` covers private-key blocks, service-account JSON, Google API keys, Resend keys, and Stripe live keys. Add new patterns there if a new provider is introduced.

## When in doubt

- Drive-related bug? Open `googleDriveClient.ts` and the surrounding `runDriveOperationWithScopeRetry` wrapper before patching `useGoogleAuth.ts`.
- Auth-related bug? Read the entire `useGoogleAuth.ts` — it's one file on purpose. The state machine doesn't split cleanly.
- Email-related bug? Read `computeEmailPlan` first; the dedup logic is the load-bearing part.
- Android-only bug? Check the workflow logs and the keystore fingerprints. Most "Account reauth failed" errors are a fingerprint mismatch between the app-signing certificate and the OAuth client.
