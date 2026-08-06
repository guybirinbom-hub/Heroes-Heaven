import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadContent } from '../src/data';

/**
 * Startup-path regression: main.tsx prefetches core.json before React mounts and App awaits
 * the same load — if the loader stops deduping concurrent callers, the app downloads the
 * ~19 MB content file twice on every cold boot.
 */
describe('loadContent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shares one fetch across concurrent callers and caches the merged result', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ feats: { 'test-feat': { id: 'test-feat', name: 'Test Feat' } } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([loadContent(), loadContent()]);
    // TWO files now, not one: core.json for the mechanics and core-descriptions.json alongside it.
    // The split is the point — the app becomes interactive after the smaller parse — so what this
    // asserts is that EACH file is fetched once however many callers there are, not that there is
    // only one file.
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.endsWith('core.json'))).toHaveLength(1);
    expect(urls.filter((u) => u.endsWith('core-descriptions.json'))).toHaveLength(1);
    expect(b).toBe(a);
    // The fetched core is merged over the seed: fetched entries land, seed content survives.
    expect(a.feats['test-feat']?.name).toBe('Test Feat');
    expect(Object.keys(a.classes).length).toBeGreaterThan(0);

    // Later callers get the cached database without another fetch. It is not necessarily the SAME
    // object as the first caller's: once descriptions land the loader re-merges, deliberately giving
    // the database a new identity so the memos downstream notice. What must hold is that no further
    // network request happens.
    const c = await loadContent();
    expect(c.feats['test-feat']?.name).toBe('Test Feat');
    // Still one fetch per file after a third caller — the cache holds and descriptions are not
    // re-requested either.
    const after = fetchMock.mock.calls.map((x) => String(x[0]));
    expect(after.filter((u) => u.endsWith('core.json'))).toHaveLength(1);
    expect(after.filter((u) => u.endsWith('core-descriptions.json'))).toHaveLength(1);
  });
});
