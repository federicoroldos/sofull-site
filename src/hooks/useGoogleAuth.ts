import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { SocialLogin } from '@capgo/capacitor-social-login';
import { firebaseApp } from '../firebase';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithCredential,
  signInWithPopup,
  signOut
} from 'firebase/auth';
import { doc, getDoc, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { getClientDeviceHeaders, getClientDeviceMetadata } from '../utils/deviceMetadata';

const provider = new GoogleAuthProvider();
const BASIC_SCOPES = ['profile', 'email'];
const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/drive.file'
];
const GOOGLE_SCOPES = [...BASIC_SCOPES, ...DRIVE_SCOPES];
DRIVE_SCOPES.forEach((scope) => provider.addScope(scope));
provider.setCustomParameters({ prompt: 'select_account consent' });

const ACCESS_TOKEN_KEY = 'sofull-google-access-token';
const DEFAULT_ACCESS_TOKEN_LIFETIME_MS = 50 * 60 * 1000;
const ACCESS_TOKEN_LIFETIME_MS = (() => {
  const raw = Number(import.meta.env.VITE_ACCESS_TOKEN_TTL_MS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_ACCESS_TOKEN_LIFETIME_MS;
})();
const DEFAULT_ACCESS_TOKEN_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_REFRESH_INTERVAL_MS = (() => {
  const raw = Number(import.meta.env.VITE_ACCESS_TOKEN_REFRESH_INTERVAL_MS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_ACCESS_TOKEN_REFRESH_INTERVAL_MS;
})();
const SESSION_START_KEY = 'sofull-google-session-start';
const DEFAULT_SESSION_DURATION_DAYS = 180;
const SESSION_DURATION_DAYS = (() => {
  const raw = Number(import.meta.env.VITE_SESSION_DURATION_DAYS);
  if (Number.isFinite(raw) && raw > 0) return Math.round(raw);
  return DEFAULT_SESSION_DURATION_DAYS;
})();
const SESSION_DURATION_MS = SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000;
const AUTH_EMAIL_ENDPOINT = import.meta.env.VITE_AUTH_EMAIL_ENDPOINT;
const GOOGLE_WEB_CLIENT_ID = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID;
const WEB_DEVICE_ID_KEY = 'sofull-web-device-id';
const NATIVE_DEVICE_ID_KEY = 'sofull-native-device-id';
const TOKEN_EXPIRY_POLL_MS = 10 * 1000;
const DEFAULT_NATIVE_AUTH_TIMEOUT_MS = 15 * 1000;
const NATIVE_AUTH_TIMEOUT_MS = (() => {
  const raw = Number(import.meta.env.VITE_NATIVE_AUTH_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_NATIVE_AUTH_TIMEOUT_MS;
})();
const IS_NATIVE = Capacitor.isNativePlatform();
const IS_ANDROID = Capacitor.getPlatform() === 'android';
const DRIVE_SCOPE_STRING = DRIVE_SCOPES.join(' ');
const WEB_SILENT_REFRESH_LEAD_MS = 5 * 60 * 1000;
const WEB_GIS_READY_TIMEOUT_MS = 5000;
const WEB_GIS_POLL_INTERVAL_MS = 50;
let socialLoginInitialized = false;

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, message: string) => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return await new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
};

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}

interface GisTokenClient {
  requestAccessToken: (overrides?: { prompt?: string; hint?: string }) => void;
}

interface GisOAuth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (response: GisTokenResponse) => void;
    error_callback?: (error: { type?: string; message?: string }) => void;
  }) => GisTokenClient;
}

const getGisOAuth2 = (): GisOAuth2 | null => {
  const google = (globalThis as unknown as { google?: { accounts?: { oauth2?: GisOAuth2 } } })
    .google;
  return google?.accounts?.oauth2 ?? null;
};

