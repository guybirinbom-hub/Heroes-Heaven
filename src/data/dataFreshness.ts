/*
 * IS THE RULES DATA THIS DEVICE LOADED THE DATA THIS APP WAS BUILT WITH?
 *
 * 2026-10-16: on the owner's phone the website ran v0.1.44's code on rules data from the phone's first
 * visit months earlier — the service worker caches core.json CacheFirst and the app fetched it at a fixed
 * URL, so the cached copy was never replaced — and a Flexible Spellcaster cleric "behaved like the
 * archetype was missing" there while the same character worked on the PC. The URL now carries each
 * file's version (dataFileUrl, src/data/index.ts). This is the second guard: the build stamps the sha1 of
 * each file's bytes (vite.config.ts → DATA_VERSIONS), the loader hashes what it actually received, and a
 * copy that is not the expected one is thrown out of the service worker's cache and fetched again from
 * the network. If the network copy still differs (a deploy in progress: the server is already newer than
 * this bundle), the NETWORK copy is used — newer than any cached one — and the status says so; Settings
 * shows it.
 */
import { DATA_VERSIONS } from '../version';

export type DataFile = 'core.json' | 'core-descriptions.json';

/** The service worker's cache for these two files (vite.config.ts runtimeCaching). */
export const DATA_CACHE = 'heroes-heaven-data';

/** fresh = the expected bytes; refetched = a stale copy was replaced from the network; mismatch = the
 *  network copy is not the one this build expects either; unchecked = no stamp to check against (the
 *  Tauri apps, the dev server, tests) or no way to hash (no crypto.subtle). */
export type DataStatus = 'fresh' | 'refetched' | 'mismatch' | 'unchecked';

const status: Partial<Record<DataFile, DataStatus>> = {};

/** What the loader found for one file (Settings → About). */
export function dataStatus(file: DataFile): DataStatus {
  return status[file] ?? 'unchecked';
}

/** The first 12 hex of the sha1 of the bytes — the same value vite.config.ts stamps. */
export async function dataHash(buf: ArrayBuffer): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest('SHA-1', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

const parse = (buf: ArrayBuffer): unknown => JSON.parse(new TextDecoder().decode(buf));

type FetchLike = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'> & Partial<Pick<Response, 'arrayBuffer'>>>;
/** The part of the Cache Storage API this file uses — injectable for tests. */
export type CacheStoreLike = { open(name: string): Promise<{ delete(req: string): Promise<boolean>; keys(): Promise<readonly { url: string }[]> }> };
const browserCaches = (): CacheStoreLike | undefined => (globalThis as { caches?: CacheStoreLike }).caches;

/**
 * Fetch one rules-data file and return its parsed JSON, checked against the version this build expects.
 * Throws on an HTTP error, exactly as the plain fetch it replaces did.
 */
export async function fetchDataFile(
  file: DataFile,
  url: string,
  fetchImpl: FetchLike = (u, init) => fetch(u, init),
  expected: string | undefined = DATA_VERSIONS[file],
  store: CacheStoreLike | undefined = browserCaches(),
  now: () => number = () => Date.now(),
): Promise<unknown> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!expected || typeof res.arrayBuffer !== 'function') {
    status[file] = 'unchecked';
    return res.json();
  }
  const buf = await res.arrayBuffer();
  const got = await dataHash(buf);
  if (got === null) {
    status[file] = 'unchecked';
    return parse(buf);
  }
  if (got === expected) {
    status[file] = 'fresh';
    return parse(buf);
  }
  /* A stale copy under the CURRENT URL (a deploy that served old bytes to the new bundle, a cache that
   * kept them). Throw it out of the service worker's cache and ask again past the HTTP cache: the
   * service worker misses and stores the network's answer under the right key, so the next open is
   * fresh too. Without Cache Storage, a URL no cache holds does the same job once. */
  try {
    let again: Awaited<ReturnType<FetchLike>>;
    if (store) {
      await (await store.open(DATA_CACHE)).delete(url);
      again = await fetchImpl(url, { cache: 'reload' });
    } else {
      again = await fetchImpl(`${url}${url.includes('?') ? '&' : '?'}fresh=${now()}`, { cache: 'reload' });
    }
    if (again.ok && typeof again.arrayBuffer === 'function') {
      const fresh = await again.arrayBuffer();
      status[file] = (await dataHash(fresh)) === expected ? 'refetched' : 'mismatch';
      return parse(fresh);
    }
  } catch {
    /* offline: the copy we have is all there is */
  }
  status[file] = 'mismatch';
  return parse(buf);
}

/**
 * Drop every copy of the rules data the service worker holds except the current URLs — older versions
 * and the bare, unversioned URLs from before 2026-10-16 (11-16 MB each on a phone). Only after BOTH files
 * checked out as current: a device that could not confirm its data keeps what it has.
 */
export async function pruneDataCache(keep: readonly string[], store: CacheStoreLike | undefined = browserCaches()): Promise<number> {
  if (!store) return 0;
  const ok = (s: DataStatus) => s === 'fresh' || s === 'refetched';
  if (!ok(dataStatus('core.json')) || !ok(dataStatus('core-descriptions.json'))) return 0;
  let dropped = 0;
  try {
    const cache = await store.open(DATA_CACHE);
    const keepRel = new Set(keep.map((k) => (k.startsWith('http') ? new URL(k).pathname + new URL(k).search : k)));
    for (const req of await cache.keys()) {
      const u = new URL(req.url);
      if (!/\/core(-descriptions)?\.json$/.test(u.pathname)) continue;
      if (keepRel.has(u.pathname + u.search)) continue;
      if (await cache.delete(req.url)) dropped++;
    }
  } catch {
    /* storage unavailable: nothing to prune */
  }
  return dropped;
}

/** Test seam: forget what the loader found. */
export function resetDataStatus(): void {
  for (const k of Object.keys(status)) delete status[k as DataFile];
}
