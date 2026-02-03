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
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token: string; storedAt: number };
    if (!parsed?.token || typeof parsed.storedAt !== 'number') return null;
    if (Date.now() - parsed.storedAt > ACCESS_TOKEN_TTL_MS) return null;
    return parsed.token;
  } catch {
    return null;
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
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [accessToken, setAccessToken] = useState<string | null>(() => readStoredToken());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        persistToken(null);
      }
    });
    return () => {
      active = false;
      unsub();
    };
  }, [auth]);

  const signIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential && credential.accessToken) {
        setAccessToken(credential.accessToken);
        persistToken(credential.accessToken);
      } else {
        setAccessToken(null);
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
      persistToken(null);
      setError(null);
    } finally {
      setLoading(false);
    }
  };

  return { user, accessToken, loading, error, signIn, signOut: signOutUser };
};
