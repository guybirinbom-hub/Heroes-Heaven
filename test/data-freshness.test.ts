import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_CACHE, dataHash, dataStatus, fetchDataFile, pruneDataCache, resetDataStatus, rulesDataLine, type CacheStoreLike } from '../src/data/dataFreshness';

/**
 * The loader's own freshness check (2026-10-16). Even with the version in the URL, a device must never
 * quietly run on a rules file that is not the one its app version was built with: the loader hashes the
 * bytes it received, and a copy that is not the expected one is thrown out of the service worker's cache
 * and fetched again. Background: a phone ran v0.1.44's code on rules data from its first visit, months
 * old, because the service worker kept that copy forever — see test/data-file-url.test.ts.
 */

const bytes = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
const sha12 = (b: Uint8Array) => createHash('sha1').update(b).digest('hex').slice(0, 12);
const OLD = bytes({ feats: { 'flexible-spellcaster-dedication': { id: 'flexible-spellcaster-dedication' } } });
const NEW = bytes({ feats: { 'flexible-spellcaster-dedication': { id: 'flexible-spellcaster-dedication', classArchetype: { spellCollection: true } } } });

function server(...answers: Uint8Array[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(answers[Math.min(calls.length - 1, answers.length - 1)], { status: 200 });
  };
  return { calls, fetchImpl };
}

/** A fake Cache Storage holding the given absolute URLs in the data cache, in the order they were stored;
 *  `bodies` gives what a URL holds (default: a rules file with no feats). */
function store(urls: string[], bodies: Record<string, Uint8Array | string> = {}) {
  const held = new Set(urls);
  const deleted: string[] = [];
  const opened: string[] = [];
  const matched: string[] = [];
  const s: CacheStoreLike = {
    async open(name) {
      opened.push(name);
      return {
        async delete(req) {
          deleted.push(req);
          return held.delete(req.startsWith('http') ? req : `https://hh.test${req}`);
        },
        async keys() {
          return [...held].map((url) => ({ url }));
        },
        async match(req) {
          matched.push(req);
          if (!held.has(req)) return undefined;
          return new Response(bodies[req] ?? '{"feats":{}}');
        },
      };
    },
  };
  return { s, held, deleted, opened, matched };
}

const offline = async (): Promise<Response> => {
  throw new TypeError('Failed to fetch');
};

beforeEach(() => resetDataStatus());
afterEach(() => vi.unstubAllGlobals());

describe('dataHash', () => {
  it('matches the sha1 vite.config.ts stamps (first 12 hex)', async () => {
    expect(await dataHash(NEW.buffer.slice(0) as ArrayBuffer)).toBe(sha12(NEW));
  });
});

