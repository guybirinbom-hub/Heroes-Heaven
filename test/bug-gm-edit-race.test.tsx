// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { initialPlay } from '../src/rules/play';
import { ROSTER_KEY, type SavedChar } from '../src/data/storage';

/**
 * A GM's edit replaces the player's whole sheet. Three ways that quietly ate work the player could
 * not get back, all of them here against the REAL <App/> with the party layer mocked:
 *
 *  (a) the "your GM overwrote you" banner was suppressed until this session had published something,
 *      so the FIRST revert of every session was the silent one.
 *  (b) "apply exactly once" hung on a stamp written to localStorage by a function that swallows a
 *      quota failure — and a stamp that never landed means the same row re-applies on every focus,
 *      visibility, online and Realtime event. That is the 2.5-second revert loop with a new cause.
 *  (c) the apply is asynchronous. Anything the player did while the rows were in flight was applied
 *      over, because the GM was necessarily editing a sheet without it.
 */
const gm = vi.hoisted(() => ({
  /** Rows fetchGmEdits hands back. */
  edits: [] as { campaignId: string; charId: string; sheet: unknown; updatedAt: string }[],
  /** When set, fetchGmEdits waits on it — the in-flight window of case (c). */
  gate: null as Promise<void> | null,
  fetches: 0,
}));

vi.mock('../src/data/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in', session: null, email: 'player@example.com' }),
}));
vi.mock('../src/data/party', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/party')>()),
  fetchGmEdits: async () => {
    gm.fetches++;
    if (gm.gate) await gm.gate;
    return gm.edits;
  },
  deleteGmEdit: async () => 1,
  currentUserId: async () => null, // no Realtime subscription in the test
  publishCharacter: async () => undefined,
  unpublishCharacter: async () => undefined,
}));
vi.mock('../src/data/cloudSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/cloudSync')>()),
  startCloudSync: async () => () => undefined,
}));

const ACTIVE_KEY = 'wanderers-codex:active:v1';
const APP_TIMEOUT = 120_000;

const buildOf = (name: string): BuildState => ({
  ...emptyBuild(),
  name,
  level: 1,
  ancestryId: 'human',
  heritageId: 'versatile-human',
  backgroundId: 'acolyte',
  classId: 'fighter',
  keyAbility: 'str',
  inventory: [{ itemId: 'healing-potion-minor', quantity: 3 }],
});

function saved(id: string, name: string): SavedChar {
  const db = content();
  const build = buildOf(name);
  const character = buildCharacter(build, db);
  return { id, character, build, play: initialPlay(character, db) } as SavedChar;
}

let live: Root | null = null;
afterEach(() => {
  if (live) act(() => live!.unmount());
  live = null;
  localStorage.clear();
  gm.edits = [];
  gm.gate = null;
  gm.fetches = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openInventory(roster: SavedChar[]) {
  const files: Record<string, string> = {
    'core.json': 'public/core.json',
    'core-descriptions.json': 'public/core-descriptions.json',
  };
  vi.stubGlobal('fetch', async (url: string) => {
    const path = files[String(url).split('/').pop() ?? ''];
    if (!path) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(path, 'utf8')) as unknown };
  });
  localStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
  localStorage.setItem(ACTIVE_KEY, roster[0].id);
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
  const { default: App } = await import('../src/App');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  live = root;
  await act(async () => {
    root.render(<App />);
  });
  const settle = async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  };
  await settle();
  const button = (label: string) => [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label);
  const openTab = () => act(() => button('Inventory')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  openTab();
  const card = () => [...host.querySelectorAll<HTMLElement>('.inv-card')].find((e) => (e.textContent ?? '').includes('Potion'));
  return {
    host,
    settle,
    openTab,
    qty: () => card()?.querySelector('.inv-qtystep span')?.textContent,
    plusOnce: () =>
      act(() => {
        card()!
          .querySelector<HTMLButtonElement>('button[aria-label="Increase quantity"]')!
          .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }),
    banner: () => host.querySelector('.gm-overwrote')?.textContent ?? '',
  };
}

describe('a GM edit never eats the player’s work silently', () => {
  // bug 2026-09-13: edits overwritten (D5)
  it('(a) says so even before this session has published anything', async () => {
    gm.edits = [{ campaignId: 'camp', charId: 'c1', sheet: saved('c1', 'GM Version'), updatedAt: '2026-09-13T10:00:00Z' }];
    const app = await openInventory([saved('c1', 'Player Version')]);
    await app.settle();
    expect(app.host.textContent, 'the GM’s version must land — last change wins').toContain('GM Version');
    expect(app.banner(), 'the first revert of a session was the silent one').toContain('Your GM updated');
  }, APP_TIMEOUT);

  // bug 2026-09-13: edits overwritten (D5)
  it('(b) applies one row ONCE even when the applied-stamp cannot be stored', async () => {
    // localStorage refuses the stamp (quota / private mode); saveGmEditsApplied swallows it.
    const realSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k.includes('gm-edits-applied')) throw new Error('QuotaExceededError');
      realSet.call(this, k, v);
    });
    gm.edits = [{ campaignId: 'camp', charId: 'c1', sheet: saved('c1', 'GM Version'), updatedAt: '2026-09-13T10:00:00Z' }];
    const app = await openInventory([saved('c1', 'Player Version')]);
    await app.settle();
    app.openTab();
    expect(app.qty(), 'fixture: the GM’s sheet carries the 3 potions').toBe('3');
    app.plusOnce();
    expect(app.qty()).toBe('4');
    // Every focus / visibility / online event re-runs the pull. The row is still in the table (the
    // cleanup delete is best-effort) and the stamp never reached storage.
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await new Promise((r) => setTimeout(r, 50));
    });
    app.openTab();
    expect(gm.fetches, 'fixture: the focus must have re-run the pull').toBeGreaterThan(1);
    expect(app.qty(), 'the same GM row applied twice and rewound the player').toBe('4');
  }, APP_TIMEOUT);

  // bug 2026-09-13: edits overwritten (D5)
  it('(c) keeps the play state the player changed WHILE the rows were in flight', async () => {
    let open = () => undefined as void;
    gm.gate = new Promise<void>((resolve) => {
      open = () => resolve();
    });
    gm.edits = [{ campaignId: 'camp', charId: 'c1', sheet: saved('c1', 'GM Version'), updatedAt: '2026-09-13T10:00:00Z' }];
    const app = await openInventory([saved('c1', 'Player Version')]);
    app.plusOnce(); // the player drinks in the pub while the fetch is out
    expect(app.qty()).toBe('4');
    await act(async () => {
      open();
      await new Promise((r) => setTimeout(r, 50));
    });
    app.openTab();
    expect(app.host.textContent, 'the GM’s character + build still land').toContain('GM Version');
    expect(app.qty(), 'the player’s own action was applied over by a sheet that predates it').toBe('4');
    expect(app.banner(), 'a replacement the player has to undo is never silent').toContain('Your GM updated');
  }, APP_TIMEOUT);
});
