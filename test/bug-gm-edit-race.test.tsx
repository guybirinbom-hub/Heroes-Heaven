// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { bumpItemQuantity, initialPlay } from '../src/rules/play';
import { ROSTER_KEY, loadRoster, readCloudBundle, writeCloudBundle, type SavedChar } from '../src/data/storage';
import { authoredKey, hash53 } from '../src/data/authored';
import { noteDerivedRefresh, noteRosterChange } from '../src/data/cloudSync';
import { mergeBundles } from '../src/data/cloudMerge';
import { flushPersist } from '../src/data/persist';
import {
  clearGmPendingEdits,
  gmEditRefused,
  gmEditVerdict,
  gmPendingEdit,
  rememberGmEdit,
  resolvePendingGmEdit,
  setGmPendingAccount,
} from '../src/sheet/gmSync';

/**
 * A GM's edit is a WHOLE sheet. Applied blindly it ate work the player could not get back; these legs
 * run the REAL <App/> with the party layer mocked.
 *
 * Until 2026-10-09 the app replaced the sheet and announced it in a banner ("your GM overwrote you").
 * F1 (2026-10-09): the player's app now applies a GM edit only when it provably loses nothing of
 * theirs (src/sheet/gmSync.ts → gmEditVerdict): their own published row is read fresh, and the edit
 * lands only while that row is still exactly the sheet the GM built on AND this device holds exactly
 * that sheet. Otherwise it WAITS (nothing consumed) or is REFUSED (never applied; a receipt tells the
 * GM "not applied"). The banner is gone — there is no replaced work left to announce.
 *
 *  (a)–(f) of 2026-09-13 / 2026-09-23 are rewritten as (a')–(f') below; each keeps its bug date and
 *  cites F1. The rest are the F1 design's legs 21 and 27–35, numbered as there.
 */
type Base = { v: number; at: string; stamp: string; hash: string; on: string | null };
type Row = { campaignId: string; charId: string; sheet: unknown; updatedAt: string; gmBase?: Base | 'future' };
const gm = vi.hoisted(() => ({
  /** Rows fetchGmEdits hands back (gm_character_edits, as gmEditFromRow maps them). */
  edits: [] as Row[],
  /** When set, fetchGmEdits waits on it — the in-flight window of (c'). */
  gate: null as Promise<void> | null,
  /** Run the moment the gate opens, INSIDE the microtask drain and before the rows are handed back —
   *  so anything it schedules is still queued, unrendered, when the pass reads the roster. (e'). */
  onResume: null as (() => void) | null,
  fetches: 0,
  /** `campaign_characters` — what this player's app has published, by campaign|char. */
  own: new Map<string, { sheet: unknown; updatedAt: string; gmRefusedAt?: string }>(),
  /** Reads of the player's OWN published row — every judgment makes one. */
  ownReads: 0,
  /** Hold own-row reads until released; they answer with what the server holds WHEN released. */
  ownGate: null as Promise<void> | null,
  /** Hold publishes until released — a publish in flight. */
  publishGate: null as Promise<void> | null,
  /** Make every publish FAIL (offline). */
  publishFail: false,
  publishes: [] as { campaignId: string; charId: string; sheet: unknown }[],
  deletes: [] as { campaignId: string; charId: string; updatedAt?: string }[],
  receipts: [] as { campaignId: string; charId: string; at: string }[],
  /** F1 (2026-10-09): receipt UPDATEs attempted, and how many of the next ones FAIL (a blip). */
  receiptAttempts: 0,
  failReceipts: 0,
  /** F1 (2026-10-09, round 6): the next receipt UPDATE takes this long (ms) — and still lands. */
  receiptDelay: 0,
  clock: 0,
  /** F1 (2026-10-09): App's own cloud-adopt callback, captured from startCloudSync. */
  adopt: null as null | ((roster: unknown[]) => void),
  /** F1 (2026-10-09): what `pullForGmApply` does — null (the default) is "no cloud sync". */
  cloud: null as null | (() => Promise<boolean>),
}));

vi.mock('../src/data/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in', session: null, email: 'player@example.com' }),
}));
vi.mock('../src/data/party', async (importOriginal) => {
  /** jsonb's own key order — a published sheet never comes back in the order it was written. */
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
    ...(await importOriginal<typeof import('../src/data/party')>()),
    fetchGmEdits: async () => {
      gm.fetches++;
      if (gm.gate) await gm.gate;
      gm.onResume?.();
      return gm.edits;
    },
    fetchPublishedSheet: async (campaignId: string, charId: string) => {
      gm.ownReads++;
      if (gm.ownGate) await gm.ownGate;
      const r = gm.own.get(`${campaignId}|${charId}`);
      return r
        ? { sheet: jsonb(JSON.parse(JSON.stringify(r.sheet))), updatedAt: r.updatedAt, ownerId: 'player-1', gmRefusedAt: r.gmRefusedAt }
        : { sheet: null, updatedAt: undefined, ownerId: undefined };
    },
    publishCharacter: async (campaignId: string, charId: string, _name: string, _summary: unknown, sheet: unknown) => {
      if (gm.publishGate) await gm.publishGate;
      if (gm.publishFail) return 'failed';
      gm.publishes.push({ campaignId, charId, sheet });
      // The server stamps every publish (the player's clock at send) — no trigger, no rule. The upsert
      // never sends `gm_refused_at`, so a receipt survives it (party.ts publishCharacter).
      const prior = gm.own.get(`${campaignId}|${charId}`);
      gm.own.set(`${campaignId}|${charId}`, {
        sheet: JSON.parse(JSON.stringify(sheet)),
        updatedAt: new Date(Date.UTC(2026, 9, 9, 12, 0, ++gm.clock)).toISOString(),
        ...(prior?.gmRefusedAt ? { gmRefusedAt: prior.gmRefusedAt } : {}),
      });
      return 'ok';
    },
    unpublishCharacter: async () => 'ok',
    deleteGmEdit: async (campaignId: string, charId: string, updatedAt?: string) => {
      gm.deletes.push({ campaignId, charId, updatedAt });
      return 1;
    },
    markGmEditRefused: async (campaignId: string, charId: string, at: string) => {
      gm.receiptAttempts++;
      if (gm.receiptDelay > 0) {
        // F1 (2026-10-09, round 6): a slow UPDATE that still lands (leg 46).
        const d = gm.receiptDelay;
        gm.receiptDelay = 0;
        await new Promise((r) => setTimeout(r, d));
      }
      // F1 (2026-10-09): the real one says whether the UPDATE landed.
      if (gm.failReceipts > 0) {
        gm.failReceipts--;
        return false;
      }
      gm.receipts.push({ campaignId, charId, at });
      // F1 (2026-10-09, round 6): the column-only UPDATE of their own row — what a later read sees (leg 46).
      const ownRow = gm.own.get(`${campaignId}|${charId}`);
      if (ownRow) ownRow.gmRefusedAt = at;
      return true;
    },
    currentUserId: async () => null, // no Realtime subscription in the test
  };
});
vi.mock('../src/data/cloudSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/cloudSync')>()),
  // F1 (2026-10-09): App's adopt callback is captured (legs 36, 37), and the pull before an apply is
  // the leg's to model (null — no cloud sync — unless a leg sets `gm.cloud`).
  startCloudSync: async (cb: (roster: unknown[]) => void) => {
    gm.adopt = cb;
    return () => undefined;
  },
  pullForGmApply: () => (gm.cloud ? gm.cloud() : null),
}));

/*
 * PRODUCTION UPDATE PRIORITIES, FOR EVERY LEG. F1 (2026-10-09, round 6): React picks an update's lane
 * from `window.event` — a discrete event (a click) gets the SYNC lane, anything else (a promise
 * continuation, a timer: the cloud adopt, the storage handler, the GM-edit pass) the DEFAULT lane. In a
 * browser `window.event` is the event being dispatched, undefined outside one. Here it was stuck at a
 * stale 'click' (React DEV's guarded-callback shim leaves one behind on jsdom's global), so every
 * background setState ran on the sync lane and this harness could not see a lane bug: a sync-lane
 * apply that skipped a pending default-lane adopt passed here and crashed the app in the field
 * (legs 43–45). `window.event` is jsdom's REAL current event from here on, before the first render.
 */
const jsdomWindow = (globalThis as unknown as { jsdom?: { window: { event?: Event } } }).jsdom?.window;
if (!jsdomWindow) throw new Error('fixture: the jsdom environment exposes no `jsdom` global — production lanes cannot be modelled');
Object.defineProperty(window, 'event', { configurable: true, get: () => jsdomWindow?.event, set: () => undefined });

const ACTIVE_KEY = 'wanderers-codex:active:v1';
const APP_TIMEOUT = 120_000;
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
});

/** A synthetic character, attached to `campaignIds` so the app publishes it. */
function saved(id: string, name: string, campaignIds: string[] = [CAMP]): SavedChar {
  const db = content();
  // The BUILD carries the campaigns (buildCharacter derives `character.campaignIds` from it), so the
  // launch rebuild keeps them.
  const build = { ...buildOf(name), campaignIds };
  const character = buildCharacter(build, db);
  return { id, character, build, play: initialPlay(character, db) } as SavedChar;
}
const H = (sc: unknown) => hash53(authoredKey(sc as SavedChar));
let pushClock = 0;
/**
 * A GM push row, built on what the server publishes for (campaign, char) RIGHT NOW (or on `base`):
 * `gm_base` bound to its own stamp. The GM's clock runs on 09:xx — earlier than every publish here —
 * because nothing may ever order the two clocks.
 */
