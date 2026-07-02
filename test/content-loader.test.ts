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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
    // The fetched core is merged over the seed: fetched entries land, seed content survives.
    expect(a.feats['test-feat']?.name).toBe('Test Feat');
    expect(Object.keys(a.classes).length).toBeGreaterThan(0);

    // Later callers get the cached database without another fetch.
    const c = await loadContent();
    expect(c).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
