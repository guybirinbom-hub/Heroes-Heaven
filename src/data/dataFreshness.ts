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
 *
 * 2026-10-20: the first open after an update asks for the NEW version's URL, which no cache holds yet. If
 * the network failed in those seconds the loader threw, and the app fell back to the seed alone: every
 * character looked nearly empty until a reload with a connection. The previous version's copy is still in
 * the service worker's cache (pruneDataCache drops it only once both new files checked out), so a failed
 * download now reads the newest saved copy instead, and the status says it is older (Settings shows it).
 */
import { DATA_VERSIONS } from '../version';

export type DataFile = 'core.json' | 'core-descriptions.json';

/** The service worker's cache for these two files (vite.config.ts runtimeCaching). */
export const DATA_CACHE = 'heroes-heaven-data';

/** fresh = the expected bytes; refetched = a stale copy was replaced from the network; mismatch = the
 *  network copy is not the one this build expects either; older = the download failed, so an older copy
 *  saved on this device is in use; failed = the download failed and no usable copy is saved either (the
 *  loader's caller falls back); unchecked = no stamp to check against (the Tauri apps, the dev server,
 *  tests) or no way to hash (no crypto.subtle). */
export type DataStatus = 'fresh' | 'refetched' | 'mismatch' | 'older' | 'failed' | 'unchecked';

const status: Partial<Record<DataFile, DataStatus>> = {};

/** What the loader found for one file (Settings → About). */
export function dataStatus(file: DataFile): DataStatus {
  return status[file] ?? 'unchecked';
}

/** What the rules-data check found on this device, in words (Settings → About). A device that kept an
 *  old copy of the rules ran new code on old data for months without anyone seeing it (2026-10-16); this
 *  line is where the owner can see on any device that it is current. */
export function rulesDataLine(tauri: boolean): string {
  const core = dataStatus('core.json');
  const desc = dataStatus('core-descriptions.json');
  const retry = 'Connect to the internet, then close the app completely and open it again.';
  // The PC and Android apps carry the files inside the app: no download, no saved copy, no internet.
  if (tauri && (core === 'failed' || desc === 'failed')) return 'NOT loaded: the rules file inside the app could not be read. Reinstall the app.';
  if (core === 'failed') return `NOT loaded: the download failed and no copy is saved on this device, so characters look nearly empty. ${retry}`;
  const descToo = desc === 'failed' ? ' The descriptions could not be loaded at all.' : '';
  if (core === 'older' || desc === 'older') return `NOT the newest: the download failed, so an older copy saved on this device is in use.${descToo} ${retry}`;
  if (desc === 'failed') return `descriptions NOT loaded: the download failed and no copy is saved on this device. ${retry}`;
  if (core === 'mismatch' || desc === 'mismatch') return 'not the rules data this version expects. Close the app completely and open it again.';
  if (core === 'refetched' || desc === 'refetched') return 'up to date (an old saved copy was replaced).';
  if (core === 'fresh' && desc === 'fresh') return 'up to date.';
  if (core === 'fresh') return 'up to date (descriptions not loaded yet).';
  if (tauri) return 'built into the app, so always the matching version.';
  return 'not checked in this version of the app.';
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
export type CacheStoreLike = {
  open(name: string): Promise<{
    delete(req: string): Promise<boolean>;
    keys(): Promise<readonly { url: string }[]>;
    match(req: string): Promise<Pick<Response, 'arrayBuffer'> | undefined>;
  }>;
};
const browserCaches = (): CacheStoreLike | undefined => (globalThis as { caches?: CacheStoreLike }).caches;

/**
 * Fetch one rules-data file and return its parsed JSON, checked against the version this build expects.
 * When the download fails (offline, an HTTP error, a body that is not the JSON — a hotel wifi login page),
 * a copy of this file saved in the service worker's cache is used (savedCopy) and the status says which
 * kind. Throws only when there is no usable saved copy either, exactly as the plain fetch it replaces
 * did — the status is then 'failed'.
 */
export async function fetchDataFile(
  file: DataFile,
  url: string,
  fetchImpl: FetchLike = (u, init) => fetch(u, init),
  expected: string | undefined = DATA_VERSIONS[file],
  store: CacheStoreLike | undefined = browserCaches(),
  now: () => number = () => Date.now(),
): Promise<unknown> {
  try {
    return await fetchFromNetwork(file, url, fetchImpl, expected, store, now);
  } catch (err) {
    const saved = await savedCopy(file, url, expected, store);
    if (saved === undefined) {
      status[file] = 'failed';
      throw err;
    }
    if (saved.current) {
      status[file] = 'fresh';
    } else {
      console.warn(`Could not download ${file}; using an older copy saved on this device (${saved.url}).`, err);
      status[file] = 'older';
    }
    return saved.json;
  }
}

const pathAndQuery = (u: string): string => {
  const p = new URL(u, 'https://hh.invalid');
  return p.pathname + p.search;
};

/** Both files are one object of record buckets, and both carry `feats`. A cached 200 answer that is not
 *  that (a wifi login page that happened to answer in JSON) is not a rules file. */
const looksLikeRulesFile = (json: unknown): boolean =>
  !!json && typeof json === 'object' && !Array.isArray(json) && typeof (json as { feats?: unknown }).feats === 'object';

/**
 * A copy of `file` saved in the data cache, parsed; undefined when none is usable.
 *
 * The URL that was asked for comes first, used only when its bytes ARE this build's version (`current`):
 * a page the service worker does not control — a hard reload — skips the cache that holds exactly the
 * right file. Then the other copies, newest first: Cache Storage lists keys in the order they were stored,
 * so the last one is the newest.
 */
async function savedCopy(
  file: DataFile,
  url: string,
  expected: string | undefined,
  store: CacheStoreLike | undefined,
): Promise<{ json: unknown; url: string; current: boolean } | undefined> {
  if (!store) return undefined;
  try {
    const cache = await store.open(DATA_CACHE);
    const asked = pathAndQuery(url);
    const keys = (await cache.keys()).filter((k) => new URL(k.url, 'https://hh.invalid').pathname.endsWith(`/${file}`));
    const own = keys.filter((k) => pathAndQuery(k.url) === asked);
    const others = keys.filter((k) => pathAndQuery(k.url) !== asked).reverse();
    for (const k of [...own, ...others]) {
      try {
        const res = await cache.match(k.url);
        if (!res) continue;
        const buf = await res.arrayBuffer();
        // Only the asked URL can be 'current'. A copy under another URL stays 'older' even if its bytes
        // match: a 'fresh' status lets pruneDataCache drop every URL but the asked one, and the asked one
        // is not in the cache — the device would keep no saved copy for its next offline open.
        const isOwn = own.includes(k);
        const current = isOwn && !!expected && (await dataHash(buf)) === expected;
        if (isOwn && !current) continue; // a damaged copy under the asked URL is never offered back
        const json = parse(buf);
        if (looksLikeRulesFile(json)) return { json, url: k.url, current };
      } catch {
        /* a damaged copy: try the next older one */
      }
    }
  } catch {
    /* storage unavailable */
  }
  return undefined;
}

async function fetchFromNetwork(
  file: DataFile,
  url: string,
  fetchImpl: FetchLike,
  expected: string | undefined,
  store: CacheStoreLike | undefined,
  now: () => number,
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
