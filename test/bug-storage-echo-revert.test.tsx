// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { initialPlay } from '../src/rules/play';
import { flushPersist, recentPersists, schedulePersist } from '../src/data/persist';
import { ROSTER_KEY } from '../src/data/storage';
import type { SavedChar } from '../src/data/storage';

/**
 * "a change the player makes must NEVER be undone by the app."
 *
 * The cross-tab guard could undo one. It recognised only ONE value as its own echo — this tab's
 * CURRENT serialization — so the sequence below silently rewound an edit that was still on screen:
 *
 *   t=0    the player bumps a potion 3 → 4 in tab A          (v3, queued behind the 400 ms debounce)
 *   t=400  tab A's earlier write of v2 lands
 *   t≈400  tab B adopts v2 and re-persists it a debounce later
 *   t=800  tab A receives a `storage` event carrying v2 — not equal to v3, so "another tab wrote the
 *          roster": cancel our pending write of v3 and reload v2. The potion is back at 3.
 *
 * Everything here runs the REAL <App/> in jsdom against the shipped content, and the potion count is
 * read off the rendered inventory card — the number the player is looking at.
 */
const derived = vi.hoisted(() => ({ rosters: [] as { character: { name: string } }[][] }));
vi.mock('../src/data/cloudSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/cloudSync')>();
  return {
    ...actual,
    noteDerivedRefresh: (roster: SavedChar[]) => {
      derived.rosters.push(roster as unknown as { character: { name: string } }[]);
      actual.noteDerivedRefresh(roster);
    },
  };
});

const ACTIVE_KEY = 'wanderers-codex:active:v1';
/** The whole shipped database is parsed and the whole app is mounted; 5 s is not enough for either. */
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
  vi.unstubAllGlobals();
});

/** Mount the real app on a seeded roster, already open on the character's Inventory tab. */
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
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  const button = (label: string) => [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label);
  act(() => button('Inventory')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const card = () => [...host.querySelectorAll<HTMLElement>('.inv-card')].find((e) => (e.textContent ?? '').includes('Potion'));
  return {
    host,
    /** The potion count as rendered on its inventory card. */
    qty: () => card()?.querySelector('.inv-qtystep span')?.textContent,
    plusOnce: () =>
      act(() => {
        card()!
          .querySelector<HTMLButtonElement>('button[aria-label="Increase quantity"]')!
          .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }),
    /** Another tab wrote `value` to the roster key (localStorage already holds it, as it would). */
    otherTabWrote: (value: string) =>
      act(() => {
        localStorage.setItem(ROSTER_KEY, value);
        window.dispatchEvent(new StorageEvent('storage', { key: ROSTER_KEY, newValue: value }));
      }),
  };
}

