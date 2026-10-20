// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { addInventoryItem, initialPlay } from '../src/rules/play';
import { ROSTER_KEY, type SavedChar } from '../src/data/storage';
import { authoredKey, hash53 } from '../src/data/authored';
import { LINEAGE_KEY, rosterSig } from '../src/data/rosterLineage';

/**
 * TWO TABS OF ONE BROWSER PROFILE (package H1; ruled "fix it", docs/gold-set-answers.md, 2026-10-15
 * evening). Both tabs are the WHOLE app — two module graphs (`vi.resetModules()` between the imports),
 * so each has its own persist debounce, cross-tab guard and GM-edit pass — sharing jsdom's one
 * localStorage. A roster write reaches the tabs as a `storage` event on the next task, as a browser
 * delivers it (`net.hold` keeps it back: a tab too busy to hear of it yet). The event is delivered to
 * BOTH tabs here; a real browser skips the writer, and the app must ignore its own write anyway. Every
 * leg runs twice, with the tabs rendering every frame and with neither rendering until a wait is over
 * (`cadence`).
 *
 * The loss, before the fix (leg 1): the player bumps a potion in tab A (queued behind A's 400 ms
 * persist debounce); the GM's push is applied in tab B, which writes the roster at once. A ignored B's
 * write because its own edit was still queued, then wrote its edit over B's; B ignored that (its own
 * post-apply write was queued), then wrote the GM's sheet back over the player's edit — and A adopted
 * it. The potion came back. Leg 2 is the other order (A's write lands, B applies before it has heard of
 * it); leg 3 is the player editing in both tabs at once; leg 4 is a write built on a roster older than
 * the one it replaced (B's copy of storage behind A's).
 *
 * RED ON THE OLD CODE (run 2026-10-18 against a `git archive HEAD` copy of 9abc8ce with this file
 * added): all eight runs fail on `tab A: … expected '3' to be '4'`.
 *
 * Every character here is synthetic.
 */
type Base = { v: number; at: string; stamp: string; hash: string; on: string | null };
type Row = { campaignId: string; charId: string; sheet: unknown; updatedAt: string; gmBase?: Base };
const net = vi.hoisted(() => ({
  /** How many module graphs have evaluated the party mock — the tab number of each graph. */
  graphs: 0,
  /** Only this tab's GM-edit pass sees `edits` (the other tab's pass finds none). */
  gmTab: 0,
  edits: [] as Row[],
  own: new Map<string, { sheet: unknown; updatedAt: string; gmRefusedAt?: string }>(),
  publishGate: null as Promise<void> | null,
  receipts: [] as { campaignId: string; charId: string; at: string }[],
  deletes: [] as { campaignId: string; charId: string; updatedAt?: string }[],
  clock: 0,
  /** While true, a roster write's `storage` event is HELD (a tab too busy to hear of it yet) until
   *  `releaseEvents()`; otherwise it is delivered on the next task. */
  hold: false,
  held: [] as StorageEvent[],
  /** While set, every read of the roster key returns this instead (a tab whose copy of storage has
   *  not caught up with another tab's write yet). */
  staleRoster: null as string | null,
  /** While set, the GM-edit pass's "pull before an apply" answers with this (leg 7 taps inside it). */
  cloud: null as null | (() => Promise<boolean>),
}));

vi.mock('../src/data/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in', session: null, email: 'player@example.com' }),
}));
/** The party layer of ONE tab's module graph (registered with `vi.doMock` as the tab opens: a hoisted
 *  `vi.mock` factory is evaluated once per file, not once per graph). */