const waitForGisOAuth2 = async (timeoutMs = WEB_GIS_READY_TIMEOUT_MS): Promise<GisOAuth2 | null> => {
  const start = Date.now();
  let oauth2 = getGisOAuth2();
  while (!oauth2 && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, WEB_GIS_POLL_INTERVAL_MS));
    oauth2 = getGisOAuth2();
  }
  return oauth2;
};

type WebTokenResult = { token: string; expiresInMs: number | null };

const requestWebAccessToken = async (
  hint: string | null,
  interactive: boolean
): Promise<WebTokenResult | null> => {
  if (!GOOGLE_WEB_CLIENT_ID) return null;
  const oauth2 = await waitForGisOAuth2();
  if (!oauth2) return null;

  return await new Promise<WebTokenResult | null>((resolve) => {
    let settled = false;
    const settle = (value: WebTokenResult | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const client = oauth2.initTokenClient({
        client_id: GOOGLE_WEB_CLIENT_ID,
        scope: DRIVE_SCOPE_STRING,
        callback: (response) => {
          if (response.access_token) {
            const expiresInMs =
              typeof response.expires_in === 'number' && response.expires_in > 0
                ? response.expires_in * 1000
                : null;
            settle({ token: response.access_token, expiresInMs });
          } else {
            settle(null);
          }
        },
        error_callback: () => settle(null)
      });
      client.requestAccessToken({
        prompt: interactive ? 'consent' : '',
        ...(hint ? { hint } : {})
      });
    } catch {
      settle(null);
    }
  });
};

const GOOGLE_ACCOUNT_MISMATCH_MESSAGE =
  'Google Drive permission must be granted with the same Google account used to sign in.';

const normalizeEmail = (value: string | null | undefined) => value?.trim().toLowerCase() || null;

const decodeJwtPayload = (token: string) => {
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = globalThis.atob(padded);
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const getGoogleAccountEmailFromIdToken = (idToken: string) => {
  const payload = decodeJwtPayload(idToken);
  const email = payload?.email;
  return typeof email === 'string' ? normalizeEmail(email) : null;
};

const getGoogleUserEmail = (user: User | null | undefined) =>
  normalizeEmail(
    user?.email ??
      user?.providerData.find(
        (provider) => provider.providerId === GoogleAuthProvider.PROVIDER_ID && provider.email
      )?.email
  );

const isAccountReauthFailure = (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /\bAccount reauth failed\b/i.test(message);
};

const isGoogleAccountMismatchError = (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return message === GOOGLE_ACCOUNT_MISMATCH_MESSAGE;
};

const formatNativeGoogleAuthError = (err: unknown, context: 'signin' | 'drive') => {
  const message = err instanceof Error ? err.message : String(err ?? '');
  if (isGoogleAccountMismatchError(err)) {
    return context === 'drive'
      ? 'Google Drive permission was granted with a different account. Choose the same Google account you used to sign in.'
      : 'Google sign-in must finish with the same Google account in both prompts. Try again.';
  }
  if (/\b(timed out|timeout)\b/i.test(message)) {
    return context === 'drive'
      ? 'Google Drive session restore timed out. Sign in again to continue syncing.'
      : 'Google Sign-In timed out. Try again.';
  }
  if (isAccountReauthFailure(err)) {
    if (context === 'drive') {
      return 'Google Drive authorization could not be completed on this device. Verify the Android OAuth client package name and SHA-1/SHA-256. If this build came from Google Play, use the Play App Signing certificate fingerprints from Play Console > App integrity. Also confirm the Google web client ID for this build, then try again.';
    }
    return 'Google Sign-In could not be completed on this device. Verify the Android OAuth client package name and SHA-1/SHA-256. If this build came from Google Play, use the Play App Signing certificate fingerprints from Play Console > App integrity. Also confirm the Google web client ID for this build, then try again.';
  }
  if (err instanceof Error && err.message) return err.message;
  return context === 'drive'
    ? 'Google Drive access is required to sync. Please allow access by pressing the refresh button to try again.'
    : 'Google sign-in failed.';
};

const ensureNativeSocialLogin = async () => {
  if (!IS_NATIVE || socialLoginInitialized) return;
  if (!GOOGLE_WEB_CLIENT_ID) {
    throw new Error('Missing VITE_GOOGLE_WEB_CLIENT_ID for native Google Sign-In.');
  }
  await withTimeout(
    SocialLogin.initialize({
      google: {
        webClientId: GOOGLE_WEB_CLIENT_ID,
        mode: 'online'
      }
    }),
    NATIVE_AUTH_TIMEOUT_MS,
    'Google Sign-In initialization timed out.'
  );
  socialLoginInitialized = true;
};

const tryNativeLogout = async () => {
  if (!IS_NATIVE) return;
  try {
    await ensureNativeSocialLogin();
    await withTimeout(
      SocialLogin.logout({ provider: 'google' }),
      NATIVE_AUTH_TIMEOUT_MS,
      'Google Sign-Out timed out.'
    );
  } catch {
    // Ignore native logout failures.
  }
};

type StoredTokenEntry = {
  token: string;
  storedAt: number;
  expiresAt?: number | null;
};

type NativeGoogleSignInOptions = {
  style?: 'bottom' | 'standard';
  filterByAuthorizedAccounts?: boolean;
  expectedEmail?: string | null;
};

const parseStoredToken = (raw: string | null) => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredTokenEntry>;
    if (!parsed?.token || typeof parsed.storedAt !== 'number') return null;
    const expiresAt =
      typeof parsed.expiresAt === 'number' && Number.isFinite(parsed.expiresAt) && parsed.expiresAt > 0
        ? parsed.expiresAt
        : null;
    return { token: parsed.token, storedAt: parsed.storedAt, expiresAt };
  } catch {
    return null;
  }
};

