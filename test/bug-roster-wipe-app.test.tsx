// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * THE ROSTER WIPE, THROUGH THE REAL APP (2026-11-17; the module legs are test/bug-roster-wipe.test.ts).
 *
 * Mounting App runs its own mount persist (useEffect → schedulePersist(roster), 400 ms). Before the fix a
 * stored roster holding one entry the load could not read loaded as [] and that persist wrote '[]' over
 * every character. The content database is not served here (fetch → 404): the mount persist does not wait
 * for it, and nothing re-derives over the stored roster. Synthetic characters only.
 */
const ROSTER_KEY = 'wanderers-codex:roster:v1';
const APP_TIMEOUT = 120_000;

let live: Root | null = null;
afterEach(() => {
  if (live) act(() => live!.unmount());
  live = null;
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function mountApp(): Promise<void> {
  vi.stubGlobal('fetch', async () => ({ ok: false, status: 404, json: async () => ({}) }));
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { default: App } = await import('../src/App');
  const host = document.createElement('div');
  document.body.appendChild(host);
  live = createRoot(host);
  await act(async () => {
    live!.render(<App />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 900)); // past the 400 ms mount persist
  });
}

describe('mounting the app never writes an emptied roster over the stored one', () => {
  it(
    'a roster holding a {"toString":0}-named character and an entry without a character keeps every entry after the mount persist',
    async () => {
      const stored = [
        { id: 'a', character: { name: 'Ayla' } },
        { id: 't', character: { name: { toString: 0 } } },
        { id: 'x', note: 'no character object' },
        { id: 'b', character: { name: 'Bram' } },
      ];
      localStorage.setItem(ROSTER_KEY, JSON.stringify(stored));
      await mountApp();
      const raw = localStorage.getItem(ROSTER_KEY);
      expect(raw).not.toBe('[]');
      const onDisk = JSON.parse(raw!) as { id?: string }[];
      expect(onDisk.map((e) => e.id).sort()).toEqual(['a', 'b', 't', 'x']);
      expect(onDisk.find((e) => e.id === 'x')).toEqual(stored[2]); // kept exactly as stored
    },
    APP_TIMEOUT,
  );

  it(
    'a stored value that does not parse is still there, unchanged, after the mount',
    async () => {
      const broken = '[{"id":"a","character":{"name":"Ayla"}},{"id":"b"';
      localStorage.setItem(ROSTER_KEY, broken);
      await mountApp();
      expect(localStorage.getItem(ROSTER_KEY)).toBe(broken);
    },
    APP_TIMEOUT,
  );
});