const partyMock = (tab: number) => async (importOriginal: () => Promise<unknown>) => {
  const jsonb = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(jsonb)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
              .map((k) => [k, jsonb((v as Record<string, unknown>)[k])]),
          )
        : v;
  return {
    ...((await importOriginal()) as typeof import('../src/data/party')),
    fetchGmEdits: async () => (tab === net.gmTab ? net.edits : []),
    fetchPublishedSheet: async (campaignId: string, charId: string) => {
      const r = net.own.get(`${campaignId}|${charId}`);
      return r
        ? { sheet: jsonb(JSON.parse(JSON.stringify(r.sheet))), updatedAt: r.updatedAt, ownerId: 'player-1', gmRefusedAt: r.gmRefusedAt }
        : { sheet: null, updatedAt: undefined, ownerId: undefined };
    },
    publishCharacter: async (campaignId: string, charId: string, _name: string, _summary: unknown, sheet: unknown) => {
      if (net.publishGate) await net.publishGate;
      const prior = net.own.get(`${campaignId}|${charId}`);
      net.own.set(`${campaignId}|${charId}`, {
        sheet: JSON.parse(JSON.stringify(sheet)),
        updatedAt: new Date(Date.UTC(2026, 9, 18, 12, 0, ++net.clock)).toISOString(),
        ...(prior?.gmRefusedAt ? { gmRefusedAt: prior.gmRefusedAt } : {}),
      });
      return 'ok';
    },
    unpublishCharacter: async () => 'ok',
    deleteGmEdit: async (campaignId: string, charId: string, updatedAt?: string) => {
      net.deletes.push({ campaignId, charId, updatedAt });
      net.edits = net.edits.filter((e) => !(e.campaignId === campaignId && e.charId === charId && e.updatedAt === updatedAt));
      return 1;
    },
    markGmEditRefused: async (campaignId: string, charId: string, at: string) => {
      net.receipts.push({ campaignId, charId, at });
      const ownRow = net.own.get(`${campaignId}|${charId}`);
      if (ownRow) ownRow.gmRefusedAt = at;
      return true;
    },
    currentUserId: async () => null,
  };
};
vi.mock('../src/data/cloudSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/cloudSync')>()),
  startCloudSync: async () => () => undefined,
  pullForGmApply: () => (net.cloud ? net.cloud() : null),
}));

// Production update priorities (see test/bug-gm-edit-race.test.tsx): `window.event` is jsdom's real
// current event, so a background update takes the default lane as it does in a browser.
const jsdomWindow = (globalThis as unknown as { jsdom?: { window: { event?: Event } } }).jsdom?.window;
if (!jsdomWindow) throw new Error('fixture: the jsdom environment exposes no `jsdom` global');
Object.defineProperty(window, 'event', { configurable: true, get: () => jsdomWindow?.event, set: () => undefined });

const ACTIVE_KEY = 'wanderers-codex:active:v1';
const TIMEOUT = 240_000;
const CAMP = 'camp';

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
  campaignIds: [CAMP],
});

function saved(id: string, name: string): SavedChar {
  const db = content();
  const build = buildOf(name);
  const character = buildCharacter(build, db);
  return { id, character, build, play: initialPlay(character, db) } as SavedChar;
}
const H = (sc: unknown) => hash53(authoredKey(sc as SavedChar));
let pushClock = 0;
/** The GM's working copy as GmEditSheet makes it: the PUBLISHED sheet, renamed — nothing else touched. */
function gmRenamed(charId: string, name: string): SavedChar {
  const pub = structuredClone(net.own.get(`${CAMP}|${charId}`)!.sheet) as SavedChar;
  return { ...pub, character: { ...pub.character, name }, build: { ...pub.build!, name } };
}
/** A GM push built on what the server publishes for the character right now. */
function push(charId: string, sheet: SavedChar): Row {
  const own = net.own.get(`${CAMP}|${charId}`)!;
  const at = `2026-10-18T09:${String(++pushClock).padStart(2, '0')}:00.000Z`;
  return { campaignId: CAMP, charId, sheet, updatedAt: at, gmBase: { v: 1, at, stamp: own.updatedAt, hash: H(own.sheet), on: null } };
}

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const n of [...document.body.children]) n.remove();
  localStorage.clear();
  net.gmTab = 0;
  net.edits = [];
  net.own.clear();
  net.publishGate = null;
  net.receipts = [];
  net.deletes = [];
  net.hold = false;
  net.held = [];
  net.staleRoster = null;
  net.cloud = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * HOW OFTEN THE TABS RENDER. React renders work scheduled inside an `act` scope only when the scope
 * ends. 'live': waits are cut into 16 ms scopes, so each tab renders about every frame, as in a browser.
 * 'frozen': one scope per wait, so neither tab renders until it is over while their timers and `storage`
 * events keep firing — a tab whose main thread is busy for the whole window. Every leg runs under both:
 * a fold handed to React must reach the next write even when React has not rendered it yet.
 */