describe('fetchDataFile', () => {
  it('a copy with the expected stamp is used as is — one request', async () => {
    const sv = server(NEW);
    const got = await fetchDataFile('core.json', '/core.json?v=x', sv.fetchImpl, sha12(NEW), undefined);
    expect(got).toEqual(JSON.parse(new TextDecoder().decode(NEW)));
    expect(sv.calls).toHaveLength(1);
    expect(dataStatus('core.json')).toBe('fresh');
  });

  // mutation-proof: drop the second request and the old copy is returned — this case goes red.
  it('a STALE copy is thrown out of the service worker cache and fetched again at the SAME url, past the HTTP cache', async () => {
    const sv = server(OLD, NEW);
    const st = store(['https://hh.test/core.json?v=x']);
    const got = (await fetchDataFile('core.json', '/core.json?v=x', sv.fetchImpl, sha12(NEW), st.s)) as { feats: Record<string, { classArchetype?: unknown }> };
    expect(got.feats['flexible-spellcaster-dedication'].classArchetype, 'the new rules, not the old copy').toEqual({ spellCollection: true });
    expect(st.opened).toEqual([DATA_CACHE]);
    expect(st.deleted).toEqual(['/core.json?v=x']);
    expect(sv.calls.map((c) => c.url)).toEqual(['/core.json?v=x', '/core.json?v=x']);
    expect(sv.calls[1].init?.cache).toBe('reload');
    expect(dataStatus('core.json')).toBe('refetched');
  });

  it('without Cache Storage, a URL no cache holds does the same job once', async () => {
    const sv = server(OLD, NEW);
    await fetchDataFile('core.json', '/core.json?v=x', sv.fetchImpl, sha12(NEW), undefined, () => 42);
    expect(sv.calls[1].url).toBe('/core.json?v=x&fresh=42');
    expect(dataStatus('core.json')).toBe('refetched');
  });

  it('when the network copy is not the expected one either, the NETWORK copy wins and the status says so', async () => {
    const OTHER = bytes({ feats: {} });
    const sv = server(OLD, OTHER);
    const got = await fetchDataFile('core-descriptions.json', '/core-descriptions.json?v=x', sv.fetchImpl, sha12(NEW), undefined, () => 1);
    expect(got).toEqual({ feats: {} });
    expect(dataStatus('core-descriptions.json')).toBe('mismatch');
  });

  it('with no stamp to check against (Tauri, dev server, tests) it reads the file once, unchecked', async () => {
    const sv = server(OLD);
    await fetchDataFile('core.json', '/core.json', sv.fetchImpl, undefined, undefined);
    expect(sv.calls).toHaveLength(1);
    expect(dataStatus('core.json')).toBe('unchecked');
  });

  it('with no way to hash (no crypto.subtle: plain http on a LAN address) it is unchecked, not a false alarm', async () => {
    vi.stubGlobal('crypto', {});
    const sv = server(OLD);
    await fetchDataFile('core.json', '/core.json?v=x', sv.fetchImpl, sha12(NEW), undefined);
    expect(sv.calls).toHaveLength(1);
    expect(dataStatus('core.json')).toBe('unchecked');
  });

  it('an HTTP error still throws when this device has no saved copy, as the plain fetch did', async () => {
    const fetchImpl = async () => new Response('nope', { status: 404 });
    await expect(fetchDataFile('core.json', '/core.json?v=x', fetchImpl, 'abc', undefined)).rejects.toThrow('HTTP 404');
    await expect(fetchDataFile('core.json', '/core.json?v=x', fetchImpl, 'abc', store([]).s)).rejects.toThrow('HTTP 404');
  });
});

/**
 * 2026-10-20 (package L): the first open after an update asks for the NEW version's URL, which no cache
 * holds yet. A failed download there used to throw, and the app fell back to the seed alone — every
 * character nearly empty until a reload with a connection — although the previous version's copy was
 * still saved on the device.
 */