const persistTokenEntry = (entry: StoredTokenEntry | null) => {
  try {
    if (!entry) {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      return;
    }
    localStorage.setItem(ACCESS_TOKEN_KEY, JSON.stringify(entry));
  } catch {
    // Ignore storage write failures.
  }
};

const fallbackExpiresAt = (storedAt: number) => {
  if (!Number.isFinite(ACCESS_TOKEN_LIFETIME_MS) || ACCESS_TOKEN_LIFETIME_MS <= 0) return null;
  return storedAt + ACCESS_TOKEN_LIFETIME_MS;
};

const computeExpiresAt = (storedAt: number, expiresInMs?: number | null) => {
  if (Number.isFinite(expiresInMs) && expiresInMs && expiresInMs > 0) {
    return storedAt + expiresInMs;
  }
  return fallbackExpiresAt(storedAt);
};

const toTokenState = (entry: StoredTokenEntry) => {
  const expiresAt = entry.expiresAt ?? fallbackExpiresAt(entry.storedAt);
  if (expiresAt && Date.now() > expiresAt) {
    return { token: null, expiresAt: null };
  }
  return { token: entry.token, expiresAt };
};

const readStoredToken = () => {
  const entry = parseStoredToken(localStorage.getItem(ACCESS_TOKEN_KEY));
  if (entry) return toTokenState(entry);
  return { token: null, expiresAt: null };
};

const parseSessionStart = (raw: string | null) => {
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const readSessionStart = () =>
  parseSessionStart(localStorage.getItem(SESSION_START_KEY));

const persistSessionStart = (timestamp: number | null) => {
  try {
    if (!timestamp) {
      localStorage.removeItem(SESSION_START_KEY);
      return;
    }
    localStorage.setItem(SESSION_START_KEY, String(timestamp));
  } catch {
    // Ignore storage write failures.
  }
};

const isSessionExpired = (sessionStartMs: number, now: number) =>
  now - sessionStartMs >= SESSION_DURATION_MS;

const persistToken = (token: string | null) => {
  try {
    if (!token) {
      persistTokenEntry(null);
      return;
    }
    const storedAt = Date.now();
    persistTokenEntry({ token, storedAt, expiresAt: fallbackExpiresAt(storedAt) });
  } catch {
    // Ignore storage write failures.
  }
};

const generateFallbackDeviceId = (prefix: string) =>
  globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const readDeviceIdFromStorage = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const persistDeviceId = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage write failures.
  }
};

