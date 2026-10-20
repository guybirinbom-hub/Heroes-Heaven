import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 2026-10-20 (package L, independent check finding 1). A failed rules download now loads an OLDER saved
 * copy instead of the seed alone. The campaign-homebrew pull asks printedIdsReady() before it converts
 * rows: with the older book it must still hear "not known" — a record new in this release is missing
 * from that book, and a campaign row reusing its id would become the player's OWN homebrew, which merges
 * over the book and hides the printed record on that device for good.
 */

function cachesWith(entries: Record<string, unknown>) {
  return {
    async open() {
      return {
        async delete() {
          return false;
        },
        async keys() {
          return Object.keys(entries).map((url) => ({ url }));
        },
        async match(req: string) {
          return req in entries ? new Response(JSON.stringify(entries[req])) : undefined;
        },
      };
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('printedIdsReady', () => {
  // mutation-proof: drop `&& dataStatus('core.json') !== 'older'` from printedIdsReady and this goes red.
  it('on an older saved rules file, the book counts as NOT known', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('caches', cachesWith({ 'https://hh.test/core.json?v=old1': { feats: { 'older-feat': { id: 'older-feat', name: 'Older Feat' } } } }));
    const idx = await import('../src/data/index');
    expect(await idx.printedIdsReady()).toBe(false);
    expect(idx.isPrintedId('feats', 'older-feat'), 'the older book did load').toBe(true);
  });

  it('on the current file it does', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ feats: { 'some-feat': { id: 'some-feat', name: 'Some Feat' } } })));
    const idx = await import('../src/data/index');
    expect(await idx.printedIdsReady()).toBe(true);
  });
});