function push(charId: string, sheet: SavedChar, opts: { campaignId?: string; on?: string | null; base?: { stamp: string; hash: string } } = {}): Row {
  const campaignId = opts.campaignId ?? CAMP;
  const own = gm.own.get(`${campaignId}|${charId}`);
  const base = opts.base ?? { stamp: own!.updatedAt, hash: H(own!.sheet) };
  const at = `2026-10-09T09:${String(++pushClock).padStart(2, '0')}:00.000Z`;
  return { campaignId, charId, sheet, updatedAt: at, gmBase: { v: 1, at, stamp: base.stamp, hash: base.hash, on: opts.on ?? null } };
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
  gm.own.clear();
  gm.ownReads = 0;
  gm.ownGate = null;
  gm.publishGate = null;
  gm.publishFail = false;
  gm.publishes = [];
  gm.deletes = [];
  gm.receipts = [];
  gm.receiptAttempts = 0;
  gm.failReceipts = 0;
  gm.receiptDelay = 0;
  gm.clock = 0;
  gm.adopt = null;
  gm.cloud = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const wait = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
/** A focus event: the pull every GM edit arrives through when Realtime is not up. */
const pull = () =>
  act(async () => {
    window.dispatchEvent(new Event('focus'));
    await new Promise((r) => setTimeout(r, 50));
  });
/** A gate a leg opens by hand. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open = () => undefined as void;
  const promise = new Promise<void>((resolve) => {
    open = () => resolve();
  });
  return { promise, open };
}

async function openInventory(roster: SavedChar[], opts: { launchPublish?: boolean } = {}) {
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
  // F1 (2026-10-09, round 6): React has rendered; outside a dispatch there is still no current event —
  // every background update in this leg takes the lane it takes in a browser (see the override above).
  expect((window as { event?: Event }).event, 'fixture: production update priorities survive the first render').toBeUndefined();
  const button = (label: string) => [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label);
  // The content database is in once the sheet is up; the launch publish (PUBLISH_DEBOUNCE_MS = 400)
  // follows it — what the server holds before any GM edit.
  for (let i = 0; i < 200 && !button('Inventory'); i++) await settle();
  if (opts.launchPublish !== false) await wait(600);
  const openTab = () => act(() => button('Inventory')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  openTab();
  const card = () => [...host.querySelectorAll<HTMLElement>('.inv-card')].find((e) => (e.textContent ?? '').includes('Potion'));
  return {
    host,
    settle,
    openTab,
    qty: () => {
      openTab();
      return card()?.querySelector('.inv-qtystep span')?.textContent;
    },
    plusOnce: () =>
      act(() => {
        openTab();
        card()!
          .querySelector<HTMLButtonElement>('button[aria-label="Increase quantity"]')!
          .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }),
    undo: () =>
      act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
        await new Promise((r) => setTimeout(r, 0));
      }),
    shows: (name: string) => (host.textContent ?? '').includes(name),
  };
}

const deleted = (row: Row) => gm.deletes.some((d) => d.charId === row.charId && d.campaignId === row.campaignId && d.updatedAt === row.updatedAt);
const receipted = (row: Row) => gm.receipts.some((d) => d.charId === row.charId && d.campaignId === row.campaignId && d.at === row.updatedAt);

describe('a GM edit never eats the player’s work', () => {
  // F1 (2026-10-09, round 6): the premise every leg below stands on — production update priorities.
  it('(0) fixture: `window.event` is the event being dispatched, and nothing outside a dispatch', async () => {
    const seen: (string | undefined)[] = [];
    const onFocus = () => seen.push((window as { event?: Event }).event?.type);
    window.addEventListener('focus', onFocus);
    window.dispatchEvent(new MouseEvent('click', { bubbles: true })); // a click leaves nothing behind
    window.dispatchEvent(new Event('focus'));
    window.removeEventListener('focus', onFocus);
    await Promise.resolve();
    seen.push((window as { event?: Event }).event?.type ?? 'none');
    await new Promise((r) => setTimeout(r, 0));
    seen.push((window as { event?: Event }).event?.type ?? 'none');
    expect(seen, 'inside a dispatch: that event; in a promise continuation or a timer: none').toEqual(['focus', 'none', 'none']);
  });

  // bug 2026-09-13: edits overwritten (D5) — F1 (2026-10-09): rewritten as (a'). The banner is gone.
  it('(a′ / 20) idle: their published row is exactly what he built on and this device holds it — his edit lands, silently', async () => {
    /*
     * MUTATION (run 2026-10-09): compare this device's sheet with the EDIT instead of the published row —
     * `if (atBase && A === authoredKey(a.row.sheet)) return 'apply';` in gmSync.gmEditVerdict — and this
     * fails —
     *   AssertionError: the GM’s version lands: expected false to be true
     */
    const app = await openInventory([saved('a1', 'Player Version')]);
    expect(gm.own.has(`${CAMP}|a1`), 'fixture: the launch published the sheet').toBe(true);
    const row = push('a1', saved('a1', 'GM Version'));
    gm.edits = [row];
    await pull();
    expect(app.shows('GM Version'), 'the GM’s version lands').toBe(true);
    expect(app.host.querySelector('.gm-overwrote'), 'no banner — nothing of theirs was replaced').toBeNull();
    await wait(600);
    expect(gm.publishes.some((p) => p.charId === 'a1' && (p.sheet as SavedChar).character.name === 'GM Version'), 'and it is republished').toBe(true);
    expect(deleted(row), 'the row is deleted on its own stamp').toBe(true);
    expect(gm.receipts).toEqual([]);
  }, APP_TIMEOUT);

  it('(21) F1: they published after his read (4 potions → he read 3) — his edit is REFUSED, the potion stays, a receipt is written', async () => {
    /*
     * The refuter's P2b2 / P2c / P5c, against the real app: GM reads; player changes the character and
     * their app publishes within 400 ms; his push, built on the read, arrives; this device is level with
     * the server, so the old loss detector saw nothing and the sheet was replaced, silently.
     * MUTATION (run 2026-10-09): drop `atBase` from the general rule (`if (A === S) return 'apply';`) —
     * and this fails —
     *   AssertionError: their potion is never taken back: expected '3' to be '4'
     */
    const app = await openInventory([saved('f21', 'Player Version')]);
    const row = push('f21', saved('f21', 'GM Version')); // built on their 3-potion sheet
    app.plusOnce(); // they pick up a fourth
    await wait(600); // …and their app publishes it
    expect(gm.publishes.filter((p) => p.charId === 'f21')).toHaveLength(2);
    gm.edits = [row];
    await pull();
    expect(app.qty(), 'their potion is never taken back').toBe('4');
    expect(app.shows('GM Version'), 'his sheet never lands').toBe(false);
    expect(receipted(row), 'the GM is told: a receipt on their row').toBe(true);
    expect(deleted(row), 'consumed — on its own stamp').toBe(true);
  }, APP_TIMEOUT);

  // bug 2026-09-13: edits overwritten (D5) — F1 (2026-10-09): rewritten as (b').
  it('(b′ / 22) one row is judged ONCE even when the handled stamp cannot be stored', async () => {
    /*
     * localStorage refuses the stamp (quota / private mode); saveGmEditsApplied swallows it. Every focus /
     * visibility / online event re-runs the pull, and the row is still in the table.
     * MUTATION (run 2026-10-09): drop the session stamps — `const handled = { ...loadGmEditsApplied() };`
     * in App's pass — and this fails —
     *   AssertionError: the same row is never judged twice: expected 2 to be 1
     */
    const realSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k.includes('gm-edits-applied')) throw new Error('QuotaExceededError');
      realSet.call(this, k, v);
    });
    const app = await openInventory([saved('b1', 'Player Version')]);
    gm.edits = [push('b1', saved('b1', 'GM Version'))];
    await pull();
    expect(app.shows('GM Version'), 'fixture: it applied').toBe(true);
    expect(app.qty(), 'fixture: the GM’s sheet carries the 3 potions').toBe('3');
    const reads = gm.ownReads;
    app.plusOnce();
    await wait(600);
    await pull();
    expect(gm.fetches, 'fixture: the focus re-ran the pull').toBeGreaterThan(2);
    expect(gm.ownReads, 'the same row is never judged twice').toBe(reads);
    expect(app.qty(), 'and never rewinds the player').toBe('4');
    expect(gm.receipts, 'no false "not applied"').toEqual([]);
  }, APP_TIMEOUT);

  // bug 2026-09-13: edits overwritten (D5) — F1 (2026-10-09): rewritten as (c').
  it('(c′ / 23) the player changes the character WHILE the rows are in flight — it waits, then is refused once their change publishes', async () => {
    /*
     * MUTATION (run 2026-10-09): drop the publish-success re-run — `gmPullRef.current();` out of App's
     * onPublishedKey — and this fails —
     *   AssertionError: refused and consumed once their change published: expected false to be true
     */
    const app = await openInventory([saved('c1', 'Player Version')]);
    const row = push('c1', saved('c1', 'GM Version'));
    gm.edits = [row];
    const g = gate();
    gm.gate = g.promise;
    await pull(); // the fetch is out
    app.plusOnce(); // the player drinks in the pub while it is
    expect(app.qty()).toBe('4');
    await act(async () => {
      g.open();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(app.shows('GM Version'), 'a sheet that predates their change never lands').toBe(false);
    expect(app.qty()).toBe('4');
    expect(deleted(row), 'waiting: nothing consumed yet').toBe(false);
    gm.gate = null;
    await wait(600); // their change publishes; that re-runs the pull
    expect(deleted(row) && receipted(row), 'refused and consumed once their change published').toBe(true);
    expect(app.qty()).toBe('4');
    expect(app.shows('GM Version')).toBe(false);
  }, APP_TIMEOUT);

  // bug 2026-09-23: the banner was decided INSIDE the setRoster updater — F1 (2026-10-09): rewritten as (d').
  it('(d′ / 24) …and when App is already mid-update as the rows land', async () => {
    /*
     * (c') with one thing added: App has an update of its own scheduled and not yet rendered (another
     * tab writing the roster — DELIBERATELY OUTSIDE act(), so the pass resumes on a microtask inside the
     * busy window). This guards the WAIT/REFUSE path in that state; the in-updater re-check it would
     * otherwise need is pinned by (e')'s mutation.
     */
    const app = await openInventory([saved('d1', 'Player Version')]);
    gm.edits = [push('d1', saved('d1', 'GM Version'))];
    const g = gate();
    gm.gate = g.promise;
    await pull();
    app.plusOnce();
    expect(app.qty()).toBe('4');
    await wait(600); // past the persist debounce (and their publish lands)
    window.dispatchEvent(new StorageEvent('storage', { key: ROSTER_KEY, newValue: '[]' }));
    g.open();
    await app.settle();
    expect(app.shows('GM Version'), 'his sheet never lands over their potion').toBe(false);
    expect(app.qty(), 'the player’s own action survives the busy window').toBe('4');
    expect(app.host.querySelector('.gm-overwrote'), 'no banner').toBeNull();
  }, APP_TIMEOUT);

  // bug 2026-09-23: (d)'s fix moved the KEEP decision out of the updater too — F1 (2026-10-09): (e').
  it('(e′ / 25) play that is still QUEUED (another tab, inside the gate’s microtask) is never applied over — and is refused once it publishes', async () => {
    /*
     * `rosterRef.current` is the last COMMITTED roster; the updater's `r` is the latest QUEUED one. The
     * pass judges APPLY over the committed entry (3 potions = the server); the queued entry carries a
     * fourth potion this tab has never rendered. The in-updater re-check is what keeps it.
     * A ROSTER ID OF ITS OWN: the cross-tab guard refuses to adopt an echo of any recent write of ours,
     * and `recentPersists()` is module state that outlives a leg.
     * MUTATION (run 2026-10-09): drop the in-updater re-check (`if (cur !== k.judged && …) continue;`) —
     * and this fails —
     *   AssertionError: the queued fourth potion is never taken: expected '3' to be '4'
     */
    const player = saved('e1', 'Player Version');
    const potion = player.play!.inventory!.find((i) => i.itemId === 'healing-potion-minor')!;
    const fromOtherTab = [{ ...player, play: bumpItemQuantity(player.play!, potion.instanceId, 1) }];
    const app = await openInventory([player]);
    expect(app.qty(), 'fixture: this tab is showing three').toBe('3');
    const row = push('e1', saved('e1', 'GM Version'));
    gm.edits = [row];
    const g = gate();
    gm.gate = g.promise;
    await pull();
    gm.onResume = () => {
      localStorage.setItem(ROSTER_KEY, JSON.stringify(fromOtherTab));
      window.dispatchEvent(new StorageEvent('storage', { key: ROSTER_KEY, newValue: JSON.stringify(fromOtherTab) }));
    };
    g.open();
    await app.settle();
    expect(app.qty(), 'the queued fourth potion is never taken').toBe('4');
    expect(app.shows('GM Version')).toBe(false);
    gm.gate = null;
    gm.onResume = null;
    await wait(600); // the adopted roster publishes; the waiting row is judged again
    expect(receipted(row), 'refused once their queued change published').toBe(true);
    expect(app.qty()).toBe('4');
  }, APP_TIMEOUT);

  // bug 2026-09-23: queued BUILD work — F1 (2026-10-09): rewritten as (f'). Nothing is replaced now.
  it('(f′ / 26) a queued BUILD change from another tab ("Other Tab") is never replaced', async () => {
    /*
     * MUTATION (run 2026-10-09): drop the in-updater re-check — and this fails —
     *   AssertionError: their rename stays: expected false to be true
     */
    const player = saved('f1', 'Player Version');
    const fromOtherTab = [
      { ...player, build: { ...player.build, name: 'Other Tab' }, character: { ...player.character, name: 'Other Tab' } },
    ];
    const app = await openInventory([player]);
    gm.edits = [push('f1', saved('f1', 'GM Version'))];
    const g = gate();
    gm.gate = g.promise;
    await pull();
    gm.onResume = () => {
      localStorage.setItem(ROSTER_KEY, JSON.stringify(fromOtherTab));
      window.dispatchEvent(new StorageEvent('storage', { key: ROSTER_KEY, newValue: JSON.stringify(fromOtherTab) }));
    };
    g.open();
    await app.settle();
    expect(app.shows('Other Tab'), 'their rename stays').toBe(true);
    expect(app.shows('GM Version'), 'nothing replaced it').toBe(false);
  }, APP_TIMEOUT);

  it('(27) their publish is IN FLIGHT when the row arrives — it waits, then is refused when the publish lands', async () => {
    /*
     * MUTATION (run 2026-10-09): treat "the server is at the base" alone as apply — `if (atBase) return
     * 'apply';` for the general rule — and this fails —
     *   AssertionError: his sheet never lands over the change on its way: expected true to be false
     */
    const app = await openInventory([saved('g27', 'Player Version')]);
    const row = push('g27', saved('g27', 'GM Version'));
    const g = gate();
    gm.publishGate = g.promise; // their next publish stays on the wire
    app.plusOnce();
    await wait(600);
    gm.edits = [row];
    await pull();
    expect(app.shows('GM Version'), 'his sheet never lands over the change on its way').toBe(false);
    expect(deleted(row), 'waiting').toBe(false);
    gm.publishGate = null;
    await act(async () => {
      g.open();
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(receipted(row), 'refused once it landed').toBe(true);
    expect(app.qty()).toBe('4');
  }, APP_TIMEOUT);

  it('(28) their publish FAILED — the row waits (no delete, no receipt), the publish is retried on `online`, then the row is refused', async () => {
    /*
     * MUTATION (run 2026-10-09): keep the sent JSON whatever the result (drop `sentJsonRef.current.delete(key)`
     * from App's failed branch) — and this fails —
     *   AssertionError: the retry landed: expected [ { campaignId: 'camp', …(2) } ] to have a length of 2 but got 1
     */
    const app = await openInventory([saved('h28', 'Player Version')]);
    const row = push('h28', saved('h28', 'GM Version'));
    gm.publishFail = true;
    app.plusOnce();
    await wait(600); // the publish fails
    gm.edits = [row];
    await pull();
    await pull();
    expect(app.shows('GM Version')).toBe(false);
    expect(deleted(row) || receipted(row), 'waiting: never consumed while their work is not on the server').toBe(false);
    gm.publishFail = false;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await new Promise((r) => setTimeout(r, 600));
    });
    expect(gm.publishes.filter((p) => p.charId === 'h28'), 'the retry landed').toHaveLength(2);
    expect(receipted(row), 'then the row is refused').toBe(true);
    expect(app.qty()).toBe('4');
  }, APP_TIMEOUT);

  it('(29) two campaigns, both rows at their bases — exactly the lower campaign id lands; the other is refused once the republish moves its row', async () => {
    /*
     * MUTATION (run 2026-10-09): re-check every candidate against the ORIGINAL entry (`c !== k.judged`
     * for `cur !== k.judged`) — and this fails —
     *   AssertionError: campaign A (lower id) lands: expected false to be true
     */
    const both = ['camp-a', 'camp-b'];
    const app = await openInventory([saved('i29', 'Player Version', both)]);
    const rowA = push('i29', saved('i29', 'GM A Version', both), { campaignId: 'camp-a' });
    const rowB = push('i29', saved('i29', 'GM B Version', both), { campaignId: 'camp-b' });
    gm.edits = [rowB, rowA];
    await pull();
    expect(app.shows('GM A Version'), 'campaign A (lower id) lands').toBe(true);
    expect(app.shows('GM B Version')).toBe(false);
    await wait(600); // the republish moves campaign B's row too
    expect(receipted(rowB), 'B is refused — it was built on the sheet A replaced').toBe(true);
    expect(receipted(rowA)).toBe(false);
  }, APP_TIMEOUT);

  for (const when of ['before', 'after'] as const) {
    it(`(30) the chain: his second push, built on his first (\`on\`), lands where the first was applied — ${when} its republish`, async () => {
      /*
       * MUTATION (run 2026-10-09): drop the chain branch from gmSync.gmEditVerdict — and both variants fail —
       *   AssertionError: his second push lands on his first: expected false to be true
       * F1 (2026-10-09): the record must name its push. MUTATION (run 2026-10-09): App's after-commit
       * effect writes `{ base, result }` without `at` — both variants fail the same way, and (31) with
       *   AssertionError: their Ctrl+Z is kept: expected true to be false
       */
      const app = await openInventory([saved(`j30${when}`, 'Player Version')]);
      const id = `j30${when}`;
      const base = { stamp: gm.own.get(`${CAMP}|${id}`)!.updatedAt, hash: H(gm.own.get(`${CAMP}|${id}`)!.sheet) };
      const e1 = push(id, saved(id, 'GM Version'), { base });
      gm.edits = [e1];
      await pull();
      expect(app.shows('GM Version'), 'fixture: his first landed').toBe(true);
      if (when === 'after') await wait(600);
      const e2 = push(id, saved(id, 'GM Second Version'), { base, on: e1.updatedAt }); // built on his held e1
      gm.edits = [e2];
      await pull();
      expect(app.shows('GM Second Version'), 'his second push lands on his first').toBe(true);
      expect(receipted(e2)).toBe(false);
    }, APP_TIMEOUT);
  }

  it('(13b) this device applied his first push and is BEHIND their other device, which took it back — his second push never lands, and their other device’s publish is never overwritten', async () => {
    /*
     * F1 (2026-10-09): refuter probe zz-f1-probe-timing-2, T2 (table case 13). E2 was built on his held E1
     * before this device's republish of E1 landed. Their OTHER device (cloud-synced to E1's result) drank
     * the potion, publishing the 3-potion content again under a NEW stamp; this device has not adopted it.
     * The chain clause judged "the server is still at the base" by content alone, APPLIED E2 (which
     * carries E1's potion) and the republish replaced the other device's publish. It needs the very
     * publish now (gm-sync (10e)).
     * MUTATION (run 2026-10-09): `const atThatPublish = hS === b.hash;` in gmSync.gmEditVerdict — and this fails —
     *   AssertionError: table case 13: a device behind the server never lands his second push, and their other device’s publish (3 potions) is never overwritten: expected { landed: true, …(2) } to deeply equal { landed: false, …(2) }
     */
    const id = 't13b';
    const player = saved(id, 'Player Version');
    const app = await openInventory([player]);
    const key = `${CAMP}|${id}`;
    const s0 = gm.own.get(key)!;
    const s0Sheet = JSON.parse(JSON.stringify(s0.sheet)) as SavedChar;
    const base = { stamp: s0.updatedAt, hash: H(s0Sheet) };
    const withPotion = (sc: SavedChar): SavedChar => {
      const p = sc.play!.inventory!.find((i) => i.itemId === 'healing-potion-minor')!;
      return { ...sc, play: bumpItemQuantity(sc.play!, p.instanceId, 1) };
    };
    const e1 = push(id, withPotion(player), { base });
    gm.edits = [e1];
    await pull();
    expect(app.qty(), 'fixture: his first push landed here').toBe('4');
    // His second gesture, made before this device's republish landed: his held e1 stands on that read.
    const e2 = push(id, withPotion(saved(id, 'GM Second Version')), { base, on: e1.updatedAt });
    gm.edits = [];
    await wait(600); // this device republishes e1's result
    expect(H(gm.own.get(key)!.sheet), 'fixture: e1’s result is published').not.toBe(base.hash);
    // Their OTHER device drinks the potion: the 3-potion content, under a NEW stamp. This device is behind.
    gm.own.set(key, { sheet: s0Sheet, updatedAt: '2026-10-09T12:30:00.000Z' });
    expect(app.qty(), 'fixture: this device is behind the server').toBe('4');
    gm.edits = [e2];
    await pull();
    const landed = app.shows('GM Second Version');
    await wait(600);
    const published = gm.own.get(key)!.sheet as SavedChar;
    expect(
      { landed, publishedName: published.character.name, publishedIsTheirs: H(published) === base.hash },
      'table case 13: a device behind the server never lands his second push, and their other device’s publish (3 potions) is never overwritten',
    ).toEqual({ landed: false, publishedName: 'Player Version', publishedIsTheirs: true });
    expect(receipted(e2), 'and the GM is told "not applied"').toBe(true);
  }, APP_TIMEOUT);

  it('(31) Ctrl+Z of his applied edit inside the publish debounce: his next push built on it is REFUSED; one built on their sheet lands', async () => {
    /*
     * MUTATION (run 2026-10-09): drop the chain branch — and this fails —
     *   AssertionError: their Ctrl+Z is kept: expected true to be false
     * MUTATION (run 2026-10-09): key the chain on the base alone (drop `b.on &&`) — and this fails —
     *   AssertionError: his next push, built on their sheet, lands: expected false to be true
     * F1 (2026-10-09): the chain record now names its push (`at`), so that mutation is
     * `if (a.chain && a.chain.base === b.hash)` — both gates dropped (gm-sync (11) pins it purely).
     */
    const app = await openInventory([saved('k31', 'Player Version')]);
    const base = { stamp: gm.own.get(`${CAMP}|k31`)!.updatedAt, hash: H(gm.own.get(`${CAMP}|k31`)!.sheet) };
    const e1 = push('k31', saved('k31', 'GM Version'), { base });
    gm.edits = [e1];
    await pull();
    expect(app.shows('GM Version'), 'fixture: his first landed').toBe(true);
    await app.undo(); // within the 400 ms debounce: nothing of it was published
    expect(app.shows('GM Version'), 'fixture: the undo took it back').toBe(false);
    const e2 = push('k31', saved('k31', 'GM Second Version'), { base, on: e1.updatedAt });
    gm.edits = [e2];
    await pull();
    expect(app.shows('GM Second Version'), 'their Ctrl+Z is kept').toBe(false);
    expect(receipted(e2), 'and he is told').toBe(true);
    const e3 = push('k31', saved('k31', 'GM Third Version'), { base, on: null });
    gm.edits = [e3];
    await pull();
    expect(app.shows('GM Third Version'), 'his next push, built on their sheet, lands').toBe(true);
  }, APP_TIMEOUT);

  /*
   * F1 (2026-10-09): refuter probe zz-f1-probe-rulings-1 — table case 17 broke on a THIRD gesture. E1 (a
   * 4th potion) applied here; their Ctrl+Z inside the debounce left the server at the base. The GM then
   * pushed E2 on his held E1 and E3 on his held E2 (E3 replaced E2 before this device pulled, or their
   * refusal of E2 had not reached his read — gm-sync (13c)). The record named E1 only, so E3 took the
   * general rule (server unmoved, in step) and was APPLIED — E1's potion back over the undo. The record
   * now carries the publish E1 was applied over (`stamp`), which E3's base is too (gm-sync (10f)).
   * MUTATION (run 2026-10-09): drop `|| sameInstant(a.chain.stamp, b.stamp)` from the chain clause in
   * gmSync.gmEditVerdict — and both variants fail —
   *   AssertionError: their Ctrl+Z of his E1 is never overwritten by a push built on it (case 17): expected '4' to be '3'
   * MUTATION (run 2026-10-09): App's after-commit effect writes the record without `stamp` — and both
   * variants fail the same way.
   */
  for (const variant of ['E3 replaced E2 before this device pulled', 'this device refused E2; the receipt had not reached his read'] as const) {
    it(`(31b) their Ctrl+Z of his applied E1 (inside the debounce) is kept against a THIRD gesture — ${variant}`, async () => {
      const id = variant.startsWith('E3') ? 'k31a' : 'k31b';
      const key = `${CAMP}|${id}`;
      const app = await openInventory([saved(id, 'Player Version')]);
      const P = gm.own.get(key)!.sheet as SavedChar;
      const base = { stamp: gm.own.get(key)!.updatedAt, hash: H(P) };
      const potion = P.play!.inventory!.find((i) => i.itemId === 'healing-potion-minor')!;
      const withE1 = { ...P, play: bumpItemQuantity(P.play!, potion.instanceId, 1) } as SavedChar; // his 4th potion
      const e1 = push(id, withE1, { base });
      gm.edits = [e1];
      await pull();
      expect(app.qty(), 'fixture: E1 (a 4th potion) landed here').toBe('4');
      await app.undo(); // inside the 400 ms debounce: nothing of the undo is published
      expect(app.qty(), 'fixture: their Ctrl+Z took it back').toBe('3');
      expect(gm.own.get(key)!.updatedAt, 'fixture: the server is still at the base').toBe(base.stamp);
      const e2 = push(id, { ...withE1, build: { ...withE1.build!, name: 'GM Second Version' } } as SavedChar, { base, on: e1.updatedAt });
      if (variant.startsWith('this device')) {
        gm.edits = [e2];
        await pull();
        expect(app.qty(), 'fixture: E2 is refused here (case 17)').toBe('3');
        expect(receipted(e2), 'fixture: the receipt for E2 was sent').toBe(true);
      }
      const e3 = push(id, { ...withE1, build: { ...withE1.build!, name: 'GM Third Version' } } as SavedChar, { base, on: e2.updatedAt });
      gm.edits = [e3];
      await pull();
      expect(app.qty(), 'their Ctrl+Z of his E1 is never overwritten by a push built on it (case 17)').toBe('3');
      expect(app.shows('GM Third Version')).toBe(false);
      expect(receipted(e3), 'and the GM is told "not applied"').toBe(true);
    }, APP_TIMEOUT);
  }

  it('(32) a row an OLDER GM app wrote (no gm_base) is refused, with a receipt — never applied', async () => {
    /*
     * MUTATION (run 2026-10-09): judge an unbound row by content alone (`if (!b) return a.own.sheet &&
     * authoredKey(a.local) === authoredKey(a.own.sheet) ? 'apply' : 'refuse';`) — and this fails —
     *   AssertionError: and the GM is told: expected false to be true
     * (no receipt is written; the apply itself then stops at App's `boundGmBase(e)!`, which is why the
     * sheet does not land under this mutation — the verdict's refusal is what this leg pins.)
     */
    const app = await openInventory([saved('l32', 'Player Version')]);
    const row = { ...push('l32', saved('l32', 'GM Version')), gmBase: undefined };
    gm.edits = [row];
    await pull();
    expect(app.shows('GM Version'), 'an unproved row never lands').toBe(false);
    expect(receipted(row), 'and the GM is told').toBe(true);
  }, APP_TIMEOUT);

  it('(33) a stale survivor (gm_base.at is not the row’s own stamp) is refused', async () => {
    /*
     * MUTATION (run 2026-10-09): skip the binding term in gmSync.boundGmBase — and this fails —
     *   AssertionError: a borrowed proof never lands: expected true to be false
     */
    const app = await openInventory([saved('m33', 'Player Version')]);
    const fresh = push('m33', saved('m33', 'Player Version'));
    const row = { ...fresh, sheet: saved('m33', 'GM Version'), updatedAt: '2026-10-09T09:59:00.000Z' }; // an old app's upsert over it
    gm.edits = [row];
    await pull();
    expect(app.shows('GM Version'), 'a borrowed proof never lands').toBe(false);
    expect(receipted(row)).toBe(true);
  }, APP_TIMEOUT);

  it('(34) launch: the stored roster carries a stale derived cache, the launch republish moves the stamp — his edit still lands, by content', async () => {
    /*
     * A1 of the F1 notes (no trigger): a republish that changes nothing the player authored moves the
     * stamp but not the hash, and the verdict compares the hash.
     * MUTATION (run 2026-10-09): compare by stamp instead of the hash (`const atBase =
     * sameInstant(a.own.updatedAt, b.stamp);`) — and this fails —
     *   AssertionError: a launch republish is not a change of theirs: expected false to be true
     */
    const player = saved('n34', 'Player Version');
    const stale = { ...player, character: { ...player.character, staleDerivedCache: 1 } } as SavedChar;
    // What the previous session published: the stored entry, exactly as the app loads it.
    localStorage.setItem(ROSTER_KEY, JSON.stringify([stale]));
    const loaded = loadRoster()[0];
    localStorage.removeItem(ROSTER_KEY);
    gm.own.set(`${CAMP}|n34`, { sheet: { id: loaded.id, character: loaded.character, build: loaded.build, play: loaded.play }, updatedAt: '2026-10-09T08:00:00.000Z' });
    gm.edits = [push('n34', saved('n34', 'GM Version'))];
    const g = gate();
    gm.ownGate = g.promise; // the own-row read answers after the launch republish
    const app = await openInventory([stale]);
    expect(gm.publishes.some((p) => p.charId === 'n34'), 'fixture: the launch republished the rebuilt sheet').toBe(true);
    expect(gm.own.get(`${CAMP}|n34`)!.updatedAt, 'fixture: …which moved the stamp').not.toBe('2026-10-09T08:00:00.000Z');
    gm.ownGate = null;
    await act(async () => {
      g.open();
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(app.shows('GM Version'), 'a launch republish is not a change of theirs').toBe(true);
  }, APP_TIMEOUT);

  it('(34b) launch after an update whose LOAD migrates play — his between-session edit still lands (case 21: a load is not an edit)', async () => {
    /*
     * F1 (2026-10-09): refuter probe zz-f1-probe-rulings-2. The previous version published play carrying
     * a field this version's load drops (normalizePlay → `bankedParts`; any later play migration acts the
     * same). His edit carries the hash of THAT sheet. The pull waited (the loaded entry differs from the
     * server), the launch republish of the loaded entry changed the hash, and his whole edit was REFUSED.
     * loadRoster now records what it made of each entry it changed (storage.loadedAuthoredAs), and the
     * verdict counts that as the base (gm-sync (10g)).
     * MUTATION (run 2026-10-09): drop `|| (!!a.loaded && a.loaded(b.hash) === S)` from `atBase` in
     * gmSync.gmEditVerdict — and this fails —
     *   AssertionError: case 21: a launch is not a change of theirs — no "not applied": expected [ { campaignId: 'camp', …(2) } ] to deeply equal []
     */
    const player = saved('n34b', 'Player Version');
    const stored = { ...player, play: { ...player.play!, bankedParts: [{ id: 'legacy', qty: 1 }] } } as unknown as SavedChar;
    const publishedBefore = { id: stored.id, character: stored.character, build: stored.build, play: stored.play };
    gm.own.set(`${CAMP}|n34b`, { sheet: publishedBefore, updatedAt: '2026-10-09T08:00:00.000Z' });
    const gmChar = saved('n34b', 'GM Version'); // his edit: a renamed character, on their legacy play
    gm.edits = [push('n34b', { id: 'n34b', character: gmChar.character, build: gmChar.build, play: stored.play } as SavedChar)];
    const g = gate();
    gm.ownGate = g.promise; // the own-row read answers after the launch republish
    const app = await openInventory([stored]);
    expect(gm.publishes.some((p) => p.charId === 'n34b'), 'fixture: the launch republished').toBe(true);
    expect(H(gm.own.get(`${CAMP}|n34b`)!.sheet), 'fixture: …the loaded entry, which is no longer the sheet he built on').not.toBe(H(publishedBefore));
    gm.ownGate = null;
    await act(async () => {
      g.open();
      await new Promise((r) => setTimeout(r, 100));
    });
    await pull();
    expect(gm.receipts, 'case 21: a launch is not a change of theirs — no "not applied"').toEqual([]);
    expect(app.shows('GM Version'), 'case 21: his between-session edit lands').toBe(true);
  }, APP_TIMEOUT);

  /*
   * F1 (2026-10-09): refuter probe zz-f1-probe-timing-2, T3 — KNOWN AND KEPT (README Known gaps; the
   * builder's stamp term for chained pushes). Two between-session Updates, the second built on his held
   * first (`on` set, one row: #2 replaced #1). A device with no record of #1 applies a chained push only
   * at the very publish it was built on — it cannot tell "their launch republished the same content"
   * from "their other device applied #1 and they took it back" (gm-sync (10d), a PLAYER loss). So:
   * when the launch republish lands before this device reads its own row, #2 is REFUSED, visibly — the
   * GM's loss, never the player's. When the read comes first, it lands. This leg pins both orders, so
   * a change to either is a decision, not an accident.
   * MUTATION (run 2026-10-09): drop the stamp term for chained pushes (`const atBase = hS === b.hash ||
   * …` — A1 as first written) — and the "republish first" variant fails (with gm-sync (10d)) —
   *   AssertionError: known gap: refused visibly when the launch republish lands first: expected false to be true
   */
  for (const order of ['own read first', 'launch republish first'] as const) {
    it(`(34c) two between-session Updates (the second built on the first) — ${order}`, async () => {
      const id = order === 'own read first' ? 'n34c' : 'n34d';
      const player = saved(id, 'Player Version');
      localStorage.setItem(ROSTER_KEY, JSON.stringify([player]));
      const loaded = loadRoster()[0];
      localStorage.removeItem(ROSTER_KEY);
      const S0 = '2026-10-09T08:00:00.000Z';
      gm.own.set(`${CAMP}|${id}`, { sheet: { id: loaded.id, character: loaded.character, build: loaded.build, play: loaded.play }, updatedAt: S0 });
      const base = { stamp: S0, hash: H(gm.own.get(`${CAMP}|${id}`)!.sheet) };
      const e1 = push(id, saved(id, 'GM Version'), { base });
      const e2 = push(id, saved(id, 'GM Second Version'), { base, on: e1.updatedAt });
      gm.edits = [e2]; // one row per character: #2 replaced #1 on the server
      const g = gate();
      if (order === 'launch republish first') gm.ownGate = g.promise;
      else gm.publishGate = g.promise; // the launch republish is held until the pull has judged
      const app = await openInventory([player]);
      gm.ownGate = null;
      gm.publishGate = null;
      await act(async () => {
        g.open();
        await new Promise((r) => setTimeout(r, 100));
      });
      await wait(600);
      if (order === 'own read first') {
        expect(app.shows('GM Second Version'), 'read at the very publish: both his Updates land').toBe(true);
        expect(receipted(e2)).toBe(false);
      } else {
        expect(receipted(e2), 'known gap: refused visibly when the launch republish lands first').toBe(true);
        expect(app.shows('GM Second Version'), '…never applied').toBe(false);
        expect(H(gm.own.get(`${CAMP}|${id}`)!.sheet), 'the player loses nothing').toBe(base.hash);
      }
    }, APP_TIMEOUT);
  }

  it('(35) settled: their other device already applied it — consumed quietly, no receipt, this roster untouched', async () => {
    /*
     * MUTATION (run 2026-10-09): drop the `settled` line from gmSync.gmEditVerdict — and this fails —
     *   AssertionError: no false "not applied": expected [ { campaignId: 'camp', …(2) } ] to deeply equal []
     */
    const app = await openInventory([saved('o35', 'Player Version')]);
    const gmSheet = saved('o35', 'GM Version');
    const row = push('o35', gmSheet);
    // Their other device applied it and republished; this device has not caught up.
    gm.own.set(`${CAMP}|o35`, { sheet: { id: 'o35', character: gmSheet.character, build: gmSheet.build, play: gmSheet.play }, updatedAt: '2026-10-09T13:00:00.000Z' });
    gm.edits = [row];
    await pull();
    expect(deleted(row), 'consumed').toBe(true);
    expect(gm.receipts, 'no false "not applied"').toEqual([]);
    expect(app.shows('Player Version'), 'this roster is untouched — cloud sync brings it level').toBe(true);
  }, APP_TIMEOUT);

  /*
   * F1 (2026-10-09): a STALE chain record applied a push built on an older sheet over the player's newer
   * change (refuter probe zz-f1-probe-timing-1). The record was keyed on the base HASH, and a hash
   * repeats: e1 (a 4th potion) applied here and republished; the player took it back (Ctrl+Z after the
   * republish) so the 3-potion sheet H0 was published again; the GM pushed e2 on it and e3 on his held
   * e2 (e3 replaced e2); the player picked up a potion again — R1's content exactly. The old record
   * {base: H0, result: R1} then APPLIED e3 over that potion. The record now names its push (`at`), and
   * only a push whose `on` is that push may use it; e3's `on` is e2, never applied here.
   * MUTATION (run 2026-10-09): drop the `sameInstant(a.chain.at, b.on)` term from the chain clause in
   * gmSync.gmEditVerdict — and both variants fail —
   *   AssertionError: a push built on their older sheet never lands: expected true to be false
   */
  for (const when of ['published', 'in the debounce'] as const) {
    it(`(36) a chain record from an OLD apply never lands a push built on their older sheet — their 4th potion ${when}`, async () => {
      const id = when === 'published' ? 'p36a' : 'p36b';
      const player = saved(id, 'Player Version');
      const app = await openInventory([player]);
      const key = `${CAMP}|${id}`;
      const h0 = H(gm.own.get(key)!.sheet);
      const potion = player.play!.inventory!.find((i) => i.itemId === 'healing-potion-minor')!;
      const e1 = push(id, { ...player, play: bumpItemQuantity(player.play!, potion.instanceId, 1) });
      gm.edits = [e1];
      await pull();
      expect(app.qty(), 'fixture: his potion landed').toBe('4');
      await wait(600);
      const r1 = H(gm.own.get(key)!.sheet);
      expect(r1, 'fixture: the republish holds 4 potions').not.toBe(h0);
      await app.undo(); // well after the republish (case 18)
      expect(app.qty(), 'fixture: undone').toBe('3');
      await wait(600);
      expect(H(gm.own.get(key)!.sheet), 'fixture: their 3-potion sheet is published again (H0)').toBe(h0);
      const e2 = push(id, saved(id, 'GM Second Version'));
      const e3 = push(id, saved(id, 'GM Third Version'), { on: e2.updatedAt }); // replaced e2 before any fetch
      expect(e3.gmBase && e3.gmBase !== 'future' && e3.gmBase.hash, 'fixture: e3 is built on H0').toBe(h0);
      app.plusOnce(); // a 4th potion again — R1's content exactly
      expect(app.qty()).toBe('4');
      if (when === 'published') {
        await wait(600);
        expect(H(gm.own.get(key)!.sheet), 'fixture: their 4-potion sheet is published and equals R1').toBe(r1);
      }
      gm.edits = [e3];
      await pull();
      expect(app.shows('GM Third Version'), 'a push built on their older sheet never lands').toBe(false);
      expect(app.qty(), 'their fourth potion is never taken back').toBe('4');
      await wait(600);
      expect(receipted(e3), 'the GM is told it was not applied').toBe(true);
    }, APP_TIMEOUT);
  }

  /*
   * F1 (2026-10-09): the same stale record over an UNPUBLISHED change (refuter probe
   * zz-f1-probe-rulings-2): e0 applied here and republished, then undone and published (the server holds
   * P again); their next publish FAILS while they pick up a potion (e0's result, by content); the GM's
   * e2 (`on` = a push of his this device never saw) arrives. Table case 5 says WAIT; the old record said
   * APPLY and the GM's sheet replaced their unpublished potion.
   * MUTATION (run 2026-10-09): drop the `sameInstant(a.chain.at, b.on)` term from the chain clause — and
   * this fails —
   *   AssertionError: a push built on a sheet they have changed since never lands (table case 5: WAIT): expected true to be false
   */
  it('(37) a stale chain record never applies a push over their UNPUBLISHED change', async () => {
    const app = await openInventory([saved('q37', 'Player Version')]);
    const P = gm.own.get(`${CAMP}|q37`)!.sheet as SavedChar; // what the launch published: 3 potions
    const H0 = H(P);
    const potion = P.play!.inventory!.find((i) => i.itemId === 'healing-potion-minor')!;
    gm.edits = [push('q37', { ...P, play: bumpItemQuantity(P.play!, potion.instanceId, 1) })];
    await pull();
    expect(app.qty(), 'fixture: e0 landed here').toBe('4');
    gm.edits = [];
    await wait(600); // republished
    await app.undo();
    await wait(600);
    expect(app.qty(), 'fixture: back to three').toBe('3');
    const server = gm.own.get(`${CAMP}|q37`)!;
    expect(H(server.sheet), 'fixture: the published sheet is P again (A-B-A)').toBe(H0);
    const chain = JSON.parse(localStorage.getItem('wanderers-codex:gm-edits-chain:v1') ?? '{}')[`${CAMP}|q37`];
    expect(chain?.base, 'fixture: the record e0 left behind is still stored').toBe(H0);
    gm.publishFail = true;
    app.plusOnce();
    await wait(600);
    expect(app.qty(), 'fixture: their own fourth potion').toBe('4');
    expect(H(JSON.parse(localStorage.getItem(ROSTER_KEY)!)[0]), 'fixture: their own change has the old e0 result’s content').toBe(chain.result);
    const e2 = push('q37', saved('q37', 'GM Second Version'), { base: { stamp: server.updatedAt, hash: H0 }, on: '2026-10-09T09:40:00.000Z' });
    gm.edits = [e2];
    await pull();
    expect(app.shows('GM Second Version'), 'a push built on a sheet they have changed since never lands (table case 5: WAIT)').toBe(false);
    expect(app.qty(), 'their own fourth potion stays').toBe('4');
    expect(deleted(e2) || receipted(e2), 'waiting: nothing consumed while their work is not on the server').toBe(false);
  }, APP_TIMEOUT);

  /*
   * F1 (2026-10-09): a device holding an out-of-date copy, if it was the last to publish, applied a GM push
   * built on that old copy, and the cloud merge then dropped the player's newer work from their other
   * device (round-3 refuter probe, timing lens). Their laptop (this App) last pulled before they picked
   * up a potion on their phone; the phone published 4 potions and pushed them to the cloud. The laptop's
   * launch publish failed; its `online` retry re-sent the laptop's 3 potions over the phone's publish
   * (cloudSync's own `online` handler only pushes; nothing pulled). The GM's push, read fresh, was built
   * on that. The laptop is level with the server, so the verdict APPLIED it; the apply is a roster edit,
   * stamped newest, and the per-character merge carried the GM's 3-potion sheet over the phone's 4. The
   * phone itself only ever WAITS. Design D7 ("the own-row read already makes a stale device WAIT or
   * REFUSE") does not hold when the stale device published last — so the app pulls its cloud copy before
   * an apply (cloudSync.pullForGmApply), modelled here by `gm.cloud` as the real one runs (merge, adopt).
   * MUTATION (run 2026-10-09): drop `const level = pullForGmApply(); if (level && !(await level)) return;`
   * from App's GM-edit pass — and this fails —
   *   AssertionError: never applied on the device that was behind its own cloud copy: expected true to be false
   */
  it('(38) a device BEHIND its own cloud copy that published last never applies a push built on its stale sheet', async () => {
    const id = 's38';
    const key = `${CAMP}|${id}`;
    const laptop = saved(id, 'Player Version'); // 3 potions — what this device last pulled
    const p = laptop.play!.inventory!.find((i) => i.itemId === 'healing-potion-minor')!;
    const phone = { ...laptop, play: bumpItemQuantity(laptop.play!, p.instanceId, 1) } as SavedChar; // 4 potions
    const potions = (sc: SavedChar) => sc.play!.inventory!.find((i) => i.itemId === 'healing-potion-minor')!.quantity;
    // Their PHONE published the 4th potion (after the laptop's last pull) and pushed it to the cloud.
    gm.own.set(key, { sheet: { id, character: phone.character, build: phone.build, play: phone.play }, updatedAt: '2026-10-09T11:00:00.000Z' });
    gm.publishFail = true; // the laptop's launch publish fails (a blip)
    const app = await openInventory([laptop]);
    expect(gm.publishes.filter((x) => x.charId === id), 'fixture: the laptop’s launch publish failed').toHaveLength(0);
    noteDerivedRefresh(loadRoster()); // the edit-detection baseline the laptop's last pull left (cloudSync)
    gm.publishFail = false;
    await act(async () => {
      window.dispatchEvent(new Event('online')); // the network is back: the publish retry …
      await new Promise((r) => setTimeout(r, 100));
    });
    await wait(600);
    expect(potions(gm.own.get(key)!.sheet as SavedChar), 'fixture: …put the laptop’s stale 3 potions over the phone’s publish').toBe(3);
    const read = gm.own.get(key)!;
    const row = push(id, saved(id, 'GM Version')); // built on that fresh read (gmBaseOf)
    expect(
      gmEditVerdict({ row: row as never, own: { sheet: read.sheet as SavedChar, updatedAt: read.updatedAt }, local: phone }),
      'fixture: their phone, judging the same row, only waits',
    ).toBe('wait');
    // The account's cloud copy holds the phone's newer work; the pull before an apply merges and adopts it.
    const cloud = { ...readCloudBundle(), roster: [phone], charUpdated: { [id]: Date.now() - 30_000 } };
    gm.cloud = async () => {
      const merged = mergeBundles(readCloudBundle(), cloud);
      writeCloudBundle(merged);
      gm.adopt!(merged.roster);
      return true;
    };
    gm.edits = [row];
    await pull();
    await wait(100);
    expect(app.shows('GM Version'), 'never applied on the device that was behind its own cloud copy').toBe(false);
    expect(app.qty(), 'their phone’s fourth potion is on this device now').toBe('4');
    await wait(600); // the adopted sheet publishes; the stamp moved → refused
    expect(receipted(row), 'the GM is told "not applied"').toBe(true);
    expect(deleted(row), 'consumed').toBe(true);
    noteRosterChange(loadRoster()); // the persist hook cloud sync attaches after its first pull
    const mergedChar = mergeBundles(readCloudBundle(), cloud).roster.find((c) => c.id === id)!;
    expect(potions(mergedChar), 'their phone’s fourth potion survives the GM edit and cloud sync').toBe(4);
  }, APP_TIMEOUT);

  /*
   * F1 (2026-10-09): an APPLY was consumed even when the committed roster did not hold it (round-3
   * refuter probe, timing lens). A GM row arrives, the verdict is APPLY and the pass queues its updater;
   * in the same task cloud sync's adopt() runs (another device changed a DIFFERENT character): it reads
   * storage — the last committed roster, without the GM's sheet — and App sets that roster by VALUE. React
   * renders both: the updater records the apply, the adopt's value replaces the roster, and the after-commit
   * effect consumed the row anyway (handled stamp, conditioned delete). Nothing published it and no receipt
   * was written: the GM's overlay just stood down. An apply is consumed now only when the COMMITTED entry
   * is its result; otherwise the row is judged again at once.
   * MUTATION (run 2026-10-09): consume every recorded apply (`const landed = [...done.values()];`) in App's
   * after-commit effect — and this fails —
   *   AssertionError: a GM edit this app consumed is on the sheet, or the GM is told — never consumed into nothing: expected { consumed: true, landed: false, …(1) } to not deeply equal { consumed: true, landed: false, …(1) }
   */
  it('(39) a cloud adopt landing between the apply and the render never consumes the edit into nothing', async () => {
    const app = await openInventory([saved('c39', 'Player Version'), saved('d39', 'Other Character', [])]);
    expect(gm.own.has(`${CAMP}|c39`), 'fixture: the launch published c39').toBe(true);
    expect(typeof gm.adopt, 'fixture: App registered its cloud adopt').toBe('function');
    const row = push('c39', saved('c39', 'GM Version'));
    // The network answer arrives in the microtask right after the pass queued its updater, before React
    // renders. (The hook is the pull before an apply: it resolves `true`, and the adopt is queued so that
    // it runs straight after the pass's continuation — which queues the updater synchronously.) What adopt
    // hands App, as cloudSync.adopt makes it: flushPersist(), then its merge of STORAGE — the last
    // committed roster, without the GM edit — with the cloud, which brought their phone's edit to the
    // OTHER character.
    let adopted = false;
    gm.cloud = () => {
      const level = Promise.resolve(true);
      void level.then(() =>
        queueMicrotask(() => {
          if (adopted) return;
          adopted = true;
          flushPersist();
          const stored = JSON.parse(localStorage.getItem(ROSTER_KEY)!) as SavedChar[];
          expect(stored.find((s) => s.id === 'c39')!.character.name, 'fixture: the adopt reads a roster without the GM edit').toBe('Player Version');
          gm.adopt!(
            stored.map((s) =>
              s.id === 'd39' ? { ...s, build: { ...s.build!, name: 'Other Character Phone' }, character: { ...s.character, name: 'Other Character Phone' } } : s,
            ),
          );
        }),
      );
      return level;
    };
    gm.edits = [row];
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(adopted, 'fixture: the adopt landed between the updater and the render').toBe(true);
    const consumed = deleted(row);
    const landed = app.shows('GM Version') || gm.publishes.some((x) => x.charId === 'c39' && (x.sheet as SavedChar).character.name === 'GM Version');
    expect(
      { consumed, landed, told: receipted(row) },
      'a GM edit this app consumed is on the sheet, or the GM is told — never consumed into nothing',
    ).not.toEqual({ consumed: true, landed: false, told: false });
    await pull();
    await wait(600);
    expect(app.shows('GM Version'), 'judged again, it lands').toBe(true);
    expect(deleted(row), '…and only then is it consumed').toBe(true);
  }, APP_TIMEOUT);

  /*
   * F1 (2026-10-09): the same consumption, the other window — an adopt reading storage after the commit but
   * before the roster's (passive, debounced) persist reached it. The apply is written to storage in the
   * very commit that holds it, before it is consumed, so any adopt from then on reads it.
   * MUTATION (run 2026-10-09): drop `persistNow(roster);` from App's after-commit effect — and this fails —
   *   AssertionError: on disk the moment it lands: expected false to be true
   */
  it('(39b) an applied GM edit is on disk the moment it commits', async () => {
    const app = await openInventory([saved('c39b', 'Player Version')]);
    gm.edits = [push('c39b', saved('c39b', 'GM Version'))];
    await pull();
    expect(app.shows('GM Version'), 'fixture: it landed').toBe(true);
    expect((localStorage.getItem(ROSTER_KEY) ?? '').includes('GM Version'), 'on disk the moment it lands').toBe(true);
  }, APP_TIMEOUT);

  /*
   * F1 (2026-10-09): the refusal receipt was fire-and-forget and sent after the row was consumed, so one
   * failed UPDATE meant the GM was never told (round-3 refuter probe, timing lens; P2b2 replay). The GM read
   * their sheet (3 potions) and holds E; they picked up a potion (4) and published it; E arrives and is
   * REFUSED; App consumed it (handled stamp + delete) and then `void markGmEditRefused(...)`, which swallowed
   * every error. The UPDATE failed once (a blip) and nothing ever retried: the row was handled and gone. On
   * the GM's side his overlay stood down at their publish (`>`), `gm_refused_at` never came, and no screen
   * said "not applied". The receipt now goes first, and the row is consumed only once it landed.
   * MUTATION (run 2026-10-09): restore the old order in App's pass — `void markGmEditRefused(e.campaignId,
   * e.charId, e.updatedAt);` (not awaited, not checked) and then `consumeGmEdit(e);` — and this fails —
   *   AssertionError: not consumed while the GM has not been told: expected true to be false // Object.is equality
   */
  it('(40) a refusal receipt that fails once is sent again — the GM is told "not applied"', async () => {
    const id = 'r40';
    const key = `${CAMP}|${id}`;
    try {
      const app = await openInventory([saved(id, 'Player Version')]);
      const read = gm.own.get(key)!; // the GM reads their 3-potion sheet
      const gmSheet = saved(id, 'GM Version');
      const row = push(id, gmSheet);
      // The GM's app holds his push (what pushGmEdit records on success).
      setGmPendingAccount('gm-1');
      rememberGmEdit(CAMP, id, gmSheet, row.updatedAt, read.updatedAt, 'player-1', H(read.sheet));
      app.plusOnce(); // they pick up a potion (4) …
      await wait(600); // … and their app publishes it
      expect(gm.publishes.filter((x) => x.charId === id), 'fixture: their 4th potion published').toHaveLength(2);
      gm.failReceipts = 1; // the blip
      gm.edits = [row];
      await pull();
      await wait(100);
      expect(gm.receiptAttempts, 'fixture: one receipt attempt, which failed').toBe(1);
      expect(deleted(row), 'not consumed while the GM has not been told').toBe(false);
      await pull(); // a later focus
      await wait(100);
      expect(receipted(row), 'the next event sends it again').toBe(true);
      expect(deleted(row), '…and only then is the row consumed').toBe(true);
      // The GM's app reads their row (party list / tracker): their publish moved past his base.
      const theirs = gm.own.get(key)!;
      resolvePendingGmEdit(CAMP, id, { sheet: theirs.sheet as SavedChar, updatedAt: theirs.updatedAt, ownerId: 'player-1', gmRefusedAt: row.updatedAt });
      expect(
        { gmTold: gmEditRefused(CAMP, id), stillShownWaiting: !!gmPendingEdit(CAMP, id) },
        'a refused GM edit is eventually receipted — he is told "not applied"',
      ).toEqual({ gmTold: true, stillShownWaiting: false });
      expect(app.qty(), 'their potion stays').toBe('4');
    } finally {
      clearGmPendingEdits();
    }
  }, APP_TIMEOUT);

  /*
   * F1 (2026-10-09): an applied GM edit was answered "not applied" when the player's tap composed on it in
   * the same render batch (round-4 refuter probes zz-f1-probe-rulings-1 and zz-f1-probe-timing-1, rulings
   * and timing lenses). The pass judged APPLY and queued its roster updater; before React rendered, the
   * player tapped "+" on a potion — a functional update queued after it. React rebased the tap on top of
   * the apply, the commit held apply + tap, the after-commit `landed` test (hash of the committed entry ===
   * the apply's result) failed, the row was judged again → WAIT → the sheet (his edit AND their potion)
   * published → REFUSED with a receipt: the GM told "not applied" while his edit was on their sheet, and he
   * may award it again (double XP, double damage).
   * F1 (2026-10-09, round 6): round 5 committed the apply synchronously (flushSync) — which skipped a pending
   * default-lane adopt and crashed the app (legs 43–45). The apply is queued in the ordinary batch again, and
   * the after-commit `landed` test recognises a composition. F1 (2026-10-09, round 7): by MARK — the apply
   * writes App's GM_APPLIED symbol on the entry it wrote and GM_JUDGED on the entry it was judged over, and
   * every App updater composes by object spread, which copies both (round 6 guessed it by identity of the
   * `character`/`build` objects, which a Customize click or a Ctrl+= zoom does not keep — legs 47, 48). Runs
   * under production lanes (the `window.event` override at the top of this file): there the tap's click
   * takes the SYNC lane and commits ALONE, ahead of the apply, whose updater React had already run eagerly
   * at dispatch — so a record whose committed entry carries the judged mark is kept for the commit that
   * holds the apply.
   * MUTATION (run 2026-10-09, round 7): drop the GM_APPLIED clause from App's `landed` test
   * (`c[GM_APPLIED] === a.mark ||`, leaving identity and the hash) — the tap composes on the apply and a
   * receipt is written — and this fails —
   *   AssertionError: a GM edit that IS on their sheet is consumed as applied — never answered "not applied": expected { publishedName: 'GM Version', …(2) } to deeply equal { publishedName: 'GM Version', …(2) }
   *   (- "toldNotApplied": false, + "toldNotApplied": true)
   * MUTATION (run 2026-10-09, round 7): drop the GM_JUDGED clause from the "not rendered yet" test
   * (`|| c[GM_JUDGED] === a.mark` → a record over J + tap is dropped and re-judged) — and this fails —
   *   AssertionError: a GM edit that IS on their sheet is consumed as applied — never answered "not applied": expected { publishedName: 'GM Version', …(2) } to deeply equal { publishedName: 'GM Version', …(2) }
   *   (- "toldNotApplied": false, + "toldNotApplied": true)
   */
  it('(41) a player tap right after the apply, in the same render batch, composes on his edit — and he is never told "not applied"', async () => {
    const id = 't41';
    const key = `${CAMP}|${id}`;
    const app = await openInventory([saved(id, 'Player Version')]);
    expect(gm.own.has(key), 'fixture: the launch published').toBe(true);
    // The GM's sheet is built on THEIR published sheet (the same item instance ids), renamed.
    const theirs = JSON.parse(JSON.stringify(gm.own.get(key)!.sheet)) as SavedChar;
    const gmSheet = { ...theirs, build: { ...theirs.build!, name: 'GM Version' }, character: { ...theirs.character, name: 'GM Version' } } as SavedChar;
    const row = push(id, gmSheet);
    const plus = () =>
      [...app.host.querySelectorAll<HTMLElement>('.inv-card')]
        .find((e) => (e.textContent ?? '').includes('Potion'))
        ?.querySelector<HTMLButtonElement>('button[aria-label="Increase quantity"]');
    expect(plus(), 'fixture: the potion card is open').toBeTruthy();
    // The pull before an apply answers "level"; the player taps "+" in the next task — after the pass has
    // made its roster update (every read here answers in microtasks) and before the act scope lets React
    // render anything that was merely queued.
    let tapped = false;
    gm.cloud = () => {
      setTimeout(() => {
        if (tapped) return;
        tapped = true;
        plus()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }, 0);
      return Promise.resolve(true);
    };
    gm.edits = [row];
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await new Promise((r) => setTimeout(r, 30));
    });
    gm.cloud = null;
    await wait(50);
    expect(tapped, 'fixture: the tap landed inside the window').toBe(true);
    expect({ gmEdit: app.shows('GM Version'), qty: app.qty() }, 'his edit is on their sheet, and their tap composed on it').toEqual({ gmEdit: true, qty: '4' });
    await wait(700); // their sheet publishes; any row still waiting is judged again
    await pull();
    await wait(700);
    const published = gm.own.get(key)!.sheet as SavedChar;
    expect(
      { publishedName: published.build?.name, consumed: deleted(row), toldNotApplied: receipted(row) },
      'a GM edit that IS on their sheet is consumed as applied — never answered "not applied"',
    ).toEqual({ publishedName: 'GM Version', consumed: true, toldNotApplied: false });
    expect(app.qty(), 'their tap stays').toBe('4');
  }, APP_TIMEOUT);

  /*
   * F1 (2026-10-09, round 5): the pass awaits the cloud pull before an apply and the refusal receipt, and
   * supabase-js has no fetch timeout — one hung request left the serialised pass `running` for the whole
   * session, so no later focus / visibility / online / Realtime event ever judged a GM edit again. Each of
   * those awaits is bounded (App's GM_PASS_AWAIT_MS, 20 s): on the bound it counts as "not true" (the apply
   * waits; a refused row stays unconsumed) and the pass ends. The bound never writes the roster.
   * MUTATION (run 2026-10-09): `if (level && !(await level)) return;` (no bound) in App's pass — and this
   * fails —
   *   AssertionError: the held pass ended at the bound — a later focus runs a pass: expected 2 to be greater than 2
   */
  it('(42) a cloud pull that never answers holds the pass for 20 s at most — then a later focus judges the edit again', async () => {
    const id = 'h42';
    const app = await openInventory([saved(id, 'Player Version')]);
    const row = push(id, saved(id, 'GM Version'));
    let pulls = 0;
    gm.cloud = () => {
      pulls++;
      return new Promise<boolean>(() => undefined); // hung: never answers
    };
    gm.edits = [row];
    await pull();
    expect(pulls, 'fixture: the pass reached the pull before an apply').toBe(1);
    expect(app.shows('GM Version'), 'nothing applied while the pull hangs').toBe(false);
    await wait(20_500); // the bound
    expect(app.shows('GM Version'), 'the bound never applies anything').toBe(false);
    expect(deleted(row) || receipted(row), 'the bound never consumes the row').toBe(false);
    const fetchesBefore = gm.fetches;
    gm.cloud = null; // the network answers again
    await pull();
    await wait(100);
    expect(gm.fetches, 'the held pass ended at the bound — a later focus runs a pass').toBeGreaterThan(fetchesBefore);
    expect(app.shows('GM Version'), 'a later focus judges the edit, and it lands').toBe(true);
    expect(deleted(row), '…consumed as applied').toBe(true);
  }, APP_TIMEOUT);

  /*
   * F1 (2026-10-09, round 6): the same bound on the pass's two other awaits — the rows (`fetchGmEdits`) and
   * the fresh reads of our own published rows (`fetchPublishedSheet`). One hung read left the serialised
   * pass `running` for the session. On the bound the pass ends with nothing judged, consumed or written.
   * MUTATION (run 2026-10-09): `const edits = await fetchGmEdits();` (no bound) in App's pass — and this
   * fails —
   *   AssertionError: the held rows read ended at the bound — a later focus runs a pass: expected 0 to be greater than 0
   * MUTATION (run 2026-10-09): `const owns = await Promise.all(fresh.map(… fetchPublishedSheet …));` (no
   * bound) — and this fails —
   *   AssertionError: the held read ended at the bound — a later focus judges the edit, and it lands: expected false to be true // Object.is equality
   */
  it('(42b) a hung read of the rows, or of their own published row, holds the pass for 20 s at most', async () => {
    const id = 'h42b';
    const app = await openInventory([saved(id, 'Player Version')]);
    const row = push(id, saved(id, 'GM Version'));
    gm.edits = [row];
    const hung = new Promise<void>(() => undefined);
    gm.gate = hung; // the rows never come back
    await pull();
    await wait(20_500);
    expect({ shown: app.shows('GM Version'), consumed: deleted(row), told: receipted(row) }, 'a hung rows read writes nothing').toEqual({
      shown: false,
      consumed: false,
      told: false,
    });
    gm.gate = null;
    gm.ownGate = hung; // the rows answer; their own row's read never does
    const readsBefore = gm.ownReads;
    await pull();
    expect(gm.ownReads, 'the held rows read ended at the bound — a later focus runs a pass').toBeGreaterThan(readsBefore);
    await wait(20_500);
    expect({ shown: app.shows('GM Version'), consumed: deleted(row), told: receipted(row) }, 'a hung own-row read writes nothing').toEqual({
      shown: false,
      consumed: false,
      told: false,
    });
    gm.ownGate = null;
    await pull();
    await wait(100);
    expect(app.shows('GM Version'), 'the held read ended at the bound — a later focus judges the edit, and it lands').toBe(true);
    expect(deleted(row), '…consumed as applied').toBe(true);
  }, APP_TIMEOUT);

  /** Every error a leg sees — logged (console.error) or thrown out of React to the window ('error') —
   *  for React's "Maximum update depth exceeded". The app being gone (`up`) is the other half. */
  const captureErrors = () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void errors.push(String(a[0]).slice(0, 160)));
    window.addEventListener('error', (ev) => void errors.push(String((ev as ErrorEvent).message ?? (ev as ErrorEvent).error).slice(0, 160)));
    return { maxDepth: () => errors.filter((e) => e.includes('Maximum update depth')).length };
  };
  /** Was `text` EVER on screen while this observer ran (not only at the end)? */
  const observe = (host: HTMLElement, text: string) => {
    const seen = { ever: false };
    const mo = new MutationObserver(() => {
      if ((host.textContent ?? '').includes(text)) seen.ever = true;
    });
    mo.observe(host, { subtree: true, childList: true, characterData: true });
    return { seen, stop: () => mo.disconnect() };
  };

  /*
   * F1 (2026-10-09, round 6): a cloud adopt of the SAME character, still pending on the default lane when
   * the apply was queued, was skipped by a synchronous (flushSync) apply — the apply committed over the
   * pre-adopt roster, the persist loop that followed ended in "Maximum update depth exceeded", and the
   * phone's change was lost (round-5 timing probe PROBE-A). Queued in the ordinary batch, the adopt renders
   * first; the updater's re-check sees the entry moved and the edit WAITS, then is refused once the adopted
   * sheet publishes.
   * MUTATION (run 2026-10-09): wrap the pass's `setRoster(updater)` in `flushSync(() => …)` (react-dom) —
   * the app dies ("Maximum update depth exceeded") and the edit is consumed — and this fails —
   *   AssertionError: the apply waits behind the adopt: the app stays up, their phone’s change is on screen, nothing consumed: expected { up: false, maxDepth: 1, …(3) } to deeply equal { up: true, maxDepth: +0, …(3) }
   *   (- consumed false, gm false, maxDepth 0, phone true, up true; + consumed true, maxDepth 1, phone false, up false)
   */
  it('(43) a same-character cloud adopt pending before the apply: the apply waits, the phone’s change stays, then refused with a receipt', async () => {
    const id = 'pa43';
    const app = await openInventory([saved(id, 'Player Version')]);
    const row = push(id, saved(id, 'GM Version'));
    const errs = captureErrors();
    const o = observe(app.host, 'GM Version');
    let adopted = false;
    gm.cloud = async () => {
      await new Promise((r) => setTimeout(r, 5)); // the pull's network answer: a fresh task, no current event
      if (!adopted) {
        adopted = true;
        // cloudSync.pull → adopt, as written: flush, read storage, hand App the merged roster (their phone renamed it).
        flushPersist();
        const stored = JSON.parse(localStorage.getItem(ROSTER_KEY)!) as SavedChar[];
        gm.adopt!(
          stored.map((s) => (s.id === id ? { ...s, build: { ...s.build!, name: 'Phone Version' }, character: { ...s.character, name: 'Phone Version' } } : s)),
        );
      }
      return true;
    };
    gm.edits = [row];
    await pull();
    await wait(100);
    expect(
      { up: app.host.childElementCount > 0, maxDepth: errs.maxDepth(), phone: app.shows('Phone Version'), gm: o.seen.ever, consumed: deleted(row) },
      'the apply waits behind the adopt: the app stays up, their phone’s change is on screen, nothing consumed',
    ).toEqual({ up: true, maxDepth: 0, phone: true, gm: false, consumed: false });
    gm.cloud = null;
    await wait(700); // the adopted sheet publishes; the waiting row is judged again
    await pull();
    await wait(700);
    o.stop();
    expect(
      {
        gm: o.seen.ever,
        phone: app.shows('Phone Version'),
        published: (gm.own.get(`${CAMP}|${id}`)!.sheet as SavedChar).build?.name,
        told: receipted(row),
        consumed: deleted(row),
        maxDepth: errs.maxDepth(),
      },
      'never applied over their phone’s change — refused, and the GM is told',
    ).toEqual({ gm: false, phone: true, published: 'Phone Version', told: true, consumed: true, maxDepth: 0 });
  }, APP_TIMEOUT);

  /*
   * F1 (2026-10-09, round 6): the same with another TAB — its storage event (a +1 potion) pending on the
   * default lane when the apply was queued (round-5 timing probe PROBE-B).
   * MUTATION (run 2026-10-09): wrap the pass's `setRoster(updater)` in `flushSync(() => …)` — the app dies
   * and the tab's potion is gone with it — and this fails —
   *   AssertionError: the apply waits behind the other tab: the app stays up, its potion is on screen, nothing consumed: expected { up: false, maxDepth: 1, …(3) } to deeply equal { up: true, maxDepth: +0, …(3) }
   *   (- consumed false, maxDepth 0, qty "4", up true; + consumed true, maxDepth 1, qty "the app is gone", up false)
   */
  it('(44) another tab’s storage event pending before the apply: the apply waits, the tab’s potion stays, then refused with a receipt', async () => {
    const id = 'pb44';
    const player = saved(id, 'Player Version');
    const potion = player.play!.inventory!.find((i) => i.itemId === 'healing-potion-minor')!;
    const fromOtherTab = [{ ...player, play: bumpItemQuantity(player.play!, potion.instanceId, 1) }];
    const app = await openInventory([player]);
    const row = push(id, saved(id, 'GM Version'));
    const errs = captureErrors();
    const o = observe(app.host, 'GM Version');
    const up = () => app.host.childElementCount > 0;
    const qty = () => (up() ? app.qty() : 'the app is gone');
    let fired = false;
    gm.cloud = async () => {
      if (!fired) {
        fired = true;
        localStorage.setItem(ROSTER_KEY, JSON.stringify(fromOtherTab));
        window.dispatchEvent(new StorageEvent('storage', { key: ROSTER_KEY, newValue: JSON.stringify(fromOtherTab) }));
      }
      return true;
    };
    gm.edits = [row];
    await pull();
    await wait(100);
    expect(
      { up: up(), maxDepth: errs.maxDepth(), qty: qty(), gm: o.seen.ever, consumed: deleted(row) },
      'the apply waits behind the other tab: the app stays up, its potion is on screen, nothing consumed',
    ).toEqual({ up: true, maxDepth: 0, qty: '4', gm: false, consumed: false });
    gm.cloud = null;
    await wait(700);
    await pull();
    await wait(700);
    o.stop();
    expect(
      { gm: o.seen.ever, qty: qty(), told: receipted(row), consumed: deleted(row), maxDepth: errs.maxDepth() },
      'never applied over the other tab’s potion — refused, and the GM is told',
    ).toEqual({ gm: false, qty: '4', told: true, consumed: true, maxDepth: 0 });
  }, APP_TIMEOUT);

  /*
   * F1 (2026-10-09, round 6): leg (38) with the pull's network answer arriving as a fresh task, as cloudSync
   * runs it — the adopt of their phone's 4th potion pending on the default lane when the apply was queued
   * (round-5 probes PROBE-D and PROBE-R5-A). Under a synchronous apply the app died ("Maximum update depth
   * exceeded"), the GM edit was persisted over the adopt and consumed with no receipt, and the phone's
   * potion lost the cloud merge.
   * MUTATION (run 2026-10-09): wrap the pass's `setRoster(updater)` in `flushSync(() => …)` — the app dies,
   * the GM's 3-potion sheet is on disk over the phone's 4 and the row is consumed — and this fails —
   *   AssertionError: the apply waits behind the adopt: no crash, their phone’s potion is on disk, nothing consumed: expected { up: false, maxDepth: 1, …(4) } to deeply equal { up: true, maxDepth: +0, …(4) }
   *   (- consumed false, maxDepth 0, storedName "Player Version", storedPotions 4, up true; + consumed true, maxDepth 1, storedName "GM Version", storedPotions 3, up false)
   */
  it('(45) a device behind its own cloud copy, the adopt arriving as a fresh task: the apply waits, no crash, refused with a receipt, the phone’s potion survives', async () => {
    const id = 'pd45';
    const key = `${CAMP}|${id}`;
    const laptop = saved(id, 'Player Version'); // 3 potions — what this device last pulled
    const p = laptop.play!.inventory!.find((i) => i.itemId === 'healing-potion-minor')!;
    const phone = { ...laptop, play: bumpItemQuantity(laptop.play!, p.instanceId, 1) } as SavedChar; // 4 potions
    const potions = (sc: SavedChar) => sc.play!.inventory!.find((i) => i.itemId === 'healing-potion-minor')!.quantity;
    gm.own.set(key, { sheet: { id, character: phone.character, build: phone.build, play: phone.play }, updatedAt: '2026-10-09T11:00:00.000Z' });
    gm.publishFail = true; // the laptop's launch publish fails (a blip)
    const app = await openInventory([laptop]);
    noteDerivedRefresh(loadRoster()); // the edit-detection baseline the laptop's last pull left (cloudSync)
    gm.publishFail = false;
    await act(async () => {
      window.dispatchEvent(new Event('online')); // the retry puts the laptop's stale 3 potions over the phone's publish
      await new Promise((r) => setTimeout(r, 100));
    });
    await wait(600);
    expect(potions(gm.own.get(key)!.sheet as SavedChar), 'fixture: the laptop’s stale 3 potions are published').toBe(3);
    const row = push(id, saved(id, 'GM Version'));
    const cloud = { ...readCloudBundle(), roster: [phone], charUpdated: { [id]: Date.now() - 30_000 } };
    gm.cloud = async () => {
      await new Promise((r) => setTimeout(r, 5)); // cloudSync.pull(): the network answer, a fresh task …
      const merged = mergeBundles(readCloudBundle(), cloud); // … then adopt(): writeCloudBundle + App's setRoster
      writeCloudBundle(merged);
      gm.adopt!(merged.roster);
      return true;
    };
    const errs = captureErrors();
    const o = observe(app.host, 'GM Version');
    gm.edits = [row];
    await pull();
    await wait(100);
    const stored = loadRoster().find((c) => c.id === id)!;
    expect(
      { up: (app.host.textContent ?? '').length > 0, maxDepth: errs.maxDepth(), gm: o.seen.ever, storedName: stored.build?.name, storedPotions: potions(stored), consumed: deleted(row) },
      'the apply waits behind the adopt: no crash, their phone’s potion is on disk, nothing consumed',
    ).toEqual({ up: true, maxDepth: 0, gm: false, storedName: 'Player Version', storedPotions: 4, consumed: false });
    gm.cloud = null;
    await wait(700); // the adopted sheet publishes; the stamp moved → refused
    o.stop();
    expect({ told: receipted(row), consumed: deleted(row), gm: o.seen.ever }, 'refused, and the GM is told "not applied"').toEqual({
      told: true,
      consumed: true,
      gm: false,
    });
    noteRosterChange(loadRoster()); // the persist hook cloud sync attaches after its first pull
    const mergedChar = mergeBundles(readCloudBundle(), cloud).roster.find((c) => c.id === id)!;
    expect(potions(mergedChar), 'their phone’s fourth potion survives the GM edit and cloud sync').toBe(4);
  }, APP_TIMEOUT);

  /*
   * F1 (2026-10-09, round 6): a refusal receipt slower than the pass's 20 s bound still LANDS — after the pass
   * gave up on it, so the row stayed. They then put the potion back (Ctrl+Z): the sheet is his base content
   * again, it republishes, and the next judgment APPLIED his edit while the GM's card said "not applied"
   * (round-5 timing probe PROBE-C). A row whose receipt the server already carries is now `told`: consumed,
   * never applied, no second receipt.
   * MUTATION (run 2026-10-09): drop the `told` line in gmSync.gmEditVerdict — and this fails —
   *   AssertionError: never "not applied" while his edit is on their sheet — the told row is consumed, never applied: expected { everOnTheirSheet: true, …(4) } to deeply equal { everOnTheirSheet: false, …(4) }
   *   (- "everOnTheirSheet": false, + "everOnTheirSheet": true)
   */
  it('(46) a receipt that lands after the 20 s bound, then their sheet comes back to his base — never applied under "not applied"', async () => {
    const id = 'pc46';
    const key = `${CAMP}|${id}`;
    try {
      const app = await openInventory([saved(id, 'Player Version')]);
      const read = gm.own.get(key)!; // the GM reads their 3-potion sheet
      const gmSheet = saved(id, 'GM Version');
      const row = push(id, gmSheet);
      setGmPendingAccount('gm-1');
      rememberGmEdit(CAMP, id, gmSheet, row.updatedAt, read.updatedAt, 'player-1', H(read.sheet));
      app.plusOnce(); // they pick up a potion (4) …
      await wait(600); // … and it publishes
      const o = observe(app.host, 'GM Version');
      gm.receiptDelay = 21_000; // the receipt UPDATE is slow — and lands
      gm.edits = [row];
      await pull();
      await wait(20_500); // the bound: "not landed", the row stays
      expect(deleted(row), 'fixture: the bound left the row').toBe(false);
      await wait(1_000); // the slow UPDATE lands: the GM's row now says "not applied"
      expect(receipted(row), 'fixture: the receipt landed on the server').toBe(true);
      await app.undo(); // they put the potion back (3) — the sheet he built on, again
      await wait(700); // it publishes
      expect(H(gm.own.get(key)!.sheet), 'fixture: the server is back at his base content').toBe(H(read.sheet));
      await pull(); // a later focus judges the row again
      await wait(700);
      o.stop();
      const theirs = gm.own.get(key)!;
      resolvePendingGmEdit(CAMP, id, { sheet: theirs.sheet as SavedChar, updatedAt: theirs.updatedAt, ownerId: 'player-1', gmRefusedAt: theirs.gmRefusedAt });
      expect(
        {
          everOnTheirSheet: o.seen.ever,
          gmToldNotApplied: gmEditRefused(CAMP, id),
          consumed: deleted(row),
          receipts: gm.receipts.filter((r) => r.charId === id).length,
          qty: app.qty(),
        },
        'never "not applied" while his edit is on their sheet — the told row is consumed, never applied',
      ).toEqual({ everOnTheirSheet: false, gmToldNotApplied: true, consumed: true, receipts: 1, qty: '3' });
    } finally {
      clearGmPendingEdits();
    }
  }, APP_TIMEOUT);

  /*
   * F1 (2026-10-09, round 7): leg 41's window with App's OTHER sheet updater (round-6 timing refuter, probe
   * PROBE-T1). A Customize click lands right after the apply, in the same render batch, under production
   * lanes. App's `updateCharacter` makes a NEW `character` object (and keeps `build`), so round 6's identity
   * test missed both ways: the click's sync-lane commit (judged entry + accent) was not "composed on the
   * judged entry" and the eagerly recorded apply was DROPPED; the default-lane commit then held his edit +
   * accent with no record left → judged again → WAIT → published → REFUSED with a receipt: the GM told "not
   * applied" while his edit was on their sheet. The marks (GM_JUDGED, then GM_APPLIED) ride the spread.
   * MUTATION (run 2026-10-09, round 7): drop the GM_APPLIED clause from App's `landed` test — and this fails —
   *   AssertionError: his edit IS on their sheet (with their accent) — consumed as applied, never answered "not applied": expected { clicked: true, midShown: true, …(5) } to deeply equal { clicked: true, midShown: true, …(5) }
   *   (- "toldNotApplied": false, + "toldNotApplied": true)
   * MUTATION (run 2026-10-09, round 7): drop the GM_JUDGED clause from the "not rendered yet" test — and this
   * fails, with the same assertion and the same diff.
   */
  it('(47) a Customize click right after the apply, in the same render batch, composes on his edit — never "not applied"', async () => {
    const id = 'c47';
    const key = `${CAMP}|${id}`;
    const app = await openInventory([saved(id, 'Player Version')]);
    expect(gm.own.has(key), 'fixture: the launch published').toBe(true);
    const theirs = JSON.parse(JSON.stringify(gm.own.get(key)!.sheet)) as SavedChar;
    const gmSheet = { ...theirs, build: { ...theirs.build!, name: 'GM Version' }, character: { ...theirs.character, name: 'GM Version' } } as SavedChar;
    const row = push(id, gmSheet);
    const custBtn = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === 'Customize');
    expect(custBtn(), 'fixture: the Customize button').toBeTruthy();
    act(() => {
      custBtn()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await wait(50);
    const swatch = () => document.querySelector<HTMLButtonElement>('button[aria-label^="accent "]:not(.active)');
    expect(swatch(), 'fixture: an accent swatch in the open drawer').toBeTruthy();
    const accent = swatch()!.getAttribute('aria-label')!.slice('accent '.length);
    // The pull before an apply answers "level"; the click lands in the next task — after the pass queued
    // its roster update, before React rendered it.
    let clicked = false;
    gm.cloud = () => {
      setTimeout(() => {
        if (clicked) return;
        clicked = true;
        swatch()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }, 0);
      return Promise.resolve(true);
    };
    gm.edits = [row];
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await new Promise((r) => setTimeout(r, 30));
    });
    gm.cloud = null;
    await wait(50);
    const mid = { clicked, midShown: app.shows('GM Version') };
    await wait(700); // their sheet publishes; any row still waiting is judged again
    await pull();
    await wait(700);
    const published = gm.own.get(key)!.sheet as SavedChar;
    expect(
      {
        ...mid,
        gmShown: app.shows('GM Version'),
        publishedName: published.build?.name,
        publishedAccent: (published.character as { customization?: { accentColor?: string } }).customization?.accentColor,
        consumed: deleted(row),
        toldNotApplied: receipted(row),
      },
      'his edit IS on their sheet (with their accent) — consumed as applied, never answered "not applied"',
    ).toEqual({ clicked: true, midShown: true, gmShown: true, publishedName: 'GM Version', publishedAccent: accent, consumed: true, toldNotApplied: false });
  }, APP_TIMEOUT);

  /*
   * F1 (2026-10-09, round 7): leg 41's window with a Ctrl+= zoom on a sheet that has its own zoom override
   * (round-6 rulings refuter, probe PROBE-R6-A). App's `zoomStep` writes `{ ...c, character: { ...c.character,
   * customization: { …zoom } } }` — a NEW `character` object, the same `build` and `play` — and the zoom is
   * authored, so neither round 6's identity test nor the hash recognised his edit under it: judged again →
   * WAIT → published → REFUSED with a receipt while it was on their sheet. The marks ride the spread.
   * MUTATION (run 2026-10-09, round 7): drop the GM_APPLIED clause from App's `landed` test — and this fails —
   *   AssertionError: a GM edit that IS on their sheet (with their zoom) is consumed as applied — never answered "not applied": expected { zoomed: true, midShown: true, …(5) } to deeply equal { zoomed: true, midShown: true, …(5) }
   *   (- "toldNotApplied": false, + "toldNotApplied": true)
   * MUTATION (run 2026-10-09, round 7): drop the GM_JUDGED clause from the "not rendered yet" test — and this
   * fails, with the same assertion and the same diff.
   */
  it('(48) a Ctrl+= zoom right after the apply, in the same render batch, composes on his edit — never "not applied"', async () => {
    const id = 'z48';
    const key = `${CAMP}|${id}`;
    const sc = saved(id, 'Player Version');
    sc.character = { ...sc.character, customization: { ...(sc.character.customization ?? {}), zoom: 1 } } as SavedChar['character'];
    const app = await openInventory([sc]);
    expect(gm.own.has(key), 'fixture: the launch published').toBe(true);
    expect((gm.own.get(key)!.sheet as SavedChar).character.customization?.zoom, 'fixture: the per-sheet zoom override is published').toBe(1);
    const theirs = JSON.parse(JSON.stringify(gm.own.get(key)!.sheet)) as SavedChar;
    const gmSheet = { ...theirs, build: { ...theirs.build!, name: 'GM Version' }, character: { ...theirs.character, name: 'GM Version' } } as SavedChar;
    const row = push(id, gmSheet);
    let zoomed = false;
    gm.cloud = () => {
      setTimeout(() => {
        if (zoomed) return;
        zoomed = true;
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true }));
      }, 0);
      return Promise.resolve(true);
    };
    gm.edits = [row];
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await new Promise((r) => setTimeout(r, 30));
    });
    gm.cloud = null;
    await wait(50);
    const mid = { zoomed, midShown: app.shows('GM Version') };
    await wait(700);
    await pull();
    await wait(700);
    const published = gm.own.get(key)!.sheet as SavedChar;
    expect(
      {
        ...mid,
        publishedName: published.build?.name,
        publishedZoom: published.character.customization?.zoom,
        onSheet: app.shows('GM Version'),
        consumed: deleted(row),
        toldNotApplied: receipted(row),
      },
      'a GM edit that IS on their sheet (with their zoom) is consumed as applied — never answered "not applied"',
    ).toEqual({ zoomed: true, midShown: true, publishedName: 'GM Version', publishedZoom: 1.1, onSheet: true, consumed: true, toldNotApplied: false });
  }, APP_TIMEOUT);
});