const getOrCreateWebDeviceId = () => {
  const existing = readDeviceIdFromStorage(WEB_DEVICE_ID_KEY);
  if (existing) return existing;
  const generated = generateFallbackDeviceId('web');
  persistDeviceId(WEB_DEVICE_ID_KEY, generated);
  return generated;
};

const getOrCreateNativeDeviceId = async () => {
  const existing = readDeviceIdFromStorage(NATIVE_DEVICE_ID_KEY);
  if (existing) return existing;
  let identifier: string | null = null;
  try {
    const info = await Device.getId();
    if (info?.identifier) identifier = info.identifier;
  } catch {
    // Fall through to UUID fallback.
  }
  const resolved = identifier ?? generateFallbackDeviceId('native');
  persistDeviceId(NATIVE_DEVICE_ID_KEY, resolved);
  return resolved;
};

const toTimestampMs = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (value instanceof Date) {
    const parsed = value.getTime();
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  if (!value || typeof value !== 'object') return null;

  const withToMillis = value as { toMillis?: () => number };
  if (typeof withToMillis.toMillis === 'function') {
    try {
      const parsed = withToMillis.toMillis();
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    } catch {
      // Ignore timestamp conversion failures.
    }
  }

  const withSeconds = value as { seconds?: number; nanoseconds?: number };
  if (typeof withSeconds.seconds === 'number' && Number.isFinite(withSeconds.seconds)) {
    return withSeconds.seconds * 1000 + Math.floor((withSeconds.nanoseconds || 0) / 1_000_000);
  }

  return null;
};

const getRegistrationTimestampMs = (data: Record<string, unknown>) =>
  toTimestampMs(data.lastRegistrationAt) ??
  toTimestampMs(data.firstSeenAt) ??
  toTimestampMs(data.createdAt);

const getErrorCode = (err: unknown) => {
  if (!err || typeof err !== 'object') return '';
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : '';
};

const isFirestorePermissionDenied = (err: unknown) => {
  const code = getErrorCode(err);
  return code === 'permission-denied' || code === 'firestore/permission-denied';
};

type DeviceGatePlatform = 'web' | 'android' | 'ios';

const localDeviceGateKey = (platform: DeviceGatePlatform, uid: string, deviceId: string) =>
  `sofull-${platform}-device-gate:${uid}:${deviceId}`;

const hasLocalDeviceGate = (platform: DeviceGatePlatform, uid: string, deviceId: string) => {
  try {
    return localStorage.getItem(localDeviceGateKey(platform, uid, deviceId)) === '1';
  } catch {
    return false;
  }
};

const markLocalDeviceGate = (platform: DeviceGatePlatform, uid: string, deviceId: string) => {
  try {
    localStorage.setItem(localDeviceGateKey(platform, uid, deviceId), '1');
  } catch {
    // Ignore storage write failures.
  }
};

const resolveLoginEmailPlatform = (): DeviceGatePlatform => {
  if (!IS_NATIVE) return 'web';
  if (Capacitor.getPlatform() === 'ios') return 'ios';
  return 'android';
};

