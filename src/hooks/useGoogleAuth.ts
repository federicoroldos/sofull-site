import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
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

const provider = new GoogleAuthProvider();
const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/drive.file'
];
const GOOGLE_SCOPES = ['profile', 'email', ...DRIVE_SCOPES];
DRIVE_SCOPES.forEach((scope) => provider.addScope(scope));
provider.setCustomParameters({ prompt: 'select_account consent' });

const ACCESS_TOKEN_KEY = 'sofull-google-access-token';
const LEGACY_ACCESS_TOKEN_KEY = 'ramyeon-google-access-token';
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
const LEGACY_SESSION_START_KEY = 'ramyeon-google-session-start';
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
const TOKEN_EXPIRY_POLL_MS = 10 * 1000;
const IS_NATIVE = Capacitor.isNativePlatform();
let socialLoginInitialized = false;

const ensureNativeSocialLogin = async () => {
  if (!IS_NATIVE || socialLoginInitialized) return;
  if (!GOOGLE_WEB_CLIENT_ID) {
    throw new Error('Missing VITE_GOOGLE_WEB_CLIENT_ID for native Google Sign-In.');
  }
  await SocialLogin.initialize({
    google: {
      webClientId: GOOGLE_WEB_CLIENT_ID,
      mode: 'online'
    }
  });
  socialLoginInitialized = true;
};

const tryNativeLogout = async () => {
  if (!IS_NATIVE) return;
  try {
    await ensureNativeSocialLogin();
    await SocialLogin.logout({ provider: 'google' });
  } catch {
    // Ignore native logout failures.
  }
};

type StoredTokenEntry = {
  token: string;
  storedAt: number;
  expiresAt?: number | null;
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

const readTokenEntryFromKey = (key: string) => parseStoredToken(localStorage.getItem(key));

const persistTokenEntry = (entry: StoredTokenEntry | null) => {
  try {
    if (!entry) {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
      return;
    }
    localStorage.setItem(ACCESS_TOKEN_KEY, JSON.stringify(entry));
    localStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
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
  const primary = readTokenEntryFromKey(ACCESS_TOKEN_KEY);
  if (primary) return toTokenState(primary);
  const legacy = readTokenEntryFromKey(LEGACY_ACCESS_TOKEN_KEY);
  if (legacy) {
    const state = toTokenState(legacy);
    if (state.token) {
      persistTokenEntry(legacy);
    }
    return state;
  }
  return { token: null, expiresAt: null };
};

const parseSessionStart = (raw: string | null) => {
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const readSessionStart = () => {
  const primary = parseSessionStart(localStorage.getItem(SESSION_START_KEY));
  if (primary) return primary;
  const legacy = parseSessionStart(localStorage.getItem(LEGACY_SESSION_START_KEY));
  if (legacy) {
    persistSessionStart(legacy);
    return legacy;
  }
  return null;
};

const persistSessionStart = (timestamp: number | null) => {
  try {
    if (!timestamp) {
      localStorage.removeItem(SESSION_START_KEY);
      localStorage.removeItem(LEGACY_SESSION_START_KEY);
      return;
    }
    localStorage.setItem(SESSION_START_KEY, String(timestamp));
    localStorage.removeItem(LEGACY_SESSION_START_KEY);
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

const normalizeDeviceModel = (value?: string | null) => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\s+/g, ' ');
};

const extractAndroidModel = (userAgent: string) => {
  const match = userAgent.match(/Android[^;]*;\s*([^;\)]+)(?:\sBuild|\)|;)/i);
  if (!match) return null;
  const raw = match[1].replace(/\s*Build.*$/i, '').trim();
  if (!raw || /^(mobile|tablet)$/i.test(raw)) return null;
  return raw;
};

const getClientDeviceModel = async () => {
  const nav = navigator as Navigator & {
    userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string }> };
  };

  if (nav.userAgentData?.getHighEntropyValues) {
    try {
      const data = await nav.userAgentData.getHighEntropyValues(['model']);
      const model = normalizeDeviceModel(data?.model);
      if (model) return model;
    } catch {
      // Ignore UA data failures and fall back to UA parsing.
    }
  }

  const ua = navigator.userAgent || '';
  if (!ua) return null;

  if (/android/i.test(ua)) {
    const model = normalizeDeviceModel(extractAndroidModel(ua));
    if (model) return model;
  }

  if (/iphone/i.test(ua)) return 'iPhone';
  if (/ipad/i.test(ua)) return 'iPad';
  return null;
};

