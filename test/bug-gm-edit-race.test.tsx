// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { bumpItemQuantity, initialPlay } from '../src/rules/play';
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
  /** Run the moment the gate opens, INSIDE the microtask drain and before the rows are handed back —
   *  so anything it schedules is still queued, unrendered, when the apply reads the roster. Case (e). */
  onResume: null as (() => void) | null,
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
    gm.onResume?.();
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
  gm.onResume = null;
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

  // bug 2026-09-23: the banner was decided INSIDE the setRoster updater
  it('(d) says so even when App is already mid-update as the rows land', async () => {
    // (c) with one thing added: App has an update of its own scheduled and not yet rendered.
    // React runs a functional updater when it RENDERS, not when you hand it over — it only evaluates
    // it on the spot while the fiber has nothing pending. So a list filled inside the updater and read
    // on the next line is empty exactly when the app happens to be busy, and the banner that this whole
    // branch exists to raise never appears: the GM's sheet lands over the player's work, silently.
    // Without the fix (decide inside the `setRoster` updater again):
    //   AssertionError: expected '' to contain 'Your GM updated'
    let open = () => undefined as void;
    gm.gate = new Promise<void>((resolve) => {
      open = () => resolve();
    });
    gm.edits = [{ campaignId: 'camp', charId: 'c1', sheet: saved('c1', 'GM Version'), updatedAt: '2026-09-13T10:00:00Z' }];
    const app = await openInventory([saved('c1', 'Player Version')]);
    app.plusOnce(); // the player drinks in the pub while the fetch is out
    expect(app.qty()).toBe('4');
    // Past the persist debounce, or the cross-tab guard below skips on a queued write of our own.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    // DELIBERATELY OUTSIDE act(). A React update that has been scheduled and not yet rendered is a
    // Scheduler task — a macrotask — while the apply resumes from `await fetchGmEdits()` on a
    // microtask, and a microtask always runs first. That ordering is what puts the apply inside the
    // busy window deterministically; act() would flush the render before the rows land and the window
    // would never open. Another tab writing the roster is one real way to be in it (this one, so the
    // busy update is something the app itself does); a cloud pull, an autosave or a Realtime echo are
    // the others, and the fix must not depend on which.
    window.dispatchEvent(new StorageEvent('storage', { key: ROSTER_KEY, newValue: '[]' }));
    open();
    await app.settle();
    app.openTab();
    expect(app.host.textContent, 'the GM’s character + build still land').toContain('GM Version');
    expect(app.qty(), 'the player’s own action survives the busy window too').toBe('4');
    expect(app.banner(), 'busy is not a reason to take the player’s work without saying so').toContain('Your GM updated');
  }, APP_TIMEOUT);

  // bug 2026-09-23: (d)'s fix moved the KEEP decision out of the updater too
  it('(e) keeps play that is still QUEUED — work this tab has not rendered yet', async () => {
    // THE OTHER SIDE OF (d), and the trap in its fix. `rosterRef.current` is assigned during render,
    // so it is the last COMMITTED roster; `r` inside the setRoster updater is the latest QUEUED one.
    // They disagree in exactly the state (d) creates — an update scheduled and not yet rendered — and
    // when that queued update is ITSELF the player's work, a "did they edit during the fetch" compare
    // taken over rosterRef.current answers no (same object as beforeFetch captured) and the GM's `play`
    // replaces theirs. (d) cannot see it: its queued update is the roster re-parsed, byte for byte, so
    // stale and fresh agree. Here the queued roster carries a potion this tab has never rendered.
    //   Deciding over rosterRef.current instead of `r`:
    //     AssertionError: expected '3' to be '4'
    // A ROSTER ID OF ITS OWN. The cross-tab guard refuses to adopt an echo of any RECENT write of ours,
    // and `recentPersists()` is module state that outlives a test — (b), (c) and (d) each persist a
    // four-potion `c1`, so a four-potion `c1` arriving here reads as our own echo and is never adopted.
    // Measured: the adopt was silently skipped and this test passed the fix and failed the mutant for
    // the wrong reason. The app is right; the collision is the file's.
    const player = saved('e1', 'Player Version');
    const potion = player.play!.inventory!.find((i) => i.itemId === 'healing-potion-minor')!;
    // The player's OTHER tab (or their phone, through the cloud pull's merge — same Scheduler lane)
    // picked up one more: four potions, written to storage, never yet seen by this tab.
    const fromOtherTab = [{ ...player, play: bumpItemQuantity(player.play!, potion.instanceId, 1) }];
    let open = () => undefined as void;
    gm.gate = new Promise<void>((resolve) => {
      open = () => resolve();
    });
    gm.edits = [{ campaignId: 'camp', charId: 'e1', sheet: saved('e1', 'GM Version'), updatedAt: '2026-09-13T10:00:00Z' }];
    const app = await openInventory([player]);
    expect(app.qty(), 'fixture: this tab is showing three').toBe('3');
    // Past the persist debounce — the cross-tab guard refuses to adopt anything while a write of ours
    // is queued, and would skip the whole path below.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    // THE OTHER TAB'S WRITE LANDS *INSIDE THE MICROTASK DRAIN* that opens the gate — not merely
    // "before open()". A React render is a Scheduler task, so an update queued in this window cannot
    // have rendered by the time the apply resumes a microtask later: committed and queued are
    // guaranteed to disagree. Dispatching before open() instead is not enough, and measuring that is
    // what this test cost — the first draft did exactly that, act() flushed the adopt render first,
    // rosterRef.current was already the four-potion roster, and the test passed the bug.
    gm.onResume = () => {
      localStorage.setItem(ROSTER_KEY, JSON.stringify(fromOtherTab));
      window.dispatchEvent(new StorageEvent('storage', { key: ROSTER_KEY, newValue: JSON.stringify(fromOtherTab) }));
    };
    open();
    await app.settle();
    app.openTab();
    expect(app.host.textContent, 'the GM’s character + build still land').toContain('GM Version');
    expect(app.qty(), 'the player’s fourth potion was queued, not rendered — and taken').toBe('4');
  }, APP_TIMEOUT);

  // bug 2026-09-23: the banner was still decided over rosterRef.current while the map ran over `r`
  it('(f) says so when the work it replaced was QUEUED BUILD work, not play', async () => {
    // (e) KEPT the player's queued `play`. Their queued BUILD is a different ruling: the GM's sheet
    // replaces it, last change wins — being TOLD is what makes that recoverable. Decide who to tell
    // over `rosterRef.current` and the answer is about an entry the queued update has already replaced:
    // `was === c`, so nothing raced, and the published compare has nothing to say either — a level-up
    // made in the player's other tab is overwritten by the GM's sheet with the banner silent. That is
    // more than "told about fewer characters": it is work gone with no explanation, which is the one
    // thing a player cannot recover from on their own (they still can — one Ctrl+Z — but only if they
    // know to).
    //   Deciding over rosterRef.current instead of `r`:
    //     AssertionError: expected '' to contain 'Your GM updated'
    //
    // THE GM'S SHEET IS THIS TAB'S OWN, BYTE FOR BYTE. Nothing has been published this session, so the
    // fallback compare is incoming-vs-local — any difference there raises the banner by itself, and the
    // test would go green for a reason that has nothing to do with the queued roster. Identical sheets
    // leave the queued entry as the only thing that can answer. (e) is the proof that this window
    // really opens; the mutation above is what proves this leg reads it.
    const player = saved('f1', 'Player Version');
    // The player's other tab renamed them — build work, not play, so the raced branch cannot keep it.
    const fromOtherTab = [
      { ...player, build: { ...player.build, name: 'Other Tab' }, character: { ...player.character, name: 'Other Tab' } },
    ];
    let open = () => undefined as void;
    gm.gate = new Promise<void>((resolve) => {
      open = () => resolve();
    });
    gm.edits = [{ campaignId: 'camp', charId: 'f1', sheet: saved('f1', 'Player Version'), updatedAt: '2026-09-13T10:00:00Z' }];
    const app = await openInventory([player]);
    expect(app.banner(), 'fixture: an identical sheet has nothing to announce on its own').toBe('');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    gm.onResume = () => {
      localStorage.setItem(ROSTER_KEY, JSON.stringify(fromOtherTab));
      window.dispatchEvent(new StorageEvent('storage', { key: ROSTER_KEY, newValue: JSON.stringify(fromOtherTab) }));
    };
    open();
    await app.settle();
    expect(app.banner(), 'a build change replaced in the busy window is the silent one').toContain('Your GM updated');
    // It names the entry the map REALLY replaced — the queued one, which is the whole question here.
    expect(app.banner(), 'named from the roster the updater ran over').toContain('Other Tab');
    expect(app.host.textContent, 'the GM’s sheet still lands over it — last change wins').toContain('Player Version');
  }, APP_TIMEOUT);
});