let cadence: 'live' | 'frozen' = 'live';
const wait = async (ms: number) => {
  if (cadence === 'frozen') {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
    return;
  }
  for (let left = ms; left > 0; left -= 16) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, Math.min(16, left)));
    });
  }
};
/** A focus event: every tab's GM-edit pass runs (only `net.gmTab`'s finds the row). */
const focus = () =>
  act(async () => {
    window.dispatchEvent(new Event('focus'));
    await new Promise((r) => setTimeout(r, 60));
  });

/** One browser profile: jsdom's localStorage, and every roster write announced to the tabs a moment later. */
function shareStorage(): void {
  const realGet = Storage.prototype.getItem;
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, k: string) {
    return k === ROSTER_KEY && net.staleRoster !== null ? net.staleRoster : realGet.call(this, k);
  });
  const realSet = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
    const oldValue = this.getItem(k);
    realSet.call(this, k, v);
    if (k !== ROSTER_KEY || oldValue === v) return;
    const event = new StorageEvent('storage', { key: k, oldValue, newValue: v });
    if (net.hold) net.held.push(event);
    else setTimeout(() => window.dispatchEvent(event), 0);
  });
}
/** Deliver every held `storage` event, in the order the writes happened. */
function releaseEvents(): void {
  net.hold = false;
  for (const e of net.held.splice(0)) setTimeout(() => window.dispatchEvent(e), 0);
}

function stubBrowser(): void {
  const files: Record<string, string> = {
    'core.json': 'public/core.json',
    'core-descriptions.json': 'public/core-descriptions.json',
  };
  vi.stubGlobal('fetch', async (url: string) => {
    const path = files[String(url).split('/').pop() ?? ''];
    if (!path) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(path, 'utf8')) as unknown };
  });
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
}

interface Tab {
  /** This tab's number — what `net.gmTab` names. */
  n: number;
  /** This tab's own persist module (proof the graphs are separate). */
  persist: unknown;
  host: HTMLElement;
  /** The potion count on this tab's Inventory tab. */
  qty: () => string | undefined;
  plusOnce: () => void;
  /** Click this tab's hero-point pip labelled "Set hero points to n". */
  heroPip: (n: number) => void;
  /** This tab's rail shows NO hero point (with one, the first pip reads "Set hero points to 0"). */
  heroPointSpent: () => boolean;
  shows: (text: string) => boolean;
  /** Give (free) the item named `name` from this tab's Add-items picker; the picker stays open. */
  give: (name: string) => void;
  closePicker: () => void;
  /** The names on this tab's inventory cards (a duplicate's copy number included: "Rope 1"). */
  cardNames: () => string[];
  /** Press this tab's own Undo button (Ctrl+Z would reach every tab here: they share one window). */
  undo: () => void;
}

/** Open the app in a NEW tab: its own module graph, the same localStorage. */
async function openTab(): Promise<Tab> {
  vi.resetModules();
  const n = ++net.graphs;
  vi.doMock('../src/data/party', partyMock(n));
  const { default: App } = await import('../src/App');
  const persist = await import('../src/data/persist');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(<App />);
  });
  const button = (label: string) => [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label);
  for (let i = 0; i < 300 && !button('Inventory'); i++) await wait(50);
  if (!button('Inventory')) throw new Error('fixture: the sheet never opened in this tab');
  const openInventory = () => act(() => button('Inventory')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const card = () => [...host.querySelectorAll<HTMLElement>('.inv-card')].find((e) => (e.textContent ?? '').includes('Potion'));
  return {
    n,
    persist,
    host,
    qty: () => {
      openInventory();
      return card()?.querySelector('.inv-qtystep span')?.textContent ?? undefined;
    },
    plusOnce: () =>
      act(() => {
        openInventory();
        card()!
          .querySelector<HTMLButtonElement>('button[aria-label="Increase quantity"]')!
          .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }),
    heroPip: (n: number) =>
      act(() => {
        host
          .querySelector<HTMLButtonElement>(`button[aria-label="Set hero points to ${n}"]`)!
          .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }),
    heroPointSpent: () => !!host.querySelector('button[aria-label="Set hero points to 1"]') && !host.querySelector('button[aria-label="Set hero points to 0"]'),
    shows: (text: string) => (host.textContent ?? '').includes(text),
    give: (name: string) => {
      openInventory();
      const click = (el: Element | null | undefined) => {
        if (!el) throw new Error(`fixture: nothing to click (giving ${name})`);
        act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      };
      if (!host.querySelector('.fsel-results')) click(button('Add item'));
      const search = host.querySelector<HTMLInputElement>('.fsel-results-search input')!;
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(search, name);
      act(() => search.dispatchEvent(new Event('input', { bubbles: true })));
      const row = [...host.querySelectorAll<HTMLElement>('.ai-row')].find((r) => (r.querySelector('.ai-name')?.textContent ?? '').trim() === name);
      click(row?.querySelector('button.give'));
    },
    closePicker: () => act(() => host.querySelector('.fsel .picker-close')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))),
    cardNames: () => {
      openInventory();
      return [...host.querySelectorAll<HTMLElement>('.inv-card .inv-name')].map((e) => (e.textContent ?? '').trim());
    },
    undo: () => {
      const b = host.querySelector<HTMLButtonElement>('button[aria-label="Undo"]');
      if (!b || b.disabled) throw new Error('fixture: this tab has no step to undo');
      act(() => b.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    },
  };
}