describe('fetchDataFile when the download fails', () => {
  const saved = [
    'https://hh.test/core.json',
    'https://hh.test/core-descriptions.json?v=old1',
    'https://hh.test/core.json?v=old1',
  ];
  const bodies = {
    'https://hh.test/core.json': bytes({ feats: { bare: {} } }),
    'https://hh.test/core-descriptions.json?v=old1': bytes({ feats: { descriptions: {} } }),
    'https://hh.test/core.json?v=old1': OLD,
  };

  // mutation-proof: make fetchDataFile rethrow without trying the saved copy and this case goes red.
  it('offline: the newest saved copy of THIS file is used and the status says it is older', async () => {
    const st = store(saved, bodies);
    const got = await fetchDataFile('core.json', '/core.json?v=new1', offline, sha12(NEW), st.s);
    expect(got).toEqual(JSON.parse(new TextDecoder().decode(OLD)));
    expect(st.opened).toEqual([DATA_CACHE]);
    expect(st.matched, 'newest first, never the other file').toEqual(['https://hh.test/core.json?v=old1']);
    expect(dataStatus('core.json')).toBe('older');
  });

  it('an HTTP error (a server error mid-deploy) falls back the same way', async () => {
    const fetchImpl = async () => new Response('busy', { status: 503 });
    const got = await fetchDataFile('core-descriptions.json', '/core-descriptions.json?v=new2', fetchImpl, sha12(NEW), store(saved, bodies).s);
    expect(got).toEqual({ feats: { descriptions: {} } });
    expect(dataStatus('core-descriptions.json')).toBe('older');
  });

  it('a page that is not the rules file (a wifi login page answering 200) falls back too', async () => {
    const portal = async () => new Response('<html>Sign in to the hotel wifi</html>', { status: 200 });
    const got = await fetchDataFile('core.json', '/core.json?v=new1', portal, sha12(NEW), store(saved, bodies).s, () => 1);
    expect(got).toEqual(JSON.parse(new TextDecoder().decode(OLD)));
    expect(dataStatus('core.json')).toBe('older');
    // The same page with no stamp to check (no crypto) goes through res.json(), which throws too.
    resetDataStatus();
    const unstamped = await fetchDataFile('core.json', '/core.json', portal, undefined, store(saved, bodies).s);
    expect(unstamped).toEqual(JSON.parse(new TextDecoder().decode(OLD)));
    expect(dataStatus('core.json')).toBe('older');
  });

  it('a damaged saved copy is skipped for the next older one', async () => {
    const st = store(saved, { ...bodies, 'https://hh.test/core.json?v=old1': 'not json' });
    const got = await fetchDataFile('core.json', '/core.json?v=new1', offline, sha12(NEW), st.s);
    expect(got).toEqual({ feats: { bare: {} } });
    expect(st.matched).toEqual(['https://hh.test/core.json?v=old1', 'https://hh.test/core.json']);
  });

  it('a damaged copy under the URL asked for is never offered back', async () => {
    const st = store(['https://hh.test/core.json?v=new1'], { 'https://hh.test/core.json?v=new1': OLD });
    await expect(fetchDataFile('core.json', '/core.json?v=new1', offline, sha12(NEW), st.s)).rejects.toThrow('Failed to fetch');
    expect(st.matched).toEqual(['https://hh.test/core.json?v=new1']);
    expect(dataStatus('core.json')).toBe('failed');
  });

  // A page the service worker does not control (a hard reload) skips the cache that holds the right file.
  it('the CURRENT file saved under the URL asked for is used first, and it is fresh, not older', async () => {
    const st = store([...saved, 'https://hh.test/core.json?v=new1'], { ...bodies, 'https://hh.test/core.json?v=new1': NEW });
    const got = await fetchDataFile('core.json', '/core.json?v=new1', offline, sha12(NEW), st.s);
    expect(got).toEqual(JSON.parse(new TextDecoder().decode(NEW)));
    expect(st.matched).toEqual(['https://hh.test/core.json?v=new1']);
    expect(dataStatus('core.json')).toBe('fresh');
  });

  // mutation-proof: let a copy under ANOTHER url count as 'fresh' and this goes red. Found in the real
  // browser test 2026-10-20: the status said "up to date", the prune then deleted that copy, and the
  // device was left with nothing saved for its next offline open.
  it('a copy under another URL is older even when its bytes match, and the prune keeps it', async () => {
    const other = ['https://hh.test/core.json?v=old1', 'https://hh.test/core-descriptions.json?v=old1'];
    const st = store(other, { [other[0]]: NEW, [other[1]]: NEW });
    await fetchDataFile('core.json', '/core.json?v=new1', offline, sha12(NEW), st.s);
    await fetchDataFile('core-descriptions.json', '/core-descriptions.json?v=new2', offline, sha12(NEW), st.s);
    expect(dataStatus('core.json')).toBe('older');
    expect(await pruneDataCache(['/core.json?v=new1', '/core-descriptions.json?v=new2'], st.s)).toBe(0);
    expect(st.held.size).toBe(2);
  });

  it('a saved answer that is JSON but not a rules file (a wifi login page in JSON) is skipped', async () => {
    const st = store(saved, { ...bodies, 'https://hh.test/core.json?v=old1': '{"login":"required"}' });
    const got = await fetchDataFile('core.json', '/core.json?v=new1', offline, sha12(NEW), st.s);
    expect(got).toEqual({ feats: { bare: {} } });
  });

  it('no saved copy of this file: the original error, so the loader still reaches its own fallback — and Settings says so', async () => {
    const st = store(['https://hh.test/core-descriptions.json?v=old1'], bodies);
    await expect(fetchDataFile('core.json', '/core.json?v=new1', offline, sha12(NEW), st.s)).rejects.toThrow('Failed to fetch');
    expect(dataStatus('core.json')).toBe('failed');
    expect(rulesDataLine(false)).toMatch(/^NOT loaded/);
    expect(rulesDataLine(true), 'the PC app carries the file: no internet advice there').toMatch(/^NOT loaded: the rules file inside the app could not be read/);
  });

  it('descriptions that could not load are named, not reported as "not loaded yet"', async () => {
    await fetchDataFile('core.json', '/core.json?v=new1', server(NEW).fetchImpl, sha12(NEW), undefined);
    await expect(fetchDataFile('core-descriptions.json', '/core-descriptions.json?v=new2', offline, sha12(NEW), store([]).s)).rejects.toThrow();
    expect(rulesDataLine(false)).toMatch(/^descriptions NOT loaded/);
  });

  it('older rules AND no descriptions: the line says both', async () => {
    await fetchDataFile('core.json', '/core.json?v=new1', offline, sha12(NEW), store(saved, bodies).s);
    await expect(fetchDataFile('core-descriptions.json', '/core-descriptions.json?v=new2', offline, sha12(NEW), store([]).s)).rejects.toThrow();
    expect(rulesDataLine(false)).toMatch(/^NOT the newest: .* The descriptions could not be loaded at all\./);
  });

  it('Settings says the rules are not the newest', async () => {
    await fetchDataFile('core.json', '/core.json?v=new1', offline, sha12(NEW), store(saved, bodies).s);
    await fetchDataFile('core-descriptions.json', '/core-descriptions.json?v=new2', server(NEW).fetchImpl, sha12(NEW), undefined);
    expect(rulesDataLine(false)).toMatch(/^NOT the newest/);
    resetDataStatus();
    await fetchDataFile('core.json', '/core.json?v=new1', server(NEW).fetchImpl, sha12(NEW), undefined);
    await fetchDataFile('core-descriptions.json', '/core-descriptions.json?v=new2', offline, sha12(NEW), store(saved, bodies).s);
    expect(rulesDataLine(false), 'only the descriptions are older').toMatch(/^NOT the newest/);
    resetDataStatus();
    await fetchDataFile('core.json', '/core.json?v=new1', server(NEW).fetchImpl, sha12(NEW), undefined);
    await fetchDataFile('core-descriptions.json', '/core-descriptions.json?v=new2', server(NEW).fetchImpl, sha12(NEW), undefined);
    expect(rulesDataLine(false)).toBe('up to date.');
  });
});

