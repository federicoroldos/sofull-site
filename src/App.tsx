import { useMemo, useState, useEffect } from 'react';
import EntryCard from './components/EntryCard';
import EntryFormModal from './components/EntryFormModal';
import { useGoogleAuth } from './hooks/useGoogleAuth';
import { downloadFromAppData, ensureAppDataFile, uploadToAppData } from './utils/googleDriveClient';
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
      entries: parsed.entries
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
      const payload: RamyeonDataFile = {
        version: 1,
        updatedAt: nowIso(),
        entries: nextEntries
      };
      await uploadToAppData(accessToken, driveFileId, JSON.stringify(payload, null, 2));
      setSyncState('idle');
      setSyncMessage(`Last synced ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Drive sync failed.';
      setSyncState('error');
      setSyncMessage(message);
    }
  };

  const handleSaveEntry = (values: Omit<RamyeonEntry, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (editingEntry) {
      const updatedEntry: RamyeonEntry = {
        ...editingEntry,
        ...values,
        updatedAt: nowIso()
      };
      const nextEntries = entries.map((entry) => (entry.id === editingEntry.id ? updatedEntry : entry));
      setEntries(nextEntries);
      void saveToDrive(nextEntries);
    } else {
      const newEntry: RamyeonEntry = {
        id: createId(),
        createdAt: nowIso(),
        updatedAt: nowIso(),
        ...values
      };
      const nextEntries = [newEntry, ...entries];
      setEntries(nextEntries);
      void saveToDrive(nextEntries);
    }
    closeModal();
  };

  const handleDelete = (entry: RamyeonEntry) => {
    if (!window.confirm(`Delete ${entry.name}?`)) return;
    const nextEntries = entries.filter((item) => item.id !== entry.id);
    setEntries(nextEntries);
    void saveToDrive(nextEntries);
  };

  useEffect(() => {
    if (!accessToken) {
      setEntries([]);
      setDriveFileId('');
      setSyncState('idle');
      setSyncMessage('');
      return;
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

      <footer className="app__footer">© 2026 Federico Roldos. All rights reserved.</footer>
    </div>
  );
};

export default App;