describe('a storage event from another tab never undoes a local edit', () => {
  // bug 2026-09-13: edits overwritten (D1)
  it('remembers the rosters it wrote, as the objects it was handed', () => {
    const roster = [{ id: 'p1' }];
    schedulePersist(roster);
    flushPersist();
    expect(recentPersists(), 'the echo guard compares against these — a copy would never match').toContain(roster);
  });

  // bug 2026-09-13: edits overwritten (D1)
  it('remembers MORE than the last write — a lagging tab echoes an older one', () => {
    // Only the last write was remembered at first. A backgrounded tab's timers are throttled to a
    // second or more, so its echo of what it adopted routinely arrives after this tab has written
    // again — and an echo we no longer recognise is adopted, which rewinds the newer edit.
    const v1 = [{ id: 'p1', n: 1 }];
    const v2 = [{ id: 'p1', n: 2 }];
    schedulePersist(v1);
    flushPersist();
    schedulePersist(v2);
    flushPersist();
    expect(recentPersists(), 'an echo of v1 arriving now is not another tab’s work').toContain(v1);
    expect(recentPersists()).toContain(v2);
  });

  // bug 2026-09-13: edits overwritten (D1)
  it('(a) IGNORES an echo of our own last write — the edit stays on screen', async () => {
    const app = await openInventory([saved('c1', 'Echo')]);
    act(() => flushPersist()); // our write lands; this is the value another tab would adopt
    const ourLastWrite = localStorage.getItem(ROSTER_KEY)!;
    app.plusOnce();
    expect(app.qty(), 'fixture: the click must have moved the count').toBe('4');
    app.otherTabWrote(ourLastWrite); // tab B re-persists what it adopted from us
    expect(app.qty(), 'the app rewound an edit the player had just made').toBe('4');
  }, APP_TIMEOUT);

  // bug 2026-09-13: edits overwritten (D1)
  it('(b) ADOPTS a genuinely different roster, as a derived refresh', async () => {
    const app = await openInventory([saved('c1', 'Echo')]);
    act(() => flushPersist()); // nothing of ours is queued — the other tab's version is the newest
    const theirs = JSON.stringify([{ ...saved('c1', 'Tab Two') }, saved('c2', 'Newcomer')]);
    const before = derived.rosters.length;
    app.otherTabWrote(theirs);
    expect(app.host.textContent, 'another tab’s work must still reach this one').toContain('Tab Two');
    // …and it must never be mistaken for an edit made HERE: stamping it would make this device the
    // newest copy of every character and win merges it should lose (noteDerivedRefresh's incident).
    expect(derived.rosters.length, 'an adopted roster was not registered as a derived refresh').toBeGreaterThan(before);
    expect(derived.rosters.at(-1)!.map((c) => c.character.name)).toContain('Newcomer');
  }, APP_TIMEOUT);

  // bug 2026-09-13: edits overwritten (D1)
  it('(a2) IGNORES an echo of an OLDER write of ours, after we have already written again', async () => {
    // The single-editor loss the "remember only the last write" guard still had. Tab B is not editing
    // anything — it adopted our v1 and will re-persist it — but its debounce is throttled (backgrounded
    // tab), so its echo lands after our own v2 has gone to storage with nothing pending. v1 then looked
    // like another tab's work, and the potion went back to 3 in front of the player.
    const app = await openInventory([saved('c1', 'Echo')]);
    act(() => flushPersist());
    const v1 = localStorage.getItem(ROSTER_KEY)!;
    app.plusOnce();
    act(() => flushPersist()); // v2 is written; nothing of ours is queued any more
    expect(app.qty(), 'fixture: the click must have moved the count').toBe('4');
    app.otherTabWrote(v1); // tab B's late echo of what it adopted from our v1
    expect(app.qty(), 'the app rewound an edit that was already saved').toBe('4');
  }, APP_TIMEOUT);

  // bug 2026-09-13: edits overwritten (D1)
  it('(b2) keeps OUR queued edit rather than adopting over it, even from a genuinely different roster', async () => {
    // While one of our own edits is still inside the debounce, THIS tab holds the newest state: the
    // other tab was necessarily writing a version that predates it. Adopting would rewind the edit the
    // player is looking at. (The other tab's own work is then overwritten when our write lands — the
    // two-tabs-both-editing case, which is a decision for the owner, not something this guard settles.)
    const app = await openInventory([saved('c1', 'Echo')]);
    act(() => flushPersist());
    app.plusOnce(); // queued, 400 ms
    app.otherTabWrote(JSON.stringify([saved('c1', 'Tab Two')]));
    expect(app.qty(), 'an edit still inside our own debounce was rewound by another tab').toBe('4');
  }, APP_TIMEOUT);

  // bug 2026-09-13: edits overwritten (D1)
  it('(c) keeps the PENDING write of the newer edit — it lands, it is not cancelled', async () => {
    const app = await openInventory([saved('c1', 'Echo')]);
    act(() => flushPersist());
    const ourLastWrite = localStorage.getItem(ROSTER_KEY)!;
    app.plusOnce();
    app.otherTabWrote(ourLastWrite);
    act(() => flushPersist()); // the debounce fires
    const stored = JSON.parse(localStorage.getItem(ROSTER_KEY)!) as SavedChar[];
    const potion = (stored[0].play?.inventory ?? []).find((i) => i.itemId === 'healing-potion-minor');
    expect(potion?.quantity, 'the edit was dropped from storage, so closing the app loses it').toBe(4);
  }, APP_TIMEOUT);
});