const shouldSendLoginEmail = async (uid: string) => {
  const platform = resolveLoginEmailPlatform();
  const deviceId = platform === 'web' ? getOrCreateWebDeviceId() : await getOrCreateNativeDeviceId();
  const deviceMetadata = await getClientDeviceMetadata();
  const deviceName =
    deviceMetadata.label || deviceMetadata.browser || deviceMetadata.deviceModel || 'Unknown device';
  try {
    const db = getFirestore(firebaseApp);
    const deviceRef = doc(db, 'users', uid, 'devices', deviceId);
    const existing = await getDoc(deviceRef);
    if (existing.exists()) {
      const data = existing.data() as Record<string, unknown>;
      const lastRegistrationAtMs = getRegistrationTimestampMs(data);
      const isExpired =
        lastRegistrationAtMs === null || Date.now() - lastRegistrationAtMs >= SESSION_DURATION_MS;

      if (!isExpired) {
        return false;
      }

      await setDoc(
        deviceRef,
        {
          deviceName,
          platform,
          lastRegistrationAt: serverTimestamp()
        },
        { merge: true }
      );
      return true;
    }
    await setDoc(
      deviceRef,
      {
        deviceName,
        platform,
        firstSeenAt: serverTimestamp(),
        lastRegistrationAt: serverTimestamp()
      },
      { merge: true }
    );
    return true;
  } catch (err) {
    if (isFirestorePermissionDenied(err)) {
      if (hasLocalDeviceGate(platform, uid, deviceId)) {
        return false;
      }
      markLocalDeviceGate(platform, uid, deviceId);
      return true;
    }
    console.warn('Device email gate failed.', err);
    return true;
  }
};

const notifyAuthEmail = async (user: User) => {
  if (!AUTH_EMAIL_ENDPOINT) return;
  try {
    const idToken = await user.getIdToken();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const locale = navigator.language;
    const headers: Record<string, string> = { Authorization: `Bearer ${idToken}` };
    if (timezone) headers['X-Client-Timezone'] = timezone;
    if (locale) headers['X-Client-Locale'] = locale;
    Object.assign(headers, await getClientDeviceHeaders());
    await fetch(AUTH_EMAIL_ENDPOINT, {
      method: 'POST',
      headers
    });
  } catch (err) {
    console.warn('Auth email notification failed.', err);
  }
};

