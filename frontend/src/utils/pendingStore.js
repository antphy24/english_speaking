// Keeps a student's in-progress submission on their device until the result is
// back, so a refresh, closed tab, dead battery or switching tabs never forces
// them to record again.
//
// * Small metadata (submission id, mode, prompt...) -> localStorage
// * The audio recording itself (can be several MB)  -> IndexedDB
// Everything is best-effort: if storage is unavailable (private mode), the app
// still works, it just can't resume after a refresh.

const META_PREFIX = 'hrefspeak_pending_';
const DB_NAME = 'hrefspeak';
const STORE = 'recordings';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
    const req = window.indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function saveRecording(key, blob) {
  try {
    await withStore('readwrite', (store) => store.put(blob, key));
    return true;
  } catch (e) {
    console.warn('[pendingStore] could not save recording', e);
    return false;
  }
}

export async function loadRecording(key) {
  try {
    return (await withStore('readonly', (store) => store.get(key))) || null;
  } catch {
    return null;
  }
}

export async function deleteRecording(key) {
  try {
    await withStore('readwrite', (store) => store.delete(key));
  } catch {
    /* ignore */
  }
}

export function savePending(mode, record) {
  try {
    localStorage.setItem(META_PREFIX + mode, JSON.stringify({ ...record, savedAt: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function loadPending(mode) {
  try {
    const raw = localStorage.getItem(META_PREFIX + mode);
    if (!raw) return null;
    const record = JSON.parse(raw);
    // Server keeps submissions for 48h; ignore anything older.
    if (Date.now() - (record.savedAt || 0) > 47 * 3600 * 1000) {
      clearPending(mode, record);
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

export function clearPending(mode, record = null) {
  try {
    const current = record || JSON.parse(localStorage.getItem(META_PREFIX + mode) || 'null');
    localStorage.removeItem(META_PREFIX + mode);
    if (current?.clientId) deleteRecording(current.clientId);
  } catch {
    /* ignore */
  }
}
