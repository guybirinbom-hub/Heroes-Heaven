import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_CACHE, dataHash, dataStatus, fetchDataFile, pruneDataCache, resetDataStatus, type CacheStoreLike } from '../src/data/dataFreshness';

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

/** A fake Cache Storage holding the given absolute URLs in the data cache. */
function store(urls: string[]) {
  const held = new Set(urls);
  const deleted: string[] = [];
  const opened: string[] = [];
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
      };
    },
  };
  return { s, held, deleted, opened };
}

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

  it('an HTTP error still throws, as the plain fetch did', async () => {
    const fetchImpl = async () => new Response('nope', { status: 404 });
    await expect(fetchDataFile('core.json', '/core.json?v=x', fetchImpl, 'abc', undefined)).rejects.toThrow('HTTP 404');
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

  it('a device that could not confirm its data keeps everything it has', async () => {
    await fetchDataFile('core.json', current[0], server(OLD, OLD).fetchImpl, sha12(NEW), undefined, () => 1);
    await fetchDataFile('core-descriptions.json', current[1], server(NEW).fetchImpl, sha12(NEW), undefined);
    const st = store(held);
    expect(await pruneDataCache(current, st.s)).toBe(0);
    expect(st.held.size).toBe(held.length);
  });
});