const getOrCreateWebDeviceId = () => {
  try {
    const existing = localStorage.getItem(WEB_DEVICE_ID_KEY);
    if (existing) return existing;
    const generated = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(WEB_DEVICE_ID_KEY, generated);
    return generated;
  } catch {
    return globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

const getWebDeviceName = () => {
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || 'Unknown platform';
  let browser = 'Browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\//.test(ua)) browser = 'Opera';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = 'Safari';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  return `${browser} on ${platform}`;
};

const shouldSendWebLoginEmail = async (uid: string) => {
  try {
    const db = getFirestore(firebaseApp);
    const deviceId = getOrCreateWebDeviceId();
    const deviceRef = doc(db, 'users', uid, 'devices', deviceId);
    const existing = await getDoc(deviceRef);
    if (existing.exists()) {
      return false;
    }
    await setDoc(deviceRef, {
      deviceName: getWebDeviceName(),
      platform: 'web',
      createdAt: serverTimestamp()
    });
    return true;
  } catch (err) {
    console.warn('Web device email gate failed.', err);
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
    const deviceModel = await getClientDeviceModel();
    if (deviceModel) headers['X-Client-Device-Model'] = deviceModel;
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
  const accessTokenRef = useRef<string | null>(stored.token);

  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

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

  const expireToken = () => {
    applyAccessToken(null);
    setTokenExpired(true);
  };

  const refreshAccessToken = useCallback(
    async (options?: { interactive?: boolean; force?: boolean }) => {
      if (IS_NATIVE) {
        const trySilentRefresh = async () => {
          try {
            await ensureNativeSocialLogin();
            try {
              await SocialLogin.refresh({
                provider: 'google',
                options: { scopes: GOOGLE_SCOPES, forceRefreshToken: true }
              });
            } catch {
              // Ignore refresh failures and fall back to authorization code.
            }
            const authorization = await SocialLogin.getAuthorizationCode({ provider: 'google' });
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

        try {
          await ensureNativeSocialLogin();
          const response = await SocialLogin.login({
            provider: 'google',
            options: { scopes: GOOGLE_SCOPES }
          });
          if (response.provider !== 'google') return accessTokenRef.current;
          const result = response.result;
          if (result.responseType !== 'online') return accessTokenRef.current;
          const accessToken = result.accessToken?.token ?? null;
          if (accessToken) {
            applyAccessToken(accessToken);
          }
          return accessToken ?? accessTokenRef.current;
        } catch {
          return accessTokenRef.current;
        }
      }
      return accessTokenRef.current;
    },
    [applyAccessToken]
  );

  const getAccessToken = useCallback(
    async (options?: { interactive?: boolean; forceRefresh?: boolean }) => {
      const current = accessTokenRef.current;
      if (!IS_NATIVE) return current;
      if (options?.forceRefresh || !current) {
        return await refreshAccessToken({
          interactive: options?.interactive,
          force: options?.forceRefresh
        });
      }
      return current;
    },
    [refreshAccessToken]
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
      setLoading(false);
      setError(reason || null);
    }
  }, [auth, updateSessionStart]);

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
      setAccessToken(null);
      setAccessTokenExpiresAt(null);
      persistToken(null);
      updateSessionStart(null);
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
    const checkExpiry = () => {
      if (Date.now() >= accessTokenExpiresAt) {
        expireToken();
      }
    };
    checkExpiry();
    const interval = window.setInterval(checkExpiry, TOKEN_EXPIRY_POLL_MS);
    return () => window.clearInterval(interval);
  }, [user, accessToken, accessTokenExpiresAt]);

  const signIn = async () => {
    setLoading(true);
    setError(null);
    try {
      if (IS_NATIVE) {
        await ensureNativeSocialLogin();
        const response = await SocialLogin.login({
          provider: 'google',
          options: {
            scopes: GOOGLE_SCOPES
          }
        });
        if (response.provider !== 'google') {
          throw new Error('Google sign-in failed.');
        }
        const result = response.result;
        if (result.responseType !== 'online') {
          throw new Error('Google sign-in did not return an access token.');
        }
        const accessToken = result.accessToken?.token ?? null;
        const idToken = result.idToken ?? null;
        if (!idToken) {
          throw new Error('Google sign-in did not return an ID token.');
        }
        const credential = GoogleAuthProvider.credential(idToken, accessToken || undefined);
        const authResult = await signInWithCredential(auth, credential);
        applyAccessToken(accessToken);
        updateSessionStart(Date.now());
        void notifyAuthEmail(authResult.user);
        return;
      }
      await setPersistence(auth, browserLocalPersistence);
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      applyAccessToken(credential?.accessToken ?? null);
      updateSessionStart(Date.now());
      if (await shouldSendWebLoginEmail(result.user.uid)) {
        void notifyAuthEmail(result.user);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google sign-in failed.';
      setError(message);
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
    accessTokenExpiresAt,
    tokenExpired,
    clearTokenExpired,
    loading,
    error,
    getAccessToken,
    signIn,
    signOut: signOutUser
  };
};