describe('pruneDataCache', () => {
  const current = ['/core.json?v=new1', '/core-descriptions.json?v=new2'];
  const held = [
    'https://hh.test/core.json',
    'https://hh.test/core-descriptions.json',
    'https://hh.test/core.json?v=old1',
    'https://hh.test/core.json?v=new1',
    'https://hh.test/core-descriptions.json?v=new2',
  ];
  const bothFresh = async () => {
    await fetchDataFile('core.json', current[0], server(NEW).fetchImpl, sha12(NEW), undefined);
    await fetchDataFile('core-descriptions.json', current[1], server(NEW).fetchImpl, sha12(NEW), undefined);
  };

  it('once both files checked out, drops every other copy — the bare pre-fix URLs and older versions', async () => {
    await bothFresh();
    const st = store(held);
    expect(await pruneDataCache(current, st.s)).toBe(3);
    expect([...st.held].sort()).toEqual(['https://hh.test/core-descriptions.json?v=new2', 'https://hh.test/core.json?v=new1']);
  });

  // mutation-proof: count 'older' as ok in pruneDataCache and this goes red — the only copy that worked
  // offline would be deleted.
  it('a device running on an older saved copy keeps everything it has', async () => {
    await fetchDataFile('core.json', current[0], offline, sha12(NEW), store(held).s);
    await fetchDataFile('core-descriptions.json', current[1], server(NEW).fetchImpl, sha12(NEW), undefined);
    expect(dataStatus('core.json')).toBe('older');
    const st = store(held);
    expect(await pruneDataCache(current, st.s)).toBe(0);
    expect(st.held.size).toBe(held.length);
  });

  it('a device that could not confirm its data keeps everything it has', async () => {
    await fetchDataFile('core.json', current[0], server(OLD, OLD).fetchImpl, sha12(NEW), undefined, () => 1);
    await fetchDataFile('core-descriptions.json', current[1], server(NEW).fetchImpl, sha12(NEW), undefined);
    const st = store(held);
    expect(await pruneDataCache(current, st.s)).toBe(0);
    expect(st.held.size).toBe(held.length);
  });
});
