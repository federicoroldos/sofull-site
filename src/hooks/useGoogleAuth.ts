import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  FirebaseAuthentication,
  type SignInWithGoogleOptions
} from '@capacitor-firebase/authentication';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';
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
provider.addScope('https://www.googleapis.com/auth/drive.appdata');
provider.addScope('https://www.googleapis.com/auth/drive.file');
provider.setCustomParameters({ prompt: 'select_account consent' });

const NATIVE_GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/drive.file'
];
const NATIVE_GOOGLE_PARAMS = [{ key: 'prompt', value: 'select_account consent' }];
const NATIVE_GOOGLE_OPTIONS: SignInWithGoogleOptions = {
  scopes: NATIVE_GOOGLE_SCOPES,
  customParameters: NATIVE_GOOGLE_PARAMS
};

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

const isNative = Capacitor.isNativePlatform();

const readStorageValue = async (key: string) => {
  if (isNative) {
    try {
      const result = await SecureStoragePlugin.get({ key });
      return result?.value ?? null;
    } catch {
      return null;
    }
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorageValue = async (key: string, value: string | null) => {
  if (isNative) {
    try {
      if (value === null) {
        await SecureStoragePlugin.remove({ key });
      } else {
        await SecureStoragePlugin.set({ key, value });
      }
    } catch {
      // Ignore storage write failures.
    }
    return;
  }
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // Ignore storage write failures.
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

const readTokenEntryFromKey = async (key: string) =>
  parseStoredToken(await readStorageValue(key));

const persistTokenEntry = async (entry: { token: string; storedAt: number } | null) => {
  try {
    if (!entry) {
      await writeStorageValue(ACCESS_TOKEN_KEY, null);
      await writeStorageValue(LEGACY_ACCESS_TOKEN_KEY, null);
      return;
    }
    await writeStorageValue(ACCESS_TOKEN_KEY, JSON.stringify(entry));
    await writeStorageValue(LEGACY_ACCESS_TOKEN_KEY, null);
  } catch {
    // Ignore storage write failures.
  }
};

const toTokenState = (entry: { token: string; storedAt: number }) => {
  const expiresAt = entry.storedAt + ACCESS_TOKEN_TTL_MS;
  if (Date.now() > expiresAt) return { token: null, expiresAt: null };
  return { token: entry.token, expiresAt };
};

const readStoredToken = async () => {
  const primary = await readTokenEntryFromKey(ACCESS_TOKEN_KEY);
  if (primary) return toTokenState(primary);
  const legacy = await readTokenEntryFromKey(LEGACY_ACCESS_TOKEN_KEY);
  if (legacy) {
    const state = toTokenState(legacy);
    if (state.token) {
      await persistTokenEntry(legacy);
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

const readSessionStart = async () => {
  const primary = parseSessionStart(await readStorageValue(SESSION_START_KEY));
  if (primary) return primary;
  const legacy = parseSessionStart(await readStorageValue(LEGACY_SESSION_START_KEY));
  if (legacy) {
    await persistSessionStart(legacy);
    return legacy;
  }
  return null;
};

const persistSessionStart = async (timestamp: number | null) => {
  try {
    if (!timestamp) {
      await writeStorageValue(SESSION_START_KEY, null);
      await writeStorageValue(LEGACY_SESSION_START_KEY, null);
      return;
    }
    await writeStorageValue(SESSION_START_KEY, String(timestamp));
    await writeStorageValue(LEGACY_SESSION_START_KEY, null);
  } catch {
    // Ignore storage write failures.
  }
};

const isSessionExpired = (sessionStartMs: number, now: number) =>
  now - sessionStartMs >= SESSION_DURATION_MS;

const persistToken = async (token: string | null) => {
  try {
    if (!token) {
      await persistTokenEntry(null);
      return;
    }
    await persistTokenEntry({ token, storedAt: Date.now() });
  } catch {
    // Ignore storage write failures.
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
  const [storageReady, setStorageReady] = useState(false);
  const [sessionStartMs, setSessionStartMs] = useState<number | null>(null);
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [accessTokenExpiresAt, setAccessTokenExpiresAt] = useState<number | null>(null);
  const [tokenExpired, setTokenExpired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateSessionStart = useCallback((value: number | null) => {
    setSessionStartMs(value);
    void persistSessionStart(value);
  }, []);

  const expireToken = useCallback(() => {
    setAccessToken(null);
    setAccessTokenExpiresAt(null);
    void persistToken(null);
    setTokenExpired(true);
  }, []);

  const forceSessionLogout = useCallback(
    async (reason?: string) => {
      setLoading(true);
      try {
        if (isNative) {
          await FirebaseAuthentication.signOut();
        }
        await signOut(auth);
      } catch {
        // Ignore sign-out failures; we'll still clear local state.
      } finally {
        setAccessToken(null);
        setAccessTokenExpiresAt(null);
        void persistToken(null);
        updateSessionStart(null);
        setTokenExpired(false);
        setUser(null);
        setLoading(false);
        setError(reason || null);
      }
    },
    [auth, updateSessionStart]
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const stored = await readStoredToken();
      const storedSession = await readSessionStart();
      if (!active) return;
      setAccessToken(stored.token);
      setAccessTokenExpiresAt(stored.expiresAt);
      setSessionStartMs(storedSession);
      setStorageReady(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    let active = true;
    setPersistence(auth, browserLocalPersistence).catch((err) => {
      if (!active) return;
      const message = err instanceof Error ? err.message : 'Unable to enable local sign-in persistence.';
      setError(message);
    });
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      const now = Date.now();
      if (nextUser) {
        const effectiveStart = sessionStartMs ?? now;
        if (!sessionStartMs) {
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
      void persistToken(null);
      updateSessionStart(null);
    });
    return () => {
      active = false;
      unsub();
    };
  }, [auth, forceSessionLogout, sessionStartMs, storageReady, updateSessionStart]);

  useEffect(() => {
    if (!storageReady || !user || !sessionStartMs) return;
    const checkSessionExpiry = () => {
      if (isSessionExpired(sessionStartMs, Date.now())) {
        void forceSessionLogout('Session expired. Sign in again to continue.');
      }
    };
    checkSessionExpiry();
    const interval = window.setInterval(checkSessionExpiry, 60 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [user, sessionStartMs, forceSessionLogout, storageReady]);

  useEffect(() => {
    if (!storageReady || !accessToken || !accessTokenExpiresAt) return;
    if (Date.now() >= accessTokenExpiresAt) {
      expireToken();
      return;
    }
    const timeout = window.setTimeout(() => {
      expireToken();
    }, accessTokenExpiresAt - Date.now());
    return () => window.clearTimeout(timeout);
  }, [accessToken, accessTokenExpiresAt, expireToken, storageReady]);

  useEffect(() => {
    if (!storageReady || isNative) return;
    const checkStoredExpiry = async () => {
      const primary = await readTokenEntryFromKey(ACCESS_TOKEN_KEY);
      const legacy = primary ? null : await readTokenEntryFromKey(LEGACY_ACCESS_TOKEN_KEY);
      const entry = primary || legacy;
      if (!entry) return;
      const expiresAt = entry.storedAt + ACCESS_TOKEN_TTL_MS;
      if (Date.now() >= expiresAt) {
        expireToken();
        await persistTokenEntry(null);
        return;
      }
      if (legacy) {
        await persistTokenEntry(legacy);
      }
    };
    void checkStoredExpiry();
    const interval = window.setInterval(() => {
      void checkStoredExpiry();
    }, 15 * 1000);
    const onStorage = (event: StorageEvent) => {
      if (event.key === ACCESS_TOKEN_KEY || event.key === LEGACY_ACCESS_TOKEN_KEY) {
        void checkStoredExpiry();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('storage', onStorage);
    };
  }, [expireToken, storageReady]);

  useEffect(() => {
    if (!isNative || !storageReady) return;
    let cancelled = false;
    const restore = async () => {
      if (cancelled) return;
      if (auth.currentUser) return;
      if (!accessToken || !accessTokenExpiresAt) return;
      if (Date.now() >= accessTokenExpiresAt) return;
      if (sessionStartMs && isSessionExpired(sessionStartMs, Date.now())) return;
      try {
        const nativeUser = await FirebaseAuthentication.getCurrentUser();
        if (!nativeUser?.user) return;
        const idTokenResult = await FirebaseAuthentication.getIdToken({ forceRefresh: false });
        if (!idTokenResult?.token) return;
        const credential = GoogleAuthProvider.credential(idTokenResult.token, accessToken);
        await signInWithCredential(auth, credential);
      } catch {
        // Ignore restore failures; user can sign in again.
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, [accessToken, accessTokenExpiresAt, auth, sessionStartMs, storageReady]);

  const signIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await setPersistence(auth, browserLocalPersistence);
      let nextUser: User | null = null;
      let nextAccessToken: string | null = null;

      if (isNative) {
        const result = await FirebaseAuthentication.signInWithGoogle(NATIVE_GOOGLE_OPTIONS);
        const idToken = result.credential?.idToken || '';
        const accessTokenValue = result.credential?.accessToken || '';
        if (idToken) {
          const credential = GoogleAuthProvider.credential(idToken, accessTokenValue || undefined);
          const firebaseResult = await signInWithCredential(auth, credential);
          nextUser = firebaseResult.user;
        }
        nextAccessToken = accessTokenValue || null;
      } else {
        const result = await signInWithPopup(auth, provider);
        const credential = GoogleAuthProvider.credentialFromResult(result);
        nextUser = result.user;
        nextAccessToken = credential?.accessToken || null;
      }

      if (nextAccessToken) {
        setAccessToken(nextAccessToken);
        setAccessTokenExpiresAt(Date.now() + ACCESS_TOKEN_TTL_MS);
        void persistToken(nextAccessToken);
        setTokenExpired(false);
      } else {
        setAccessToken(null);
        setAccessTokenExpiresAt(null);
        void persistToken(null);
      }
      updateSessionStart(Date.now());
      if (nextUser) {
        void notifyAuthEmail(nextUser);
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
      if (isNative) {
        await FirebaseAuthentication.signOut();
      }
      await signOut(auth);
      setAccessToken(null);
      setAccessTokenExpiresAt(null);
      void persistToken(null);
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
