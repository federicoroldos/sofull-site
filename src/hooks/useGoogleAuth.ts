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
const ACCESS_TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_EXPIRY_ENFORCED = import.meta.env.VITE_ENFORCE_ACCESS_TOKEN_EXPIRY === 'true';
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
const IS_NATIVE = Capacitor.isNativePlatform();
let socialLoginInitialized = false;

type GisTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
  scope?: string;
  token_type?: string;
};

type GisTokenClient = {
  requestAccessToken: (options?: { prompt?: string }) => void;
  callback?: (response: GisTokenResponse) => void;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: GisTokenResponse) => void;
          }) => GisTokenClient;
        };
      };
    };
  }
}

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

const waitForGoogleAccounts = (timeoutMs = 1500) =>
  new Promise<boolean>((resolve) => {
    if (window.google?.accounts?.oauth2) {
      resolve(true);
      return;
    }
    const start = Date.now();
    const tick = () => {
      if (window.google?.accounts?.oauth2) {
        resolve(true);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        resolve(false);
        return;
      }
      window.setTimeout(tick, 50);
    };
    tick();
  });

let gisTokenClient: GisTokenClient | null = null;

const getGisTokenClient = async () => {
  if (IS_NATIVE || !GOOGLE_WEB_CLIENT_ID) return null;
  if (!window.google?.accounts?.oauth2) {
    const loaded = await waitForGoogleAccounts();
    if (!loaded) return null;
  }
  if (!gisTokenClient) {
    gisTokenClient = window.google?.accounts?.oauth2?.initTokenClient({
      client_id: GOOGLE_WEB_CLIENT_ID,
      scope: DRIVE_SCOPES.join(' '),
      callback: () => {}
    }) ?? null;
  }
  return gisTokenClient;
};

const parseStoredToken = (raw: string | null) => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { token: string; storedAt: number };
    if (!parsed?.token || typeof parsed.storedAt !== 'number') return null;
    return { token: parsed.token, storedAt: parsed.storedAt };
  } catch {
    return null;
  }
};

const readTokenEntryFromKey = (key: string) => parseStoredToken(localStorage.getItem(key));

