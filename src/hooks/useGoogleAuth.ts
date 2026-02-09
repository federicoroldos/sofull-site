import { useCallback, useEffect, useState } from 'react';
import { firebaseApp } from '../firebase';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut
} from 'firebase/auth';
import type { User } from 'firebase/auth';

const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive.appdata');
provider.addScope('https://www.googleapis.com/auth/drive.file');
provider.setCustomParameters({ prompt: 'select_account consent' });

const ACCESS_TOKEN_KEY = 'sofull-google-access-token';
const LEGACY_ACCESS_TOKEN_KEY = 'ramyeon-google-access-token';
const ACCESS_TOKEN_TTL_MS = 50 * 60 * 1000;
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

const resolveAuthEmailEndpoint = () => {
  if (!AUTH_EMAIL_ENDPOINT) return '';
  try {
    const raw = String(AUTH_EMAIL_ENDPOINT).trim();
    const url = new URL(raw, window.location.origin);
    const isAbsolute = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw);
    if (!isAbsolute) return url.toString();
    const currentHost = window.location.hostname;
    const endpointHost = url.hostname;
    const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(currentHost);
    const endpointIsVercel = endpointHost.endsWith('.vercel.app');
    if (!isLocal && endpointIsVercel && currentHost !== endpointHost) {
      return new URL(`${url.pathname}${url.search}${url.hash}`, window.location.origin).toString();
    }
    return url.toString();
  } catch {
    return AUTH_EMAIL_ENDPOINT;
  }
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

const toTokenState = (entry: { token: string; storedAt: number }) => {
  const expiresAt = entry.storedAt + ACCESS_TOKEN_TTL_MS;
  if (Date.now() > expiresAt) return { token: null, expiresAt: null };
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

const notifyAuthEmail = async (user: User) => {
  const endpoint = resolveAuthEmailEndpoint();
  if (!endpoint) return;
  try {
    const idToken = await user.getIdToken();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const locale = navigator.language;
    const headers: Record<string, string> = { Authorization: `Bearer ${idToken}` };
    if (timezone) headers['X-Client-Timezone'] = timezone;
    if (locale) headers['X-Client-Locale'] = locale;
    await fetch(endpoint, {
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

  const updateSessionStart = useCallback((value: number | null) => {
    setSessionStartMs(value);
    persistSessionStart(value);
  }, []);

  const expireToken = () => {
    setAccessToken(null);
    setAccessTokenExpiresAt(null);
    persistToken(null);
    setTokenExpired(true);
  };

  const forceSessionLogout = useCallback(async (reason?: string) => {
    setLoading(true);
    try {
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
    const checkStoredExpiry = () => {
      const primary = readTokenEntryFromKey(ACCESS_TOKEN_KEY);
      const legacy = primary ? null : readTokenEntryFromKey(LEGACY_ACCESS_TOKEN_KEY);
      const entry = primary || legacy;
      if (!entry) return;
      const expiresAt = entry.storedAt + ACCESS_TOKEN_TTL_MS;
      if (Date.now() >= expiresAt) {
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
      await setPersistence(auth, browserLocalPersistence);
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential && credential.accessToken) {
        setAccessToken(credential.accessToken);
        setAccessTokenExpiresAt(Date.now() + ACCESS_TOKEN_TTL_MS);
        persistToken(credential.accessToken);
        setTokenExpired(false);
      } else {
        setAccessToken(null);
        setAccessTokenExpiresAt(null);
        persistToken(null);
      }
      updateSessionStart(Date.now());
      void notifyAuthEmail(result.user);
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
      await signOut(auth);
      setAccessToken(null);
      setAccessTokenExpiresAt(null);
      persistToken(null);
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
    signIn,
    signOut: signOutUser
  };
};






