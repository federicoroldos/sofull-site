import { useEffect, useState } from 'react';
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
provider.setCustomParameters({ prompt: 'select_account consent' });

const ACCESS_TOKEN_KEY = 'ramyeon-google-access-token';
const ACCESS_TOKEN_TTL_MS = 50 * 60 * 1000;

const readStoredToken = () => {
  try {
    const raw = localStorage.getItem(ACCESS_TOKEN_KEY);
    if (!raw) return { token: null, expiresAt: null };
    const parsed = JSON.parse(raw) as { token: string; storedAt: number };
    if (!parsed?.token || typeof parsed.storedAt !== 'number') {
      return { token: null, expiresAt: null };
    }
    const expiresAt = parsed.storedAt + ACCESS_TOKEN_TTL_MS;
    if (Date.now() > expiresAt) return { token: null, expiresAt: null };
    return { token: parsed.token, expiresAt };
  } catch {
    return { token: null, expiresAt: null };
  }
};

const persistToken = (token: string | null) => {
  try {
    if (!token) {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      return;
    }
    localStorage.setItem(
      ACCESS_TOKEN_KEY,
      JSON.stringify({ token, storedAt: Date.now() })
    );
  } catch {
  }
};

export const useGoogleAuth = () => {
  const auth = getAuth(firebaseApp);
  const stored = readStoredToken();
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [accessToken, setAccessToken] = useState<string | null>(stored.token);
  const [accessTokenExpiresAt, setAccessTokenExpiresAt] = useState<number | null>(stored.expiresAt);
  const [tokenExpired, setTokenExpired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expireToken = () => {
    setAccessToken(null);
    setAccessTokenExpiresAt(null);
    persistToken(null);
    setTokenExpired(true);
  };

  useEffect(() => {
    let active = true;
    setPersistence(auth, browserLocalPersistence).catch((err) => {
      if (!active) return;
      const message = err instanceof Error ? err.message : 'Unable to enable local sign-in persistence.';
      setError(message);
    });
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setAccessToken(null);
        setAccessTokenExpiresAt(null);
        persistToken(null);
      }
    });
    return () => {
      active = false;
      unsub();
    };
  }, [auth]);

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
      try {
        const raw = localStorage.getItem(ACCESS_TOKEN_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { token: string; storedAt: number };
        if (!parsed?.token || typeof parsed.storedAt !== 'number') return;
        const expiresAt = parsed.storedAt + ACCESS_TOKEN_TTL_MS;
        if (Date.now() >= expiresAt) {
          expireToken();
        }
      } catch {
      }
    };
    checkStoredExpiry();
    const interval = window.setInterval(() => {
      checkStoredExpiry();
    }, 15 * 1000);
    const onStorage = (event: StorageEvent) => {
      if (event.key === ACCESS_TOKEN_KEY) {
        checkStoredExpiry();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.clearInterval(interval);
  }, []);

  const signIn = async () => {
    setLoading(true);
    setError(null);
    try {
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
