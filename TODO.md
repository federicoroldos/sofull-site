# TODO: Polish Roadmap

Punch list of everything to fix before this is "CV-quality". Grouped by priority. Tick the boxes as we land each item; each line is small enough to be one PR.

## P0: Active bugs

- [x] **`toEmail` is undefined in the email error logger.** Renamed to `recipient: email`; the logger now references a variable in scope and the field name doesn't collide with the SDK key.

- [x] **Misleading "Session expired" modal.** Reworded to "Reconnect Google Drive" and wired the Reconnect button to `reconnectDrive()` (silent → interactive → full `signIn` fallback). Pairs with the silent-refresh work below.

## P1: Inconsistencies / UX

- [x] **Email gate divergence between web and Android.** Generalized `shouldSendLoginEmail` to both platforms. Native uses `Capacitor.Device.getId()` cached in `sofull-native-device-id`; web keeps the UUID in `sofull-web-device-id`. Firestore doc layout unchanged.

- [x] **No silent token refresh on web.** Implemented via Google Identity Services' `initTokenClient`. Triggers proactively (~5 min before expiry) and reactively (when polling detects expiry). Falls back to the Reconnect modal when GIS fails or `VITE_GOOGLE_WEB_CLIENT_ID` is missing. Pages workflow now passes the secret at build time.

- [x] **Android session restore feels like a logout when silent refresh fails.** `getAccessToken` now expires the token (triggering the Reconnect modal) when refresh fails AND the cached token is past `expiresAt`. `reconnectDrive` is platform-aware: on Android it forces the Drive scope re-prompt via `nativeSignInWithScopes(GOOGLE_SCOPES)`; on web it does silent → interactive GIS.

- [x] **Two `setPersistence(auth, browserLocalPersistence)` calls.** Removed the redundant one in `signIn`; the persistence effect runs once at mount.

- [x] **`onAuthStateChanged` null branch nukes localStorage.** Guarded with `hadAuthenticatedUserRef`: the clear only runs when transitioning from authed → null (real sign-out), not on first fire.

## P2: Dead code / cleanup

- [x] **Brevo leftovers.** Removed from `SENSITIVE_KEYS` and `scan-secrets.mjs`. Added Resend pattern in its place.

- [x] **Legacy localStorage keys.** `LEGACY_ACCESS_TOKEN_KEY`/`LEGACY_SESSION_START_KEY` constants, dual-read paths and dual-remove logic gone. Hook only knows `sofull-*` now.

- [x] **`legacy backup filename`.** `ramyeon-dictionary.json` constant and `migrateLegacyAppDataFile` helper removed; `ensureAppDataFile` is now a straight lookup-or-create.

- [x] **`cleartext: true` in Capacitor config.** Removed.

- [x] **`VITE_ENFORCE_ACCESS_TOKEN_EXPIRY`** dropped from `.env.example` and `INTERNALS.md`.

- [x] **`accessTokenExpiresAt` exported but unused.** Trimmed from the hook's return type.

## P3: Nice-to-have / portfolio polish

- [x] **Add a `/about` modal or footer link** with the product story. Footer has an "About" button that opens a modal explaining the single-user, your-Drive-your-data model, no backend, no tracking. Focus + Escape wired.

- [x] **Add a real loading skeleton** for the entry list while the first Drive load is in flight. Three shimmer cards while `syncState === 'loading' && entries.length === 0`. Respects `prefers-reduced-motion`.

- [x] **Empty-state CTA** when logged in with zero entries. Centered title + paragraph + Add-first-item button.

- [x] **Optimistic image preview** after Save. The blob URL the form already creates is now also seeded into `driveImageCacheRef` keyed by the new Drive file id, so the new card renders the image instantly instead of going through a re-download.

- [ ] **A11y pass.** Initial round done: status bar has `aria-live="polite"`, entry images use a descriptive alt with the entry name and `loading="lazy"`, the picture-less placeholder is `aria-hidden`, and the Reconnect modal traps initial focus + closes on Escape. Still pending: full axe / Lighthouse run, focus trap in the entry form modal, keyboard-reachable rating inputs.

- [x] **README badges**: Pages deploy + Live demo + built-with chip. Android workflow badge skipped since it's manual (`workflow_dispatch`) and would render as "no runs".

- [~] **Screenshots in README.** Section added with placeholder structure and `docs/screenshots/README.md` documenting the expected filenames and sizing. Waiting on user-provided captures to drop into `docs/screenshots/` and uncomment the table.

- [ ] **Lighthouse audit + perf budget**. The whole bundle is small, but locking in a budget in CI is a portfolio plus.

- [x] **Demo mode polish.** Six entries hardcoded, covering all four categories with realistic Korean brand/name choices.

- [ ] **End-to-end smoke test** (Playwright) for sign-in → add → reload → see entry. Even one test is enough to mention in the CV.

## P4: Future considerations (not blocking)

- [ ] Native iOS build via Capacitor (Apple developer account needed; out of scope unless prioritized).
- [ ] PWA install prompt + offline shell. Drive ops can't be offline, but the UI can render cached entries.
- [ ] Multi-account switching on the same device. Currently fixed to one Google account at a time.
- [ ] Export/import (CSV or JSON). Would help users who want to leave the platform.

---

## Workflow

When picking up an item:

1. Open this file and the section of [CLAUDE.md](CLAUDE.md) the item touches.
2. Make the change small and targeted; one item per PR.
3. Tick the box, commit. Commit message style: lowercase verb, no scope (`fix toEmail referenceerror in email error logger`).
4. If you discover a new issue while fixing one, append it under the right priority section, don't sneak it into the current PR.

Priorities can be re-ordered; nothing here is sacred except P0 staying P0 until shipped.
