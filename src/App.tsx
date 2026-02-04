import { useEffect, useMemo, useRef, useState } from 'react';
import EntryCard from './components/EntryCard';
import EntryFormModal, { type EntryFormSubmitValues } from './components/EntryFormModal';
import { useGoogleAuth } from './hooks/useGoogleAuth';
import {
  downloadFromAppData,
  ensureAppDataFile,
  ensureFolder,
  fetchFileBlob,
  uploadFileMultipart,
  uploadToAppData
} from './utils/googleDriveClient';
import { sanitizeEntries, sanitizeUrl } from './utils/sanitize';
import type { RamyeonDataFile, RamyeonEntry } from './types/ramyeon';

const DEFAULT_DATA: RamyeonDataFile = {
  version: 1,
  updatedAt: new Date().toISOString(),
  entries: []
};

const demoEntries: RamyeonEntry[] = [
  {
    id: 'demo-1',
    name: '진라면',
    nameEnglish: 'Shin Ramyeon',
    brand: 'Ottogi',
    formFactor: 'packet',
    rating: 4,
    spiciness: 'medium',
    description: 'Clean beefy broth, gentle spice, and a chewy bite.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

const DRIVE_ROOT_FOLDER_NAME = 'Ramyeon Dictionary';
const DRIVE_IMAGE_FOLDER_NAME = 'images';
const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;

const nowIso = () => new Date().toISOString();

const parseDataFile = (payload: string): RamyeonDataFile => {
  if (!payload || payload.trim().length === 0) {
    return { ...DEFAULT_DATA, updatedAt: nowIso() };
  }
  try {
    const parsed = JSON.parse(payload) as RamyeonDataFile;
    if (!parsed || !Array.isArray(parsed.entries)) {
      return { ...DEFAULT_DATA, updatedAt: nowIso() };
    }
    return {
      version: parsed.version ?? 1,
      updatedAt: parsed.updatedAt ?? nowIso(),
      entries: sanitizeEntries(parsed.entries)
    };
  } catch {
    return { ...DEFAULT_DATA, updatedAt: nowIso() };
  }
};

const createId = () => (crypto?.randomUUID ? crypto.randomUUID() : `ramyeon-${Date.now()}`);

const App = () => {
  const {
    user,
    accessToken,
    tokenExpired,
    clearTokenExpired,
    loading: authLoading,
    error: authError,
    signIn,
    signOut
  } = useGoogleAuth();
  const [entries, setEntries] = useState<RamyeonEntry[]>([]);
  const [sortMode, setSortMode] = useState<'alpha-en' | 'alpha-ko' | 'rating'>('alpha-ko');
  const [query, setQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<RamyeonEntry | null>(null);
  const [driveFileId, setDriveFileId] = useState('');
  const [syncState, setSyncState] = useState<'idle' | 'loading' | 'saving' | 'error'>('idle');
  const [syncMessage, setSyncMessage] = useState('');
  const [driveImageUrls, setDriveImageUrls] = useState<Record<string, string>>({});
  const driveImageCacheRef = useRef(new Map<string, string>());
  const driveImageLoadsRef = useRef(new Map<string, Promise<string>>());
  const failedDriveImageRef = useRef(new Set<string>());
  const imageFolderIdRef = useRef<string | null>(null);

  const isLoggedIn = Boolean(user && accessToken);

  const collatorEn = useMemo(() => new Intl.Collator('en', { sensitivity: 'base' }), []);
  const collatorKo = useMemo(() => new Intl.Collator('ko', { sensitivity: 'base' }), []);

  const visibleEntries = useMemo(() => {
    const source = entries.length > 0 ? entries : isLoggedIn ? [] : demoEntries;
    const filtered = source.filter((entry) => {
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        entry.name.toLowerCase().includes(q) ||
        entry.nameEnglish?.toLowerCase().includes(q) ||
        entry.brand.toLowerCase().includes(q)
      );
    });

    const sorted = [...filtered];
    if (sortMode === 'rating') {
      sorted.sort((a, b) => b.rating - a.rating || collatorKo.compare(a.name, b.name));
    } else if (sortMode === 'alpha-en') {
      sorted.sort((a, b) =>
        collatorEn.compare(a.nameEnglish || a.name, b.nameEnglish || b.name)
      );
    } else {
      sorted.sort((a, b) => collatorKo.compare(a.name, b.name));
    }
    return sorted;
  }, [entries, isLoggedIn, query, sortMode, collatorEn, collatorKo]);

  const resolveEntryImage = (entry: RamyeonEntry) => {
    if (entry.imageDriveFileId) {
      const driveSrc = driveImageUrls[entry.imageDriveFileId];
      if (driveSrc) return driveSrc;
    }
    return sanitizeUrl(entry.imageUrl);
  };

  const openCreate = () => {
    setEditingEntry(null);
    setModalOpen(true);
  };

  const openEdit = (entry: RamyeonEntry) => {
    setEditingEntry(entry);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingEntry(null);
  };

  const saveToDrive = async (nextEntries: RamyeonEntry[]) => {
    if (!accessToken || !driveFileId) return;
    setSyncState('saving');
    setSyncMessage('Saving to Google Drive...');
    try {
      const sanitizedEntries = sanitizeEntries(nextEntries);
      const payload: RamyeonDataFile = {
        version: 1,
        updatedAt: nowIso(),
        entries: sanitizedEntries
      };
      await uploadToAppData(accessToken, driveFileId, JSON.stringify(payload, null, 2));
      setSyncState('idle');
      setSyncMessage(`Last synced ${new Date().toLocaleTimeString([], { hour12: false })}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Drive sync failed.';
      setSyncState('error');
      setSyncMessage(message);
    }
  };

  const ensureImageFolderId = async () => {
    if (!accessToken) {
      throw new Error('Google session expired. Sign in again and retry.');
    }
    if (imageFolderIdRef.current) {
      return imageFolderIdRef.current;
    }
    const rootFolderId = await ensureFolder(accessToken, DRIVE_ROOT_FOLDER_NAME);
    const imagesFolderId = await ensureFolder(accessToken, DRIVE_IMAGE_FOLDER_NAME, rootFolderId);
    imageFolderIdRef.current = imagesFolderId;
    return imagesFolderId;
  };

  const handleSaveEntry = async (values: EntryFormSubmitValues) => {
    if (!accessToken) {
      throw new Error('Google session expired. Sign in again before saving.');
    }

    let nextImageDriveFileId = editingEntry?.imageDriveFileId || '';
    let nextImageMimeType = editingEntry?.imageMimeType || '';
    let nextImageName = editingEntry?.imageName || '';
    let nextImageUrl = values.imageUrl;

    if (values.clearImage) {
      nextImageDriveFileId = '';
      nextImageMimeType = '';
      nextImageName = '';
      nextImageUrl = '';
    }

    if (values.imageFile) {
      if (!values.imageFile.type.startsWith('image/')) {
        throw new Error('Please choose a valid image file.');
      }
      if (values.imageFile.size > MAX_IMAGE_SIZE_BYTES) {
        throw new Error('Image size must be 8MB or less.');
      }
      const folderId = await ensureImageFolderId();
      const uploadedImage = await uploadFileMultipart(accessToken, values.imageFile, folderId);
      nextImageDriveFileId = uploadedImage.id;
      nextImageMimeType = uploadedImage.mimeType;
      nextImageName = uploadedImage.name;
    }

    const entryPayload = {
      name: values.name,
      nameEnglish: values.nameEnglish,
      brand: values.brand,
      formFactor: values.formFactor,
      rating: values.rating,
      spiciness: values.spiciness,
      description: values.description,
      imageUrl: nextImageUrl,
      imageDriveFileId: nextImageDriveFileId,
      imageMimeType: nextImageMimeType,
      imageName: nextImageName
    };

    if (editingEntry) {
      const updatedEntry: RamyeonEntry = {
        ...editingEntry,
        ...entryPayload,
        updatedAt: nowIso()
      };
      const nextEntries = sanitizeEntries(
        entries.map((entry) => (entry.id === editingEntry.id ? updatedEntry : entry))
      );
      setEntries(nextEntries);
      await saveToDrive(nextEntries);
    } else {
      const newEntry: RamyeonEntry = {
        id: createId(),
        createdAt: nowIso(),
        updatedAt: nowIso(),
        ...entryPayload
      };
      const nextEntries = sanitizeEntries([newEntry, ...entries]);
      setEntries(nextEntries);
      await saveToDrive(nextEntries);
    }

    closeModal();
  };

  const handleDelete = (entry: RamyeonEntry) => {
    if (!window.confirm(`Delete ${entry.name}?`)) return;
    const nextEntries = entries.filter((item) => item.id !== entry.id);
    setEntries(nextEntries);
    void saveToDrive(nextEntries);
  };

  useEffect(() => () => {
    for (const objectUrl of driveImageCacheRef.current.values()) {
      URL.revokeObjectURL(objectUrl);
    }
    driveImageCacheRef.current.clear();
    driveImageLoadsRef.current.clear();
    failedDriveImageRef.current.clear();
  }, []);

  useEffect(() => {
    if (!accessToken) {
      const resetStateTimer = window.setTimeout(() => {
        setEntries([]);
        setDriveFileId('');
        setSyncState('idle');
        setSyncMessage('');
        setDriveImageUrls({});
      }, 0);
      imageFolderIdRef.current = null;

      for (const objectUrl of driveImageCacheRef.current.values()) {
        URL.revokeObjectURL(objectUrl);
      }
      driveImageCacheRef.current.clear();
      driveImageLoadsRef.current.clear();
      failedDriveImageRef.current.clear();
      return () => window.clearTimeout(resetStateTimer);
    }

    let cancelled = false;
    const load = async () => {
      setSyncState('loading');
      setSyncMessage('Loading from Google Drive...');
      try {
        const fileId = await ensureAppDataFile(accessToken);
        if (cancelled) return;
        setDriveFileId(fileId);
        const content = await downloadFromAppData(accessToken, fileId);
        if (cancelled) return;
        const data = parseDataFile(content);
        setEntries(data.entries || []);
        setSyncState('idle');
        setSyncMessage(`Loaded ${data.entries.length} entries.`);
        if (!content || content.trim().length === 0) {
          await uploadToAppData(accessToken, fileId, JSON.stringify(DEFAULT_DATA, null, 2));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Drive load failed.';
        setSyncState('error');
        setSyncMessage(message);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  useEffect(() => {
    const activeIds = new Set(
      entries
        .map((entry) => entry.imageDriveFileId)
        .filter((fileId): fileId is string => Boolean(fileId))
    );

    let changed = false;
    for (const [fileId, objectUrl] of driveImageCacheRef.current.entries()) {
      if (activeIds.has(fileId)) continue;
      URL.revokeObjectURL(objectUrl);
      driveImageCacheRef.current.delete(fileId);
      driveImageLoadsRef.current.delete(fileId);
      failedDriveImageRef.current.delete(fileId);
      changed = true;
    }

    if (changed) {
      setDriveImageUrls(Object.fromEntries(driveImageCacheRef.current.entries()));
    }
  }, [entries]);

  useEffect(() => {
    if (!accessToken) return;

    const missingIds = Array.from(
      new Set(
        entries
          .map((entry) => entry.imageDriveFileId)
          .filter((fileId): fileId is string => {
            if (!fileId) return false;
            if (driveImageCacheRef.current.has(fileId)) return false;
            if (driveImageLoadsRef.current.has(fileId)) return false;
            if (failedDriveImageRef.current.has(fileId)) return false;
            return true;
          })
      )
    );

    if (missingIds.length === 0) return;

    let cancelled = false;
    const loadImage = async (fileId: string) => {
      const request = fetchFileBlob(accessToken, fileId)
        .then((blob) => {
          const objectUrl = URL.createObjectURL(blob);
          if (cancelled) {
            URL.revokeObjectURL(objectUrl);
            return '';
          }
          driveImageCacheRef.current.set(fileId, objectUrl);
          return objectUrl;
        })
        .catch(() => {
          failedDriveImageRef.current.add(fileId);
          return '';
        })
        .finally(() => {
          driveImageLoadsRef.current.delete(fileId);
        });
      driveImageLoadsRef.current.set(fileId, request);
      return request;
    };

    void Promise.all(missingIds.map((fileId) => loadImage(fileId))).then(() => {
      if (cancelled) return;
      setDriveImageUrls(Object.fromEntries(driveImageCacheRef.current.entries()));
    });

    return () => {
      cancelled = true;
    };
  }, [entries, accessToken]);

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <p className="app__eyebrow">라면 사전</p>
          <h1>Ramyeon Dictionary</h1>
          <p className="app__subtitle">
            Track and rate the ramyeon you’ve tried
          </p>
        </div>
        <div className="auth">
          {isLoggedIn ? (
            <>
              <div className="auth__user">
                <span>{user?.displayName || user?.email}</span>
                <span className="auth__hint">Signed in</span>
              </div>
              <button className="button button--ghost" onClick={signOut} disabled={authLoading}>
                Sign out
              </button>
            </>
          ) : (
            <button className="button" onClick={signIn} disabled={authLoading}>
              Sign in with Google
            </button>
          )}
        </div>
      </header>

      <section className="toolbar">
        <div className="toolbar__left">
          <button className="button" onClick={openCreate} disabled={!isLoggedIn}>
            Add Ramyeon
          </button>
          <div className="field field--search">
            <label htmlFor="search" className="sr-only">
              Search
            </label>
            <input
              id="search"
              placeholder="Search by name or brand"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        <div className="toolbar__right">
          <label className="sort">
            <span>Sort</span>
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value as typeof sortMode)}>
              <option value="alpha-ko">Alphabetical (Hangul)</option>
              <option value="alpha-en">Alphabetical (English)</option>
              <option value="rating">Best rated</option>
            </select>
          </label>
        </div>
      </section>

      <section className="status">
        {!isLoggedIn && (
          <p className={`status__message ${authError ? 'status__message--error' : ''}`}>
            {authError || 'Sign in to add, edit, and sync your ramyeon list.'}
          </p>
        )}
        {isLoggedIn && (
          <p className={`status__message status__message--${syncState}`}>
            {syncMessage || 'Drive sync ready.'}
          </p>
        )}
      </section>

      <main className="list">
        {visibleEntries.length === 0 ? (
          <div className="empty-state">
            <p>No ramyeon entries yet.</p>
            <p>Add your first one to start the dictionary.</p>
          </div>
        ) : (
          visibleEntries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              driveImageUrl={resolveEntryImage(entry)}
              onEdit={openEdit}
              onDelete={handleDelete}
              canEdit={isLoggedIn}
            />
          ))
        )}
      </main>

      <EntryFormModal
        isOpen={modalOpen}
        initial={editingEntry}
        initialImageSrc={editingEntry ? resolveEntryImage(editingEntry) : ''}
        onClose={closeModal}
        onSave={handleSaveEntry}
      />

      {tokenExpired && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="session-expired-title">
          <div className="modal__backdrop" />
          <div className="modal__content">
            <div className="modal__header">
              <h2 id="session-expired-title">Session expired</h2>
            </div>
            <p>Your Google access token expired. Refresh the page and sign in again to continue syncing.</p>
            <div className="modal__footer">
              <button className="button button--ghost" onClick={clearTokenExpired}>
                Dismiss
              </button>
              <button className="button" onClick={() => window.location.reload()}>
                Refresh & sign in
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="app__footer">
        <span>© 2026 Federico Roldós. All rights reserved.</span>
        <div className="app__footer-links">
          <a href="/privacy.html">Privacy Policy</a>
          <a href="/terms.html">Terms of Service</a>
        </div>
      </footer>
    </div>
  );
};

export default App;
