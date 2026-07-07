// Local-only high-resolution portraits.
//
// A character/companion carries a SMALL compressed portrait in its (synced) data — cloud-safe and
// shown everywhere as the baseline. On the INSTALLED app we ALSO keep a sharper copy on-device, in
// IndexedDB (roomier than localStorage, and never synced), keyed by a short `portraitRef` that travels
// with the character. Display prefers the sharp copy when it's present on this device, else the
// compressed one — so the cloud/web stay light while the installed app looks crisp.
//
// The whole map is loaded into memory once at startup so portrait lookups stay synchronous during
// render; a subscribe() lets React re-render when a sharp image lands (initial load or a new upload).

const DB_NAME = 'heroes-heaven';
const STORE = 'portraits';
const DB_VERSION = 1;

const cache = new Map<string, string>();
const subs = new Set<() => void>();
let loadStarted = false;

/** Open (and migrate) the DB. Resolves null when IndexedDB is unavailable (SSR/tests/locked-down
 *  WebView) so every caller degrades to "no sharp copy" rather than throwing. */
function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function notify(): void {
  subs.forEach((f) => {
    try {
      f();
    } catch {
      /* a subscriber throwing must not break the rest */
    }
  });
}

/** Load every stored sharp portrait into the in-memory cache. Idempotent; safe to call on any
 *  platform (on the web it just finds an empty store). Notifies subscribers if anything loaded. */
export async function initPortraitStore(): Promise<void> {
  if (loadStarted) return;
  loadStarted = true;
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) {
          if (typeof cur.value === 'string') cache.set(String(cur.key), cur.value);
          cur.continue();
        } else resolve();
      };
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  if (cache.size) notify();
}

/** The on-device sharp copy for `ref`, or undefined when there isn't one on this device. Synchronous
 *  (reads the in-memory cache) so it can be called straight from render. */
export function getSharpPortrait(ref: string | undefined): string | undefined {
  return ref ? cache.get(ref) : undefined;
}

/** Store a sharp portrait on this device under `ref` (updates the cache immediately, persists async). */
export async function setSharpPortrait(ref: string, dataUrl: string): Promise<void> {
  cache.set(ref, dataUrl);
  notify();
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(dataUrl, ref);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Drop the sharp copy for `ref` (on portrait replace / character delete) — frees on-device space. */
export async function deleteSharpPortrait(ref: string | undefined): Promise<void> {
  if (!ref) return;
  const had = cache.delete(ref);
  if (had) notify();
  const db = await openDb();
  if (!db) return;
  try {
    db.transaction(STORE, 'readwrite').objectStore(STORE).delete(ref);
  } catch {
    /* best-effort */
  }
}

/** Subscribe to sharp-portrait changes (load / add / remove). Returns an unsubscribe fn. */
export function subscribePortraits(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

/** Every `portraitRef` anywhere inside a value (character build appearance, play overlay, companions) —
 *  used to reclaim a deleted character's on-device sharp copies. Walks objects/arrays only, so the big
 *  base64 portrait strings are skipped. */
export function collectPortraitRefs(root: unknown): string[] {
  const out = new Set<string>();
  const walk = (o: unknown): void => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) {
      o.forEach(walk);
      return;
    }
    for (const [k, v] of Object.entries(o)) {
      if (k === 'portraitRef' && typeof v === 'string') out.add(v);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(root);
  return [...out];
}

/** A fresh, unique portrait ref. Travels (synced) with the character; keys the on-device sharp copy. */
export function newPortraitRef(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return 'p_' + crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