/** Both tabs open on the same synthetic character, its launch publish landed. */
async function twoTabs(id: string): Promise<{ a: Tab; b: Tab }> {
  stubBrowser();
  shareStorage();
  localStorage.setItem(ROSTER_KEY, JSON.stringify([saved(id, 'Player Version')]));
  localStorage.setItem(ACTIVE_KEY, id);
  const a = await openTab();
  const b = await openTab();
  expect(a.persist, 'fixture: each tab is its own module graph').not.toBe(b.persist);
  await wait(900); // launch writes, launch publishes
  expect(net.own.has(`${CAMP}|${id}`), 'fixture: the launch published the sheet').toBe(true);
  expect(a.qty(), 'fixture: tab A starts on three potions').toBe('3');
  expect(b.qty(), 'fixture: tab B starts on three potions').toBe('3');
  return { a, b };
}

const stored = (id: string): SavedChar => (JSON.parse(localStorage.getItem(ROSTER_KEY)!) as SavedChar[]).find((c) => c.id === id)!;
const storedPotions = (id: string) => stored(id).play?.inventory?.find((i) => i.itemId === 'healing-potion-minor')?.quantity;

for (const mode of ['live', 'frozen'] as const)
describe(`two tabs of one browser profile never lose the player’s change (renders: ${mode})`, () => {
  beforeEach(() => {
    cadence = mode;
  });

  it('(1) H1: the GM’s push is applied in tab B inside tab A’s 400 ms debounce — the player’s potion stays, and so does the GM’s change', async () => {
    /*
     * MUTATION (run 2026-10-18): drop `foldIntoPersist(fold, rosterRef.current)` from App's foldForeign
     * — the merge then reaches only React's queue, the debounce writes the roster of the last commit
     * over tab B's, and this fails under 'frozen' on `tab A: … expected '3' to be '4'` (leg 4 too).
     */
    const { a, b } = await twoTabs('t1');
    net.gmTab = b.n; // only tab B's pass sees the GM's row
    a.plusOnce(); // the player picks up a fourth potion in tab A — queued behind A's debounce
    expect(a.qty()).toBe('4');
    net.edits = [push('t1', gmRenamed('t1', 'GM Version'))]; // the GM renames the character
    await focus(); // tab B's pass applies it at once (B holds exactly the sheet he built on)
    expect(b.shows('GM Version'), 'fixture: the GM’s push landed in tab B inside A’s debounce').toBe(true);
    await wait(2500); // both debounces, both events, both publishes
    expect(a.qty(), 'tab A: the player’s potion was taken back').toBe('4');
    expect(b.qty(), 'tab B: the player’s potion never reached the other tab').toBe('4');
    expect(storedPotions('t1'), 'on disk: the player’s potion was overwritten').toBe(4);
    expect(stored('t1').play?.inventory?.filter((i) => i.itemId === 'healing-potion-minor'), 'one potion stack, not two').toHaveLength(1);
    expect(stored('t1').character.name, 'on disk: the GM’s change was dropped').toBe('GM Version');
    expect(a.shows('GM Version') && b.shows('GM Version'), 'both tabs carry the GM’s change').toBe(true);
  }, TIMEOUT);

  it('(2) the player’s write lands first, and tab B applies the GM’s push before it has read that write — the push is refused, the potion stays', async () => {
    /*
     * MUTATION (run 2026-10-18): skip the after-commit check for another tab's write in App
     * (`const foreign = Math.random() > 2 ? takeForeignRoster() : null;`) — the apply is consumed and
     * the merge at the write keeps the potion but lands the GM's rename with no receipt, and this fails
     * on `a push built before the player’s change never lands over it: expected true to be false`.
     */
    const { a, b } = await twoTabs('t2');
    net.gmTab = b.n;
    let open = () => undefined as void;
    net.publishGate = new Promise<void>((r) => {
      open = () => r();
    }); // every publish from here on is on the wire
    net.hold = true; // tab B is busy: it hears of A's write only later
    a.plusOnce();
    for (let i = 0; i < 100 && storedPotions('t2') !== 4; i++) await wait(50);
    expect(storedPotions('t2'), 'fixture: tab A’s write landed').toBe(4);
    expect(b.qty(), 'fixture: tab B has not heard of it').toBe('3');
    const row = push('t2', gmRenamed('t2', 'GM Version'));
    net.edits = [row];
    await focus(); // B judges against the server (still the three-potion sheet) and applies
    releaseEvents();
    await wait(1200);
    net.publishGate = null;
    open();
    await wait(1500);
    expect(a.qty(), 'tab A: the player’s potion was taken back').toBe('4');
    expect(b.qty(), 'tab B').toBe('4');
    expect(storedPotions('t2'), 'on disk').toBe(4);
    expect(a.shows('GM Version') || b.shows('GM Version'), 'a push built before the player’s change never lands over it').toBe(false);
    expect(
      net.receipts.some((r) => r.charId === 't2' && r.at === row.updatedAt),
      'the GM is told “not applied” — the push met a change of the player’s',
    ).toBe(true);
  }, TIMEOUT);

  it('(3) the player edits the same character in both tabs inside one debounce — both changes stay', async () => {
    const { a, b } = await twoTabs('t3');
    a.plusOnce(); // tab A: a fourth potion
    b.heroPip(0); // tab B, at the same moment: spends the hero point
    await wait(2000);
    expect(a.qty(), 'tab A lost its own potion').toBe('4');
    expect(b.qty(), 'tab B never got tab A’s potion').toBe('4');
    expect(storedPotions('t3'), 'on disk: the potion').toBe(4);
    expect(stored('t3').play?.heroPoints, 'on disk: the hero point tab B spent').toBe(0);
    expect(a.heroPointSpent(), 'tab A never got the hero point tab B spent').toBe(true);
    expect(b.heroPointSpent(), 'tab B lost its own hero point').toBe(true);
  }, TIMEOUT);

  it('(4) tab B writes the GM’s push over the player’s write without having seen it — tab A merges it against the roster B built on', async () => {
    /*
     * The write B makes is built on the three-potion roster (B's copy of storage has not caught up), so
     * it carries no fourth potion — not because anyone took it back. Merged against A's own last write
     * it read as "the potion was taken back"; its lineage record names the roster it was really built
     * on, and against THAT the potion is A's and the rename is B's.
     * MUTATION (run 2026-10-18): ignore the lineage base in src/data/rosterTabs.ts takeForeignRoster
     * (`const base = k.roster as SavedChar[];`) — and this fails on `tab A: … expected '3' to be '4'`.
     */
    const { a, b } = await twoTabs('t4');
    net.gmTab = b.n;
    const before = localStorage.getItem(ROSTER_KEY)!;
    let open = () => undefined as void;
    net.publishGate = new Promise<void>((r) => {
      open = () => r();
    }); // A's publish of the potion is still on the wire when the GM's row is judged
    net.hold = true;
    a.plusOnce();
    for (let i = 0; i < 100 && storedPotions('t4') !== 4; i++) await wait(50);
    expect(storedPotions('t4'), 'fixture: tab A’s write landed').toBe(4);
    net.edits = [push('t4', gmRenamed('t4', 'GM Version'))];
    net.staleRoster = before; // tab B still reads the three-potion roster
    await focus(); // …so its apply lands, and its write goes over A's
    net.staleRoster = null;
    expect(b.shows('GM Version'), 'fixture: the push was applied in tab B').toBe(true);
    expect(storedPotions('t4'), 'fixture: B’s write replaced A’s on disk').toBe(3);
    releaseEvents();
    net.publishGate = null;
    open();
    await wait(2000);
    expect(a.qty(), 'tab A: the player’s potion was taken back').toBe('4');
    expect(b.qty(), 'tab B').toBe('4');
    expect(storedPotions('t4'), 'on disk').toBe(4);
    expect(stored('t4').character.name, 'the GM’s rename, which nothing of the player’s touched, stays').toBe('GM Version');
  }, TIMEOUT);

  /*
   * (5)–(6): ITEMS ADDED AT THE SAME MOMENT (checker finding 1, 2026-10-19). New rows were numbered
   * `inv-${max + 1}`, so an add in each tab made two items with ONE id, and the merge took them for one
   * item both tabs had edited: one vanished into the other. Ids a player's add mints are unique now
   * (src/rules/recordIds.ts; the merge-level legs are test/record-ids.test.ts).
   * RED ON 6393b29 (run 2026-10-20, `git archive` copy with this file; legs 1–4 pass there): (5) fails
   * under both cadences on `on disk: tab A’s longsword: expected [] …` (tab B's dagger took its id), and
   * (6) on `on disk: the GM’s waterskin: expected [] …` (the player's dagger took its id).
   */
  const count = (names: string[], name: string) => names.filter((n) => n === name || n.startsWith(`${name} `)).length;
  const storedRows = (id: string, itemId: string) => (stored(id).play?.inventory ?? []).filter((i) => i.itemId === itemId);

  it('(5) both tabs ADD items inside one debounce — a different item and the same one in each: every item stays, in both tabs and on disk, none mixed', async () => {
    const { a, b } = await twoTabs('t5');
    a.give('Longsword');
    a.give('Rope');
    a.closePicker();
    b.give('Dagger');
    b.give('Rope'); // the same purchase in both tabs: two ropes, not one
    b.closePicker();
    await wait(2500);
    const inv = stored('t5').play?.inventory ?? [];
    expect(storedRows('t5', 'longsword'), 'on disk: tab A’s longsword').toEqual([expect.objectContaining({ quantity: 1 })]);
    expect(storedRows('t5', 'dagger'), 'on disk: tab B’s dagger').toEqual([expect.objectContaining({ quantity: 1 })]);
    expect(storedRows('t5', 'rope'), 'on disk: a rope bought in each tab').toHaveLength(2);
    expect(storedRows('t5', 'healing-potion-minor'), 'on disk: the potions').toEqual([expect.objectContaining({ quantity: 3 })]);
    expect(new Set(inv.map((i) => i.instanceId)).size, 'one id, one item').toBe(inv.length);
    for (const [tab, t] of [['tab A', a], ['tab B', b]] as const) {
      const names = t.cardNames();
      expect(count(names, 'Longsword'), `${tab}: ${names.join(', ')}`).toBe(1);
      expect(count(names, 'Dagger'), `${tab}: ${names.join(', ')}`).toBe(1);
      expect(count(names, 'Rope'), `${tab}: ${names.join(', ')}`).toBe(2);
    }
  }, TIMEOUT);

  it('(6) the GM GIVES an item (applied in tab B) while the player adds one in tab A — both items stay', async () => {
    const { a, b } = await twoTabs('t6');
    net.gmTab = b.n;
    a.give('Dagger'); // queued behind A's debounce
    a.closePicker();
    // The GM's device mints the item it gives — its own app, its own ids.
    const pub = structuredClone(net.own.get(`${CAMP}|t6`)!.sheet) as SavedChar;
    net.edits = [push('t6', { ...pub, play: addInventoryItem(pub.play!, 'waterskin') })];
    await focus(); // tab B applies it at once
    expect(count(b.cardNames(), 'Waterskin'), 'fixture: the GM’s item landed in tab B inside A’s debounce').toBe(1);
    await wait(2500);
    expect(storedRows('t6', 'waterskin'), 'on disk: the GM’s waterskin').toEqual([expect.objectContaining({ quantity: 1 })]);
    expect(storedRows('t6', 'dagger'), 'on disk: the player’s dagger').toEqual([expect.objectContaining({ quantity: 1 })]);
    for (const [tab, t] of [['tab A', a], ['tab B', b]] as const) {
      const names = t.cardNames();
      expect(count(names, 'Waterskin'), `${tab}: ${names.join(', ')}`).toBe(1);
      expect(count(names, 'Dagger'), `${tab}: ${names.join(', ')}`).toBe(1);
    }
  }, TIMEOUT);

  /*
   * (7)–(9): A CHECKER'S FINDINGS ON 6393b29 (2026-10-20). RED ON HEAD b8f8a6e (run 2026-10-20, a `git
   * archive` copy with this file and its new helpers; legs 1–6 pass there): see each leg.
   */
  it('(7) S1: tab B applies the GM’s push and the player spends a hero point on top of it in the same render batch, while tab A’s potion waits unread — the hero point stays, the push does not', async () => {
    /*
     * What happens (traced 2026-10-20): the tap commits first, alone (a click outranks the apply's
     * background update), and that commit's after-commit effect folds A's write in — so the entry is a
     * merge, and the apply's record is DROPPED as "replaced". React then commits the apply from the result
     * it computed at dispatch, without running the updater again, the tap rebased on it (carrying its
     * mark) and the fold re-run on top. On HEAD that fold found no record for the push, merged it as a
     * consumed one ('conflicts'), and the push LANDED while its row was refused "not applied" — fails on
     * `a push built before the player’s change never lands over it: expected true to be false`. Now an apply
     * not landed stays known by mark (App's gmUnlandedRef) and the fold takes it back out of the entry,
     * keeping the tap (src/data/rosterFold.ts gmApplyYields).
     * MUTATION (run 2026-10-20): `yieldTo: gmApplyYields(gmAppliedRef.current)` in App's mergeOpts — fails
     * the same way. MUTATION: `if (rec) return 'whole';` in gmApplyYields (6393b29's rule, the record
     * found) — fails on `on disk: the hero point spent in tab B: expected 1 to be +0`.
     */
    const { a, b } = await twoTabs('t7');
    net.gmTab = b.n;
    let open = () => undefined as void;
    net.publishGate = new Promise<void>((r) => {
      open = () => r();
    }); // the server still holds the three-potion sheet when B judges
    net.hold = true; // tab B hears of A's write only later
    a.plusOnce();
    for (let i = 0; i < 100 && storedPotions('t7') !== 4; i++) await wait(50);
    expect(storedPotions('t7'), 'fixture: tab A’s write landed').toBe(4);
    const row = push('t7', gmRenamed('t7', 'GM Version'));
    net.edits = [row];
    // The pull before the apply answers "level"; the player taps in the next task — after the pass made
    // its roster update and before the act scope lets React render it (as race leg 41).
    let tapped = false;
    net.cloud = () => {
      setTimeout(() => {
        if (tapped) return;
        tapped = true;
        b.host.querySelector('button[aria-label="Set hero points to 0"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }, 0);
      return Promise.resolve(true);
    };
    await focus();
    net.cloud = null;
    expect(tapped, 'fixture: the tap landed inside the window').toBe(true);
    releaseEvents();
    await wait(1200);
    net.publishGate = null;
    open();
    await wait(1500);
    expect(stored('t7').play?.heroPoints, 'on disk: the hero point spent in tab B').toBe(0);
    expect(b.heroPointSpent(), 'tab B: its own hero point').toBe(true);
    expect(a.heroPointSpent(), 'tab A: tab B’s hero point').toBe(true);
    expect(storedPotions('t7'), 'on disk: tab A’s potion').toBe(4);
    expect(a.qty()).toBe('4');
    expect(b.qty()).toBe('4');
    expect(a.shows('GM Version') || b.shows('GM Version'), 'a push built before the player’s change never lands over it').toBe(false);
    expect(net.receipts.some((r) => r.charId === 't7' && r.at === row.updatedAt), 'the GM is told “not applied”').toBe(true);
  }, TIMEOUT);

  it('(8) S3: another tab signs this browser in as ANOTHER ACCOUNT while tab A holds an unsaved edit — nothing of the old account is written into the new one', async () => {
    /*
     * What startSync does in the switching tab: wipe the account's keys, save the new owner, and (after
     * its pull) write the new account's roster onto the empty key — lineage `on: null`. On HEAD tab A's
     * debounce wrote its old roster into the emptied key (fails on `nothing of the old account is written
     * while the key is empty: expected '[{"id":"t8",…' to be null`), and, that held back, merged the new
     * roster against the old one and kept its edited old character ("they deleted it, we changed it").
     * MUTATION (run 2026-10-20): drop the HOLD_WRITE line in App's reconcileWrite — fails on the same
     * empty-key assertion. MUTATION: skip the `rosterOwnerSwitched()` block in rosterTabs
     * takeForeignRoster — fails on `tab A shows the new account: expected false to be true`.
     */
    const OWNER = 'pf2e-codex.syncOwner';
    localStorage.setItem(OWNER, 'acct-old');
    const { a, b } = await twoTabs('t8');
    const writes: string[] = [];
    a.plusOnce(); // queued behind A's debounce: the old account's last edit
    // The other tab switches accounts — every roster write from here on is recorded (each one is
    // announced as a `storage` event: shareStorage).
    const record = (e: StorageEvent) => {
      if (e.key === ROSTER_KEY && e.newValue !== null) writes.push(e.newValue);
    };
    window.addEventListener('storage', record);
    localStorage.removeItem(ROSTER_KEY);
    localStorage.removeItem(ACTIVE_KEY);
    localStorage.setItem(OWNER, 'acct-new');
    await wait(800); // A's debounce fires while the key is empty
    expect(localStorage.getItem(ROSTER_KEY), 'nothing of the old account is written while the key is empty').toBe(null);
    // …and tab A says so (2026-10-20, a checker's finding: the held write was dropped without a word).
    const banner = (t: Tab) => t.host.querySelector('.save-warning:not(.storage-warning)');
    expect(banner(a), 'tab A: the “can’t save” banner while its write is held').not.toBeNull();
    // Fix-up F2 (2026-10-20): it names the account switch and never blames storage, which is fine here.
    // MUTATION (run 2026-10-20): App's banner always shows the storage text → `the banner names the
    // account switch: expected 'Changes can’t be saved — browser stor…' to contain 'different account'`.
    const bannerText = banner(a)?.textContent ?? '';
    expect(bannerText, 'the banner names the account switch').toContain('different account');
    expect(bannerText, 'the banner says to reload this tab').toContain('reload this tab');
    expect(bannerText, 'the banner does not blame storage').not.toContain('storage');
    const fresh = JSON.stringify([saved('n8', 'New Account Hero')]);
    localStorage.setItem(LINEAGE_KEY, JSON.stringify({ sig: rosterSig(fresh), on: null }));
    localStorage.setItem(ROSTER_KEY, fresh);
    await wait(2000);
    window.removeEventListener('storage', record);
    const ids = (JSON.parse(localStorage.getItem(ROSTER_KEY)!) as SavedChar[]).map((c) => c.id);
    expect(ids, 'on disk: the new account’s roster only').toEqual(['n8']);
    expect(writes.filter((w) => w.includes('"t8"')), 'no write carried the old account’s character').toEqual([]);
    for (const [tab, t] of [['tab A', a], ['tab B', b]] as const) {
      expect(t.shows('New Account Hero'), `${tab} shows the new account`).toBe(true);
      expect(t.shows('Player Version'), `${tab} still shows the old account’s character`).toBe(false);
      expect(banner(t), `${tab}: no “can’t save” banner once the new account’s roster is taken`).toBeNull();
    }
  }, TIMEOUT);

  it('(9) S4: Ctrl+Z in tab B after tab A’s dagger was folded in takes back B’s own potion — never A’s dagger', async () => {
    /*
     * Every fold of another tab's write was its own undo step: on HEAD Undo in B removed the dagger, on
     * disk and in A, and B's potion stayed (fails on `tab B: its own potion is taken back: expected '4'
     * to be '3'`).
     */
    const { a, b } = await twoTabs('t9');
    b.plusOnce(); // tab B's own last action
    await wait(1000);
    a.give('Dagger');
    a.closePicker();
    await wait(1500); // A writes; B folds the dagger in
    expect(count(b.cardNames(), 'Dagger'), 'fixture: tab B holds A’s dagger').toBe(1);
    b.undo();
    await wait(1500);
    expect(b.qty(), 'tab B: its own potion is taken back').toBe('3');
    expect(storedPotions('t9'), 'on disk: the potion').toBe(3);
    expect(storedRows('t9', 'dagger'), 'on disk: tab A’s dagger stays').toEqual([expect.objectContaining({ quantity: 1 })]);
    for (const [tab, t] of [['tab A', a], ['tab B', b]] as const) {
      expect(count(t.cardNames(), 'Dagger'), `${tab}: the dagger`).toBe(1);
      expect(t.qty(), `${tab}: the potions`).toBe('3');
    }
  }, TIMEOUT);
});