export const useGoogleAuth = () => {
  const auth = getAuth(firebaseApp);
  const stored = readStoredToken();
  const [sessionStartMs, setSessionStartMs] = useState<number | null>(readSessionStart());
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [accessToken, setAccessToken] = useState<string | null>(stored.token);
  const [accessTokenExpiresAt, setAccessTokenExpiresAt] = useState<number | null>(stored.expiresAt);
  const [tokenExpired, setTokenExpired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [androidDriveScopeGranted, setAndroidDriveScopeGranted] = useState(true);
  const accessTokenRef = useRef<string | null>(stored.token);
  const accessTokenExpiresAtRef = useRef<number | null>(stored.expiresAt);
  const hadAuthenticatedUserRef = useRef<boolean>(Boolean(auth.currentUser));

  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  useEffect(() => {
    accessTokenExpiresAtRef.current = accessTokenExpiresAt;
  }, [accessTokenExpiresAt]);

  const updateSessionStart = useCallback((value: number | null) => {
    setSessionStartMs(value);
    persistSessionStart(value);
  }, []);

  const applyAccessToken = useCallback((token: string | null, expiresInMs?: number | null) => {
    if (!token) {
      setAccessToken(null);
      setAccessTokenExpiresAt(null);
      persistToken(null);
      return;
    }
    const storedAt = Date.now();
    const expiresAt = computeExpiresAt(storedAt, expiresInMs);
    setAccessToken(token);
    setAccessTokenExpiresAt(expiresAt);
    persistTokenEntry({ token, storedAt, expiresAt });
    setTokenExpired(Boolean(expiresAt && storedAt >= expiresAt));
  }, []);

  const expireToken = useCallback(() => {
    applyAccessToken(null);
    setTokenExpired(true);
  }, [applyAccessToken]);

  const nativeSignInWithScopes = useCallback(
    async (scopes: string[], options?: NativeGoogleSignInOptions) => {
      await ensureNativeSocialLogin();
      let response;
      try {
        response = await withTimeout(
          SocialLogin.login({
            provider: 'google',
            options: {
              style: options?.style ?? 'bottom',
              filterByAuthorizedAccounts: options?.filterByAuthorizedAccounts,
              scopes
            }
          }),
          NATIVE_AUTH_TIMEOUT_MS,
          'Google Sign-In timed out.'
        );
      } catch (err) {
        throw new Error(formatNativeGoogleAuthError(err, scopes === GOOGLE_SCOPES ? 'drive' : 'signin'));
      }
      if (response.provider !== 'google') {
        throw new Error('Google sign-in failed.');
      }
      const result = response.result;
      if (result.responseType !== 'online') {
        throw new Error('Google sign-in did not return an access token.');
      }
      const nextAccessToken = result.accessToken?.token ?? null;
      const idToken = result.idToken ?? null;
      if (!idToken) {
        throw new Error('Google sign-in did not return an ID token.');
      }
      const expectedEmail = normalizeEmail(options?.expectedEmail);
      const authenticatedEmail = getGoogleAccountEmailFromIdToken(idToken);
      if (expectedEmail && authenticatedEmail !== expectedEmail) {
        throw new Error(GOOGLE_ACCOUNT_MISMATCH_MESSAGE);
      }
      const credential = GoogleAuthProvider.credential(idToken, nextAccessToken || undefined);
      const authResult = await signInWithCredential(auth, credential);
      applyAccessToken(nextAccessToken);
      return { accessToken: nextAccessToken, user: authResult.user };
    },
    [applyAccessToken, auth]
  );

  const forceSessionLogout = useCallback(async (reason?: string) => {
    setLoading(true);
    try {
      await tryNativeLogout();
      await signOut(auth);
    } catch {
      // Ignore sign-out failures; we'll still clear local state.
    } finally {
      setAccessToken(null);
      setAccessTokenExpiresAt(null);
      persistToken(null);
      updateSessionStart(null);
      setTokenExpired(false);
      setUser(null);
      setAndroidDriveScopeGranted(true);
      setLoading(false);
      setError(reason || null);
    }
  }, [auth, updateSessionStart]);

  const refreshAccessToken = useCallback(
    async (options?: { interactive?: boolean; force?: boolean }) => {
      if (IS_NATIVE) {
        const trySilentRefresh = async () => {
          try {
            await ensureNativeSocialLogin();
            try {
              const scopes = IS_ANDROID && !androidDriveScopeGranted ? BASIC_SCOPES : GOOGLE_SCOPES;
              await withTimeout(
                SocialLogin.refresh({
                  provider: 'google',
                  options: { scopes, forceRefreshToken: true }
                }),
                NATIVE_AUTH_TIMEOUT_MS,
                'Google session refresh timed out.'
              );
            } catch {
              // Ignore refresh failures and fall back to authorization code.
            }
            const authorization = await withTimeout(
              SocialLogin.getAuthorizationCode({ provider: 'google' }),
              NATIVE_AUTH_TIMEOUT_MS,
              'Google session restore timed out.'
            );
            const accessToken = authorization.accessToken ?? null;
            if (accessToken) {
              applyAccessToken(accessToken);
            }
            return accessToken;
          } catch {
            return null;
          }
        };

        if (!options?.interactive) {
          if (options?.force || !accessTokenRef.current) {
            const refreshed = await trySilentRefresh();
            if (refreshed) return refreshed;
          }
          return accessTokenRef.current;
        }

        const refreshed = await trySilentRefresh();
        if (refreshed) return refreshed;
        return accessTokenRef.current;
      }

      const currentUser = auth.currentUser;
      if (!currentUser) return accessTokenRef.current;
      const result = await requestWebAccessToken(
        getGoogleUserEmail(currentUser),
        Boolean(options?.interactive)
      );
      if (result?.token) {
        applyAccessToken(result.token, result.expiresInMs);
        return result.token;
      }
      return accessTokenRef.current;
    },
    [androidDriveScopeGranted, applyAccessToken, auth]
  );

  const getAccessToken = useCallback(
    async (options?: {
      interactive?: boolean;
      forceRefresh?: boolean;
      requireDriveScope?: boolean;
      forceDriveScopePrompt?: boolean;
    }) => {
      const current = accessTokenRef.current;
      const expiresAt = accessTokenExpiresAtRef.current;
      const isExpired = Boolean(expiresAt && Date.now() >= expiresAt);
      if (!IS_NATIVE) return current;
      if (!user) return null;
      const requiresDriveScope = Boolean(IS_ANDROID && options?.requireDriveScope);
      const shouldPromptForDriveScope =
        requiresDriveScope &&
        Boolean(options?.interactive) &&
        (Boolean(options?.forceDriveScopePrompt) || !androidDriveScopeGranted);

      if (requiresDriveScope && !options?.interactive && !androidDriveScopeGranted) {
        return current;
      }

      if (shouldPromptForDriveScope) {
        try {
          const result = await nativeSignInWithScopes(GOOGLE_SCOPES, {
            style: IS_ANDROID ? 'standard' : 'bottom',
            filterByAuthorizedAccounts: IS_ANDROID ? false : undefined,
            expectedEmail: getGoogleUserEmail(user)
          });
          setAndroidDriveScopeGranted(true);
          return result.accessToken;
        } catch (err) {
          if (isGoogleAccountMismatchError(err)) {
            await forceSessionLogout(formatNativeGoogleAuthError(err, 'drive'));
            return null;
          }
          setAndroidDriveScopeGranted(false);
          setError(formatNativeGoogleAuthError(err, 'drive'));
          return null;
        }
      }

      if (!options?.forceRefresh && current && !isExpired) {
        return current;
      }

      const refreshed = await refreshAccessToken({
        interactive: options?.interactive,
        force: options?.forceRefresh || isExpired || !current
      });

      if (refreshed) return refreshed;

      if (!current || isExpired) {
        expireToken();
        return null;
      }

      return current;
    },
    [
      androidDriveScopeGranted,
      expireToken,
      forceSessionLogout,
      nativeSignInWithScopes,
      refreshAccessToken,
      user
    ]
  );

  const requestDriveReconnect = useCallback(() => {
    setTokenExpired(true);
  }, []);

  const reconnectDrive = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (IS_NATIVE) {
        const token = await getAccessToken({
          interactive: true,
          forceRefresh: true,
          requireDriveScope: IS_ANDROID,
          forceDriveScopePrompt: IS_ANDROID
        });
        if (token) {
          setTokenExpired(false);
          return true;
        }
        return false;
      }
      const silent = await refreshAccessToken({ interactive: false });
      if (silent) {
        setTokenExpired(false);
        return true;
      }
      const interactive = await refreshAccessToken({ interactive: true });
      if (interactive) {
        setTokenExpired(false);
        return true;
      }
      return false;
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, refreshAccessToken]);

  useEffect(() => {
    let active = true;
    setPersistence(auth, browserLocalPersistence).catch((err) => {
      if (!active) return;
      const message = err instanceof Error ? err.message : 'Unable to enable local sign-in persistence.';
      setError(message);
    });
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      const now = Date.now();
      if (nextUser) {
        hadAuthenticatedUserRef.current = true;
        const storedSessionStart = readSessionStart();
        const effectiveStart = storedSessionStart ?? now;
        if (!storedSessionStart) {
          updateSessionStart(effectiveStart);
        } else if (isSessionExpired(effectiveStart, now)) {
          void forceSessionLogout('Session expired. Sign in again to continue.');
          return;
        }
        setUser(nextUser);
        return;
      }
      setUser(null);
      if (!hadAuthenticatedUserRef.current) return;
      hadAuthenticatedUserRef.current = false;
      setAccessToken(null);
      setAccessTokenExpiresAt(null);
      persistToken(null);
      updateSessionStart(null);
      setAndroidDriveScopeGranted(true);
    });
    return () => {
      active = false;
      unsub();
    };
  }, [auth, forceSessionLogout, updateSessionStart]);

  useEffect(() => {
    if (!user || !sessionStartMs) return;
    const checkSessionExpiry = () => {
      if (isSessionExpired(sessionStartMs, Date.now())) {
        void forceSessionLogout('Session expired. Sign in again to continue.');
      }
    };
    checkSessionExpiry();
    const interval = window.setInterval(checkSessionExpiry, 60 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [user, sessionStartMs, forceSessionLogout]);

  useEffect(() => {
    if (!user || !IS_NATIVE) return;
    void refreshAccessToken({ interactive: false });
  }, [user, refreshAccessToken]);

  useEffect(() => {
    if (!user || !IS_NATIVE) return;
    if (!Number.isFinite(ACCESS_TOKEN_REFRESH_INTERVAL_MS) || ACCESS_TOKEN_REFRESH_INTERVAL_MS <= 0) {
      return;
    }
    const interval = window.setInterval(() => {
      void refreshAccessToken({ interactive: false, force: true });
    }, ACCESS_TOKEN_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [user, refreshAccessToken]);

  useEffect(() => {
    if (IS_NATIVE) return;
    if (!user || !accessToken || !accessTokenExpiresAt) return;
    let cancelled = false;
    let refreshing = false;

    const tryRefreshOrExpire = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const refreshed = await refreshAccessToken({ interactive: false });
        if (cancelled) return;
        if (!refreshed || refreshed === accessToken) {
          expireToken();
        }
      } finally {
        refreshing = false;
      }
    };

    const checkExpiry = () => {
      if (Date.now() >= accessTokenExpiresAt) {
        void tryRefreshOrExpire();
      }
    };

    const leadMs = Math.max(0, accessTokenExpiresAt - Date.now() - WEB_SILENT_REFRESH_LEAD_MS);
    const proactiveTimer = window.setTimeout(() => {
      if (cancelled) return;
      void tryRefreshOrExpire();
    }, leadMs);

    checkExpiry();
    const interval = window.setInterval(checkExpiry, TOKEN_EXPIRY_POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(proactiveTimer);
      window.clearInterval(interval);
    };
  }, [user, accessToken, accessTokenExpiresAt, expireToken, refreshAccessToken]);

  const signIn = async () => {
    setLoading(true);
    setError(null);
    try {
      if (IS_NATIVE) {
        const authResult = await nativeSignInWithScopes(IS_ANDROID ? [] : GOOGLE_SCOPES, {
          style: IS_ANDROID ? 'standard' : 'bottom',
          filterByAuthorizedAccounts: IS_ANDROID ? false : undefined
        });
        if (IS_ANDROID) {
          await nativeSignInWithScopes(GOOGLE_SCOPES, {
            style: 'standard',
            filterByAuthorizedAccounts: false,
            expectedEmail: getGoogleUserEmail(authResult.user)
          });
        }
        updateSessionStart(Date.now());
        setAndroidDriveScopeGranted(true);
        if (await shouldSendLoginEmail(authResult.user.uid)) {
          void notifyAuthEmail(authResult.user);
        }
        return;
      }
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      applyAccessToken(credential?.accessToken ?? null);
      updateSessionStart(Date.now());
      if (await shouldSendLoginEmail(result.user.uid)) {
        void notifyAuthEmail(result.user);
      }
    } catch (err) {
      if (IS_NATIVE && auth.currentUser) {
        await forceSessionLogout();
      }
      setError(formatNativeGoogleAuthError(err, 'signin'));
    } finally {
      setLoading(false);
    }
  };

  const signOutUser = async () => {
    setLoading(true);
    try {
      await tryNativeLogout();
      await signOut(auth);
      applyAccessToken(null);
      updateSessionStart(null);
      setAndroidDriveScopeGranted(true);
      setError(null);
      setTokenExpired(false);
    } finally {
      setLoading(false);
    }
  };

  const clearTokenExpired = () => setTokenExpired(false);

  return {
    user,
    accessToken,
    tokenExpired,
    clearTokenExpired,
    loading,
    error,
    getAccessToken,
    reconnectDrive,
    requestDriveReconnect,
    signIn,
    signOut: signOutUser
  };
};





