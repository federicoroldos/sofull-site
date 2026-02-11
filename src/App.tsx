import { useEffect, useMemo, useRef, useState } from 'react';
import EntryCard from './components/EntryCard';
import EntryFormModal, { type EntryFormSubmitValues } from './components/EntryFormModal';
import { useGoogleAuth } from './hooks/useGoogleAuth';
import {
  deleteDriveFile,
  downloadFromAppData,
  ensureAppDataFile,
  ensureFolder,
  fetchFileBlob,
  updateDriveFileName,
  uploadFileMultipart,
  uploadToAppData
} from './utils/googleDriveClient';
import { sanitizeEntries } from './utils/sanitize';
import type { SofullDataFile, SofullEntry, SpicinessLevel } from './types/sofull';

const DEFAULT_DATA: SofullDataFile = {
  version: 1,
  updatedAt: new Date().toISOString(),
  entries: []
};

const demoEntries: SofullEntry[] = [
  {
    id: 'demo-1',
    name: '신라면',
    nameEnglish: 'Shin Ramyeon',
    brand: 'Ottogi',
    category: 'ramyeon',
    formFactor: 'packet',
    iceCreamFormFactor: 'bar',
    rating: 4,
    spiciness: 'medium',
    description: 'Clean beefy broth, gentle spice, and a chewy bite.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'demo-2',
    name: '바나나우유',
    nameEnglish: 'Banana Milk',
    brand: 'Binggrae',
    category: 'drink',
    formFactor: 'cup',
    iceCreamFormFactor: 'cream',
    rating: 5,
    spiciness: 'hot',
    description: 'Sweet, creamy, banana-flavored milk.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

const DRIVE_ROOT_FOLDER_NAME = '배불러! (So Full!)';
const DRIVE_IMAGE_FOLDER_NAME = 'images';
const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;

const nowIso = () => new Date().toISOString();
type SortMode =
  | 'latest'
  | 'rating'
  | 'most-spicy'
  | 'most-crunchy'
  | 'most-sweet'
  | 'most-creamy'
  | 'alpha-ko'
  | 'alpha-en';
type CategoryFilter = 'all' | 'ramyeon' | 'snack' | 'drink' | 'ice_cream';
const SPICE_ORDER: Record<SpicinessLevel, number> = {
  'not-spicy': 0,
  mild: 1,
  medium: 2,
  hot: 3,
  extreme: 4
};
const ATTRIBUTE_SORT_BY_CATEGORY: Record<
  CategoryFilter,
  { sortMode: SortMode; label: string } | null
> = {
  all: null,
  ramyeon: { sortMode: 'most-spicy', label: 'Most spicy' },
  snack: { sortMode: 'most-crunchy', label: 'Most crunchy' },
  drink: { sortMode: 'most-sweet', label: 'Most sweet' },
  ice_cream: { sortMode: 'most-creamy', label: 'Most creamy' }
};
const createdAtToMs = (entry: SofullEntry) => {
  const timestamp = Date.parse(entry.createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
};
const isAttributeSort = (mode: SortMode) =>
  mode === 'most-spicy' ||
  mode === 'most-crunchy' ||
  mode === 'most-sweet' ||
  mode === 'most-creamy';

const parseDataFile = (payload: string): SofullDataFile => {
  if (!payload || payload.trim().length === 0) {
    return { ...DEFAULT_DATA, updatedAt: nowIso() };
  }
  try {
    const parsed = JSON.parse(payload) as SofullDataFile;
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

const createId = () =>
  (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `sofull-${Date.now()}`);
const normalizeFileNamePart = (value: string) => value.replace(/[\\/]+/g, '-').replace(/\s+/g, ' ').trim();
const buildImageFileName = (name: string, nameEnglish: string, originalFileName: string) => {
  const koreanName = normalizeFileNamePart(name);
  const englishName = normalizeFileNamePart(nameEnglish);
  const baseName = englishName ? `${koreanName} (${englishName})` : koreanName;
  const extensionMatch = originalFileName.match(/\.[a-zA-Z0-9]+$/);
  const extension = extensionMatch ? extensionMatch[0] : '';
  return `${baseName}${extension}`;
};

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
  const [entries, setEntries] = useState<SofullEntry[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>('latest');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [query, setQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<SofullEntry | null>(null);
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
  const attributeSortOption = ATTRIBUTE_SORT_BY_CATEGORY[categoryFilter];
  const isSyncBusy = syncState === 'loading' || syncState === 'saving';
  const isRefreshing = syncState === 'loading';
  const handleCategoryChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextCategory = event.target.value as CategoryFilter;
    setCategoryFilter(nextCategory);
    const nextAttributeSort = ATTRIBUTE_SORT_BY_CATEGORY[nextCategory];
    if (isAttributeSort(sortMode) && (!nextAttributeSort || nextAttributeSort.sortMode !== sortMode)) {
      setSortMode('latest');
    }
  };

  const visibleEntries = useMemo(() => {
    const source = entries.length > 0 ? entries : isLoggedIn ? [] : demoEntries;
    const filtered = source.filter((entry) => {
      const effectiveCategory = entry.category ?? 'ramyeon';
      if (categoryFilter !== 'all' && effectiveCategory !== categoryFilter) return false;
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        entry.name.toLowerCase().includes(q) ||
        entry.nameEnglish?.toLowerCase().includes(q) ||
        entry.brand.toLowerCase().includes(q)
      );
    });

    const sorted = [...filtered];
    if (sortMode === 'latest') {
      sorted.sort(
        (a, b) =>
          createdAtToMs(b) - createdAtToMs(a) ||
          collatorKo.compare(a.name, b.name) ||
          a.id.localeCompare(b.id)
      );
    } else if (sortMode === 'rating') {
      sorted.sort(
        (a, b) =>
          b.rating - a.rating ||
          collatorKo.compare(a.name, b.name) ||
          a.id.localeCompare(b.id)
      );
    } else if (isAttributeSort(sortMode)) {
      sorted.sort(
        (a, b) => {
          const spiceA = a.spiciness ? SPICE_ORDER[a.spiciness] ?? 0 : 0;
          const spiceB = b.spiciness ? SPICE_ORDER[b.spiciness] ?? 0 : 0;
          return (
            spiceB - spiceA ||
            collatorKo.compare(a.name, b.name) ||
            a.id.localeCompare(b.id)
          );
        }
      );
    } else if (sortMode === 'alpha-en') {
      sorted.sort((a, b) =>
        collatorEn.compare(a.nameEnglish || a.name, b.nameEnglish || b.name) ||
        collatorKo.compare(a.name, b.name) ||
        a.id.localeCompare(b.id)
      );
    } else {
      sorted.sort((a, b) => collatorKo.compare(a.name, b.name) || a.id.localeCompare(b.id));
    }
    return sorted;
  }, [entries, isLoggedIn, query, sortMode, categoryFilter, collatorEn, collatorKo]);

  const resolveEntryImage = (entry: SofullEntry) => {
    if (entry.imageDriveFileId) {
      const driveSrc = driveImageUrls[entry.imageDriveFileId];
      if (driveSrc) return driveSrc;
    }
    return entry.imageUrl ?? '';
  };

  const openCreate = () => {
    setEditingEntry(null);
    setModalOpen(true);
  };

  const openEdit = (entry: SofullEntry) => {
    setEditingEntry(entry);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingEntry(null);
  };

  const refreshList = async () => {
    if (!accessToken) return;
    setSyncState('loading');
    setSyncMessage('Refreshing from Google Drive...');
    try {
      const fileId = await ensureAppDataFile(accessToken);
      setDriveFileId(fileId);
      const content = await downloadFromAppData(accessToken, fileId);
      const data = parseDataFile(content);
      setEntries(data.entries || []);
      setSyncState('idle');
      setSyncMessage(`Refreshed ${data.entries.length} entries.`);
      if (!content || content.trim().length === 0) {
        await uploadToAppData(accessToken, fileId, JSON.stringify(DEFAULT_DATA, null, 2));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Drive load failed.';
      setSyncState('error');
      setSyncMessage(message);
    }
  };

  const saveToDrive = async (nextEntries: SofullEntry[]) => {
    if (!accessToken || !driveFileId) return;
    setSyncState('saving');
    setSyncMessage('Saving to Google Drive...');
    try {
      const sanitizedEntries = sanitizeEntries(nextEntries);
      const payload: SofullDataFile = {
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
      if (editingEntry?.imageDriveFileId) {
        await deleteDriveFile(accessToken, editingEntry.imageDriveFileId);
      }
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
      const imageName = buildImageFileName(values.name, values.nameEnglish, values.imageFile.name);
      const uploadedImage = await uploadFileMultipart(accessToken, values.imageFile, folderId, imageName);
      nextImageDriveFileId = uploadedImage.id;
      nextImageMimeType = uploadedImage.mimeType;
      nextImageName = uploadedImage.name;
      if (editingEntry?.imageDriveFileId) {
        await deleteDriveFile(accessToken, editingEntry.imageDriveFileId);
      }
    }

    if (
      editingEntry?.imageDriveFileId &&
      !values.clearImage &&
      !values.imageFile
    ) {
      const desiredImageName = buildImageFileName(
        values.name,
        values.nameEnglish,
        editingEntry.imageName || ''
      );
      if (desiredImageName && desiredImageName !== editingEntry.imageName) {
        const updatedImage = await updateDriveFileName(
          accessToken,
          editingEntry.imageDriveFileId,
          desiredImageName
        );
        nextImageName = updatedImage.name;
      }
    }

    const entryPayload = {
      name: values.name,
      nameEnglish: values.nameEnglish,
      brand: values.brand,
      category: values.category,
      formFactor: values.formFactor,
      iceCreamFormFactor: values.iceCreamFormFactor,
      rating: values.rating,
      spiciness: values.spiciness,
      description: values.description,
      imageUrl: nextImageUrl,
      imageDriveFileId: nextImageDriveFileId,
      imageMimeType: nextImageMimeType,
      imageName: nextImageName
    };

    if (editingEntry) {
      const updatedEntry: SofullEntry = {
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
      const newEntry: SofullEntry = {
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

  const handleDelete = (entry: SofullEntry) => {
    if (!window.confirm(`Delete ${entry.name}?`)) return;
    const nextEntries = entries.filter((item) => item.id !== entry.id);
    setEntries(nextEntries);
    void (async () => {
      await saveToDrive(nextEntries);
      if (accessToken && entry.imageDriveFileId) {
        try {
          await deleteDriveFile(accessToken, entry.imageDriveFileId);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Drive image delete failed.';
          setSyncState('error');
          setSyncMessage(message);
        }
      }
    })();
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
          <p className="app__eyebrow">So Full!</p>
          <h1>배불러!</h1>
          <p className="app__subtitle">
            Add and rate the ramyeon, snacks, drinks, and ice creams you've tried!
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
            Add item
          </button>
          <button
            type="button"
            className={`refresh-button${isRefreshing ? ' refresh-button--loading' : ''}`}
            onClick={() => void refreshList()}
            disabled={!isLoggedIn || authLoading || isSyncBusy}
            aria-label="Refresh list"
            title="Refresh list"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 .34-.03.67-.08 1h2.02c.05-.33.06-.66.06-1 0-4.42-3.58-8-8-8zm-6 7c0-.34.03-.67.08-1H4.06c-.05.33-.06.66-.06 1 0 4.42 3.58 8 8 8v3l4-4-4-4v3c-3.31 0-6-2.69-6-6z"
                fill="currentColor"
              />
            </svg>
          </button>
          <div className="field field--search">
            <label htmlFor="search" className="sr-only">
              Search
            </label>
            <input
              id="search"
              placeholder="Search items by name or brand"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        <div className="toolbar__right">
          <label className="sort">
            <span>Category</span>
            <select
              value={categoryFilter}
              onChange={handleCategoryChange}
            >
              <option value="all">All</option>
              <option value="ramyeon">Ramyeon</option>
              <option value="snack">Snack</option>
              <option value="drink">Drink</option>
              <option value="ice_cream">Ice Cream</option>
            </select>
          </label>
          <label className="sort">
            <span>Sort</span>
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
              <option value="latest">Latest</option>
              <option value="rating">Best rated</option>
              {attributeSortOption && (
                <option value={attributeSortOption.sortMode}>{attributeSortOption.label}</option>
              )}
              <option value="alpha-ko">Alphabetical (Hangul)</option>
              <option value="alpha-en">Alphabetical (English)</option>
            </select>
          </label>
        </div>
      </section>

      <section className="status">
        {!isLoggedIn && (
          <p className={`status__message ${authError ? 'status__message--error' : ''}`}>
            {authError || 'Sign in to add, edit, and sync your food & drink list.'}
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
            <p>No entries yet.</p>
            <p>Add your first item to start your list.</p>
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
              <button
                className="button"
                onClick={() => {
                  if (authLoading) return;
                  clearTokenExpired();
                  void signIn();
                }}
                disabled={authLoading}
              >
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


