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

/** The Characters screen's text: opened from the page menu when App is on a sheet. */
async function charactersScreenText(): Promise<string> {
  const menu = document.querySelector<HTMLButtonElement>('button[aria-label="Menu"]');
  if (!document.querySelector('.roster-screen') && menu) {
    await act(async () => menu.click());
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"], button')].find((b) => b.textContent?.trim() === 'Characters');
    if (!item) throw new Error('no Characters entry in the page menu');
    await act(async () => item.click());
  }
  const screen = document.querySelector('.roster-screen');
  if (!screen) throw new Error('the Characters screen did not open');
  return screen.textContent ?? '';
}

/** Mount App, wait past its mount persist, and return the text of the first screen it painted. */
async function mountApp(): Promise<string> {
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
  const first = host.textContent ?? '';
  await act(async () => {
    await new Promise((r) => setTimeout(r, 900)); // past the 400 ms mount persist
  });
  return first;
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
      // …and the Characters screen says so: a short roster is never taken for "deleted" (a checker's
      // finding on 12e9ad2: the kept entry was hidden with no word to the player).
      const characters = await charactersScreenText();
      expect(characters).toContain('Ayla');
      expect(characters).toContain("1 saved character can't be read by this version. It is kept unchanged");
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
      expect(await charactersScreenText()).toContain('A saved character list could not be read. It is kept unchanged');
    },
    APP_TIMEOUT,
  );
});
