import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * THE WEB BUILD MUST NOT SERVE A PHONE ITS FIRST VISIT'S RULES DATA FOREVER (2026-10-16).
 *
 * The service worker caches core.json and core-descriptions.json CacheFirst (vite.config.ts,
 * runtimeCaching), and CacheFirst never asks the network again for a URL it holds. The app fetched
 * both at a FIXED path, so a phone that opened the website once kept that visit's rules data through
 * every release after it: new code on old data. The owner's Flexible Spellcaster cleric worked on the
 * PC and "behaved like the archetype was missing" on his phone — same character, same account — and a
 * freshly built flexible cleric was correct in both v0.1.43 and v0.1.44, so the code was never the
 * difference (Flexible Spellcaster's classArchetype first reached core.json in v0.1.22, 2026-08-14;
 * the cache route dates from 2026-07-07). The fix puts each file's own version — the sha1 of its
 * bytes, stamped by `vite build` — into its URL.
 */

const ROOT = path.join(__dirname, '..');
const STAMPS = { 'core.json': 'aaaaaaaaaaaa', 'core-descriptions.json': 'bbbbbbbbbbbb' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('../src/version');
  vi.resetModules();
});

describe('dataFileUrl', () => {
  it('a stamped web build puts each file’s version into its URL; Tauri and an unstamped build keep the plain path', async () => {
    const { dataFileUrl } = await import('../src/data/index');
    expect(dataFileUrl('core.json', false, STAMPS)).toBe('/core.json?v=aaaaaaaaaaaa');
    expect(dataFileUrl('core-descriptions.json', false, STAMPS)).toBe('/core-descriptions.json?v=bbbbbbbbbbbb');
    expect(dataFileUrl('core.json', true, STAMPS)).toBe('/core.json');
    expect(dataFileUrl('core.json', false, {})).toBe('/core.json');
  });
});

describe('the app fetches its rules data through the versioned URL', () => {
  // mutation-proof: put back the bare `${BASE_URL}core.json` fetch and this case goes red.
  it('with a build stamp, core.json and core-descriptions.json are both requested with ?v=<their version>', async () => {
    vi.doMock('../src/version', () => ({ APP_VERSION: '0.0.0', DATA_VERSIONS: STAMPS }));
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (u: string) => {
      urls.push(String(u));
      return { ok: true, status: 200, json: async () => ({}) };
    });
    const data = await import('../src/data/index');
    await data.loadContent();
    await data.loadDescriptions();
    expect(urls).toContain('/core.json?v=aaaaaaaaaaaa');
    expect(urls).toContain('/core-descriptions.json?v=bbbbbbbbbbbb');
    expect(urls.filter((u) => /core(-descriptions)?\.json$/.test(u)), 'no bare, unversioned data URL').toEqual([]);
  });
});

describe('the build stamps each data file with the sha1 of its own bytes', () => {
  const config = async (command: 'build' | 'serve') => {
    const mod = (await import('../vite.config')).default as unknown as (env: { command: string; mode: string }) => { define?: Record<string, string> };
    return mod({ command, mode: command === 'build' ? 'production' : 'development' });
  };

  it('vite build defines __DATA_VERSIONS__ from the files themselves', async () => {
    const expected: Record<string, string> = {};
    for (const f of ['core.json', 'core-descriptions.json']) {
      const p = path.join(ROOT, 'public', f);
      expected[f] = existsSync(p) ? createHash('sha1').update(readFileSync(p)).digest('hex').slice(0, 12) : 'missing';
    }
    expect(JSON.parse((await config('build')).define?.__DATA_VERSIONS__ ?? '{}')).toEqual(expected);
  });

  it('the dev server gets no stamps (they would go stale when the data is regenerated under it)', async () => {
    expect(JSON.parse((await config('serve')).define?.__DATA_VERSIONS__ ?? 'null')).toEqual({});
  });
});