const persistTokenEntry = (entry: { token: string; storedAt: number } | null) => {
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

const toTokenState = (entry: { token: string; storedAt: number }) => {
  const expiresAt = fallbackExpiresAt(entry.storedAt);
  if (ACCESS_TOKEN_EXPIRY_ENFORCED && expiresAt && Date.now() > expiresAt) {
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
    persistTokenEntry({ token, storedAt: Date.now() });
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
  const refreshPromiseRef = useRef<Promise<string | null> | null>(null);

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
    setAccessToken(token);
    setAccessTokenExpiresAt(computeExpiresAt(storedAt, expiresInMs));
    persistTokenEntry({ token, storedAt });
    setTokenExpired(false);
  }, []);

  const expireToken = () => {
    applyAccessToken(null);
    setTokenExpired(true);
  };

  const requestGisAccessToken = useCallback(async (prompt: string) => {
    const tokenClient = await getGisTokenClient();
    if (!tokenClient) return null;
    return await new Promise<GisTokenResponse | null>((resolve) => {
      tokenClient.callback = (response) => {
        resolve(response);
      };
      try {
        tokenClient.requestAccessToken({ prompt });
      } catch {
        resolve(null);
      }
    });
  }, []);

  const refreshAccessToken = useCallback(
    async (options?: { interactive?: boolean; force?: boolean }) => {
      if (IS_NATIVE) {
        if (!options?.interactive) return accessTokenRef.current;
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
      if (!GOOGLE_WEB_CLIENT_ID) return accessTokenRef.current;
      if (refreshPromiseRef.current && !options?.force) {
        return refreshPromiseRef.current;
      }
      const request = (async () => {
        const response = await requestGisAccessToken(options?.interactive ? 'consent' : '');
        if (!auth.currentUser) return null;
        if (!response || response.error || !response.access_token) {
          if (accessTokenRef.current) {
            setTokenExpired(true);
          }
          return accessTokenRef.current;
        }
        const expiresInMs =
          typeof response.expires_in === 'number' && Number.isFinite(response.expires_in)
            ? response.expires_in * 1000
            : null;
        applyAccessToken(response.access_token, expiresInMs);
        return response.access_token;
      })();
      refreshPromiseRef.current = request;
      try {
        return await request;
      } finally {
        if (refreshPromiseRef.current === request) {
          refreshPromiseRef.current = null;
        }
      }
    },
    [applyAccessToken, auth, requestGisAccessToken]
  );

  const getAccessToken = useCallback(
    async (options?: { interactive?: boolean; forceRefresh?: boolean }) => {
      const current = accessTokenRef.current;
      if (IS_NATIVE) {
        if (options?.interactive && (options?.forceRefresh || !current)) {
          return await refreshAccessToken({ interactive: true, force: options?.forceRefresh });
        }
        return current;
      }
      if (!GOOGLE_WEB_CLIENT_ID) return current;
      const expiresAt = accessTokenExpiresAt;
      const shouldRefresh =
        options?.forceRefresh ||
        !current ||
        (expiresAt && Date.now() >= expiresAt - ACCESS_TOKEN_REFRESH_BUFFER_MS);
      if (!shouldRefresh) return current;
      return await refreshAccessToken({
        interactive: options?.interactive,
        force: options?.forceRefresh
      });
    },
    [accessTokenExpiresAt, refreshAccessToken]
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
    if (!user || IS_NATIVE) return;
    void refreshAccessToken({ interactive: false });
  }, [user, refreshAccessToken]);

  useEffect(() => {
    if (!user || IS_NATIVE) return;
    if (!accessTokenExpiresAt) return;
    const now = Date.now();
    const refreshAt = Math.max(accessTokenExpiresAt - ACCESS_TOKEN_REFRESH_BUFFER_MS, now + 30_000);
    const timeout = window.setTimeout(() => {
      void refreshAccessToken({ interactive: false });
    }, refreshAt - now);
    return () => window.clearTimeout(timeout);
  }, [user, accessTokenExpiresAt, refreshAccessToken]);

  useEffect(() => {
    if (!user || IS_NATIVE) return;
    const maybeRefresh = () => {
      const expiresAt = accessTokenExpiresAt;
      if (!accessTokenRef.current) {
        void refreshAccessToken({ interactive: false });
        return;
      }
      if (expiresAt && Date.now() >= expiresAt - ACCESS_TOKEN_REFRESH_BUFFER_MS) {
        void refreshAccessToken({ interactive: false });
      }
    };
    const onFocus = () => maybeRefresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        maybeRefresh();
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user, accessTokenExpiresAt, refreshAccessToken]);

  useEffect(() => {
    if (!ACCESS_TOKEN_EXPIRY_ENFORCED) return;
    if (!accessToken || !accessTokenExpiresAt) return;
    if (Date.now() >= accessTokenExpiresAt) {
      expireToken();
      return;
    }
    const timeout = window.setTimeout(() => {
      expireToken();
    }, accessTokenExpiresAt - Date.now());
    return () => window.clearTimeout(timeout);
  }, [accessToken, accessTokenExpiresAt]);

  useEffect(() => {
    if (!ACCESS_TOKEN_EXPIRY_ENFORCED) return;
    const checkStoredExpiry = () => {
      const primary = readTokenEntryFromKey(ACCESS_TOKEN_KEY);
      const legacy = primary ? null : readTokenEntryFromKey(LEGACY_ACCESS_TOKEN_KEY);
      const entry = primary || legacy;
      if (!entry) return;
      const expiresAt = fallbackExpiresAt(entry.storedAt);
      if (expiresAt && Date.now() >= expiresAt) {
        expireToken();
        persistTokenEntry(null);
        return;
      }
      if (legacy) {
        persistTokenEntry(legacy);
      }
    };
    checkStoredExpiry();
    const interval = window.setInterval(() => {
      checkStoredExpiry();
    }, 15 * 1000);
    const onStorage = (event: StorageEvent) => {
      if (event.key === ACCESS_TOKEN_KEY || event.key === LEGACY_ACCESS_TOKEN_KEY) {
        checkStoredExpiry();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

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
      void notifyAuthEmail(result.user);
      void refreshAccessToken({ interactive: false, force: true });
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
  const markTokenExpired = useCallback(() => setTokenExpired(true), []);

  return {
    user,
    accessToken,
    accessTokenExpiresAt,
    tokenExpired,
    clearTokenExpired,
    markTokenExpired,
    loading,
    error,
    getAccessToken,
    signIn,
    signOut: signOutUser
  };
};






