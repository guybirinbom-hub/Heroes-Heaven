// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { applyPlayState, initialPlay } from '../src/rules/play';
import {
  ROSTER_KEY,
  loadHomebrewContent,
  loadModes,
  loadRoster,
  loadTombstones,
  saveCampaignHbCache,
  saveHomebrewItem,
  saveMode,
  saveSyncOwner,
  type CampaignHbCampaign,
  type SavedChar,
} from '../src/data/storage';
import { computeSummary } from '../src/sheet/partySummary';
import { authoredKey, hash53 } from '../src/data/authored';
import { flushPersist } from '../src/data/persist';
import { getPrefs, setPref } from '../src/data/prefs';
import { foreignContent, withCarriedAttached } from '../src/data/carried';
import type { ContentDatabase, InventoryItem, ModeDef, PinnedDesc } from '../src/rules/types';
import type { PartySummary } from '../src/sheet/partySummary';

/**
 * OWNER RULING 2026-10-20 (Guy): "the others should see the same item as the player" — the PLAYER's side,
 * against the real <App/> with the party layer mocked (the harness of test/bug-gm-edit-race.test.tsx).
 *
 * A GM makes an item and a feat on HIS device and pushes the player's sheet with them. The push carries
 * the records (`SavedChar.carried`, src/data/carried.ts), so on the player's device:
 *   - the applied sheet draws them (no "Unknown item", the feat on the Feats tab),
 *   - the roster keeps them, and a cloud adopt's re-derive (rebuildRoster) keeps the feat,
 *   - the next publish carries them on, so the GM's own views of the sheet resolve them too,
 *   - and nothing is written into the player's homebrew (the ruling: "i dont want it in the homebrew").
 * And a character that already carries a record keeps it through the launch rebuild and its publish.
 *
 * Every character and record here is synthetic.
 */
type Base = { v: number; at: string; stamp: string; hash: string; on: string | null };
type Row = { campaignId: string; charId: string; sheet: unknown; updatedAt: string; gmBase?: Base };
const gm = vi.hoisted(() => ({
  edits: [] as Row[],
  own: new Map<string, { sheet: unknown; updatedAt: string }>(),
  publishes: [] as { campaignId: string; charId: string; sheet: unknown; summary?: unknown }[],
  deletes: [] as { campaignId: string; charId: string; updatedAt?: string }[],
  clock: 0,
  adopt: null as null | ((roster: unknown[]) => void),
}));

vi.mock('../src/data/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in', session: null, email: 'player@example.com' }),
}));
vi.mock('../src/data/party', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/party')>()),
  fetchGmEdits: async () => gm.edits,
  fetchPublishedSheet: async (campaignId: string, charId: string) => {
    const r = gm.own.get(`${campaignId}|${charId}`);
    return r
      ? { sheet: JSON.parse(JSON.stringify(r.sheet)), updatedAt: r.updatedAt, ownerId: 'player-1' }
      : { sheet: null, updatedAt: undefined, ownerId: undefined };
  },
  publishCharacter: async (campaignId: string, charId: string, _name: string, summary: unknown, sheet: unknown) => {
    gm.publishes.push({ campaignId, charId, sheet, summary });
    gm.own.set(`${campaignId}|${charId}`, {
      sheet: JSON.parse(JSON.stringify(sheet)),
      updatedAt: new Date(Date.UTC(2026, 9, 20, 12, 0, ++gm.clock)).toISOString(),
    });
    return 'ok';
  },
  unpublishCharacter: async () => 'ok',
  deleteGmEdit: async (campaignId: string, charId: string, updatedAt?: string) => {
    gm.deletes.push({ campaignId, charId, updatedAt });
    return 1;
  },
  markGmEditRefused: async () => true,
  currentUserId: async () => null, // no Realtime subscription in the test
}));
vi.mock('../src/data/cloudSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/cloudSync')>()),
  startCloudSync: async (cb: (roster: unknown[]) => void) => {
    gm.adopt = cb;
    return () => undefined;
  },
  pullForGmApply: () => null,
}));

// Production update priorities (see test/bug-gm-edit-race.test.tsx): `window.event` is jsdom's real one.
const jsdomWindow = (globalThis as unknown as { jsdom?: { window: { event?: Event } } }).jsdom?.window;
if (!jsdomWindow) throw new Error('fixture: the jsdom environment exposes no `jsdom` global');
Object.defineProperty(window, 'event', { configurable: true, get: () => jsdomWindow?.event, set: () => undefined });

const ACTIVE_KEY = 'wanderers-codex:active:v1';
const APP_TIMEOUT = 120_000;
const CAMP = 'camp';
const db = content();

/** The GM's own records — made on HIS device; the player's has neither. */
const GM_ITEM = {
  id: 'custom-gm-salt-charm-k2',
  name: 'Salt Charm of the Shoals',
  itemType: 'equipment',
  level: 1,
  bulk: 0,
  traits: [],
  rarity: 'common',
  price: { gp: 2 },
  description: 'The GM made this one.',
  source: { license: 'homebrew', book: 'GM Book' },
};
const GM_FEAT = {
  id: 'hb-gm-feat-tidewise',
  name: 'Tidewise Instinct',
  level: 1,
  category: 'ancestry',
  traits: ['human'],
  rarity: 'common',
  description: 'You always know where the tide stands.',
  source: { license: 'homebrew', book: 'GM Book' },
  // An effect the BUILD applies, so a re-derive without the record visibly loses it (a feat id alone
  // stays on `character.feats` either way): an innate Light. These fighters cast nothing else.
  innateSpells: [{ spellId: 'light', tradition: 'arcane', atWill: true }],
};
const castsLight = (sc: SavedChar) => JSON.stringify(sc.character.spellcasting ?? []).includes('"light"');
const gmDb = { ...db, items: { ...db.items, [GM_ITEM.id]: GM_ITEM }, feats: { ...db.feats, [GM_FEAT.id]: GM_FEAT } } as unknown as ContentDatabase;

const buildOf = (name: string): BuildState =>
  ({
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
  }) as BuildState;
function saved(id: string, name: string): SavedChar {
  const build = buildOf(name);
  const character = buildCharacter(build, db);
  return { id, character, build, play: initialPlay(character, db) } as SavedChar;
}
/** `sc` as the GM changes it on his device: his feat taken, his charm handed over. */
function withGmChanges(sc: SavedChar): SavedChar {
  const build = { ...sc.build!, featPicks: { ...sc.build!.featPicks, '1:ancestry:0': GM_FEAT.id } } as BuildState;
  const character = buildCharacter(build, gmDb);
  const gift = { instanceId: 'gm-gift-1', itemId: GM_ITEM.id, quantity: 1 } as InventoryItem;
  return { ...sc, character, build, play: { ...sc.play!, inventory: [...sc.play!.inventory!, gift] } } as SavedChar;
}
const H = (sc: unknown) => hash53(authoredKey(sc as SavedChar));
/** A GM push row built on what the server publishes right now (gmBaseOf). */
function push(charId: string, sheet: SavedChar): Row {
  const own = gm.own.get(`${CAMP}|${charId}`)!;
  const at = '2026-10-20T09:01:00.000Z';
  return { campaignId: CAMP, charId, sheet, updatedAt: at, gmBase: { v: 1, at, stamp: own.updatedAt, hash: H(own.sheet), on: null } };
}

let live: Root | null = null;
afterEach(() => {
  if (live) act(() => live!.unmount());
  live = null;
  localStorage.clear();
  gm.edits = [];
  gm.own.clear();
  gm.publishes = [];
  gm.deletes = [];
  gm.clock = 0;
  gm.adopt = null;
  setPref('pinnedModes', []); // device prefs live in the module, not only in localStorage
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const wait = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const pull = () =>
  act(async () => {
    window.dispatchEvent(new Event('focus'));
    await new Promise((r) => setTimeout(r, 50));
  });

function stubData() {
  const files: Record<string, string> = {
    'core.json': 'public/core.json',
    'core-descriptions.json': 'public/core-descriptions.json',
  };
  vi.stubGlobal('fetch', async (url: string) => {
    const path = files[String(url).split('/').pop() ?? ''];
    if (!path) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(path, 'utf8')) as unknown };
  });
}

async function openApp(roster: SavedChar[]) {
  stubData();
  localStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
  localStorage.setItem(ACTIVE_KEY, roster[0].id);
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
  // The item detail's popup (PopupSizeLock) watches its size; jsdom has no ResizeObserver.
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  window.matchMedia ??=((q: string) => ({
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
  const button = (label: string) => [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label);
  for (let i = 0; i < 200 && !button('Inventory'); i++) await wait(50);
  await wait(600); // the launch publish (PUBLISH_DEBOUNCE_MS = 400)
  const tab = (label: string) => {
    act(() => button(label)!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    return host.textContent ?? '';
  };
  return { host, tab };
}

/** Every record a sheet carries, as `type:id` — the `fill` list (which of them only fill a gap) is not one. */
const carriedIds = (sc: unknown) => {
  const c = (sc as SavedChar).carried ?? {};
  return Object.entries(c)
    .filter(([t]) => t !== 'fill')
    .flatMap(([t, recs]) => Object.keys(recs ?? {}).map((id) => `${t}:${id}`))
    .sort();
};
const lastPublish = (charId: string) => [...gm.publishes].reverse().find((p) => p.charId === charId)?.sheet as SavedChar | undefined;

describe("a GM's push brings his records with it", () => {
  it('the applied sheet draws them, the roster keeps them, a cloud adopt keeps the feat, the next publish carries them', async () => {
    // mutation-proof: drop `ownContent(...)` from rebuildRoster (src/data/rebuild.ts; build against `content`)
    // and this goes red at the adopt: the re-derived character loses the GM feat's innate Light.
    const app = await openApp([saved('p1', 'Corin Vale')]);
    expect(gm.own.has(`${CAMP}|p1`), 'fixture: the launch published the sheet').toBe(true);
    expect(carriedIds(lastPublish('p1')), 'fixture: nothing to carry before the push').toEqual([]);

    // The GM, on his device: his view of the published sheet, changed, sent the way pushGmEdit sends it.
    const read = gm.own.get(`${CAMP}|p1`)!.sheet as SavedChar;
    const gmVersion = withGmChanges(read);
    const sent = withCarriedAttached(gmVersion, foreignContent(gmDb, gmVersion));
    expect(carriedIds(sent), 'fixture: the push carries his item and his feat').toEqual([`feats:${GM_FEAT.id}`, `items:${GM_ITEM.id}`]);
    gm.edits = [push('p1', sent)];
    await pull();

    const inventory = app.tab('Inventory');
    expect(inventory, 'his item, named').toContain(GM_ITEM.name);
    expect(inventory).not.toContain('Unknown item');
    expect(app.tab('Feats & features'), 'his feat').toContain(GM_FEAT.name);

    await wait(600); // the persist and the republish
    flushPersist();
    const entry = loadRoster().find((c) => c.id === 'p1')!;
    expect(carriedIds(entry), 'the roster keeps what the push brought').toEqual([`feats:${GM_FEAT.id}`, `items:${GM_ITEM.id}`]);
    expect(carriedIds(lastPublish('p1')), 'and the next publish carries it on').toEqual([`feats:${GM_FEAT.id}`, `items:${GM_ITEM.id}`]);
    expect(lastPublish('p1')!.carried!.items![GM_ITEM.id].name).toBe(GM_ITEM.name);
    const hb = loadHomebrewContent();
    expect(hb.items[GM_ITEM.id], 'never written into the player’s homebrew').toBeUndefined();
    expect(hb.feats[GM_FEAT.id]).toBeUndefined();

    // Their cloud sync adopts a pulled roster: App re-derives every character (rebuildRoster).
    await act(async () => {
      gm.adopt!(JSON.parse(JSON.stringify(loadRoster())));
      await new Promise((r) => setTimeout(r, 50));
    });
    flushPersist();
    const adopted = loadRoster().find((c) => c.id === 'p1')!;
    expect(castsLight(adopted), "the re-derive keeps his feat's effect (its innate Light)").toBe(true);
    expect(app.tab('Feats & features')).toContain(GM_FEAT.name);
    expect(app.tab('Inventory')).toContain(GM_ITEM.name);
  }, APP_TIMEOUT);
});

describe("an applied push never stores a copy of the player's OWN record", () => {
  it('the roster entry keeps the GM’s record only; the publish still carries both, the player’s from their homebrew', async () => {
    /*
     * 2026-10-20, checker findings saving-C3 / semantics-C2: the push carries every record the sheet uses, the
     * player's own included. A roster copy of their own record outlived their Homebrew-page Delete once its
     * tombstone expired (180 days) — and filled the deleted record back in (ruling 2026-09-12 #7).
     * mutation-proof: drop the `keepCarried(...)` around `k.e.sheet` in App's GM apply (src/App.tsx; spread
     * `k.e.sheet` itself) and this goes red: the roster entry carries a copy of the player's own lantern.
     */
    const OWN_ITEM = {
      id: 'custom-own-reed-lantern-p4',
      name: 'Reed Lantern',
      itemType: 'equipment',
      level: 0,
      bulk: 0,
      traits: [],
      rarity: 'common',
      description: 'The player made this one.',
      source: { license: 'homebrew' },
    };
    // The content database is cached per module: load it, then re-merge it with this homebrew (the way the
    // Homebrew page's save does), so the App opens with the player's own lantern in their content.
    stubData();
    const { loadContent, rebuildContent } = await import('../src/data');
    await loadContent();
    saveHomebrewItem(OWN_ITEM as never);
    rebuildContent();
    const base = saved('p3', 'Edda Fenn');
    const lantern = { instanceId: 'own-1', itemId: OWN_ITEM.id, quantity: 1 } as InventoryItem;
    const withLantern = { ...base, play: { ...base.play!, inventory: [...base.play!.inventory!, lantern] } } as SavedChar;
    await openApp([withLantern]);
    expect(carriedIds(lastPublish('p3')), 'fixture: the launch publish carries the player’s own lantern').toEqual([`items:${OWN_ITEM.id}`]);

    const read = gm.own.get(`${CAMP}|p3`)!.sheet as SavedChar;
    const gmVersion = withGmChanges(read);
    const sent = withCarriedAttached(gmVersion, foreignContent(gmDb, gmVersion));
    expect(carriedIds(sent), 'fixture: the push carries his records and the player’s lantern').toEqual([
      `feats:${GM_FEAT.id}`,
      `items:${GM_ITEM.id}`,
      `items:${OWN_ITEM.id}`,
    ]);
    gm.edits = [push('p3', sent)];
    await pull();
    await wait(600); // the persist and the republish
    flushPersist();
    const entry = loadRoster().find((c) => c.id === 'p3')!;
    expect(entry.play?.inventory?.some((i) => i.itemId === GM_ITEM.id), 'fixture: the push was applied').toBe(true);
    expect(carriedIds(entry), 'only what this device cannot resolve itself').toEqual([`feats:${GM_FEAT.id}`, `items:${GM_ITEM.id}`]);
    expect(carriedIds(lastPublish('p3')), 'the publish collects the lantern from the player’s homebrew').toEqual([
      `feats:${GM_FEAT.id}`,
      `items:${GM_ITEM.id}`,
      `items:${OWN_ITEM.id}`,
    ]);
  }, APP_TIMEOUT);
});

describe('a character that already carries a record', () => {
  it('keeps it through the launch rebuild, draws it, and its launch publish carries it', async () => {
    // mutation-proof: publish without `carried` in App's publish effect (`published = { id, character, build,
    // play }`) and this goes red: the launch publish carries nothing, and the GM sees "Unknown item".
    const withGift = withGmChanges(saved('p2', 'Mira Holt'));
    const entry = withCarriedAttached(withGift, foreignContent(gmDb, withGift));
    // What the launch's re-derive works from: a stored character that has NOT got the feat (an older app
    // derived it), so only the carried record can put it there.
    const stale = { ...entry, character: buildCharacter(saved('p2', 'Mira Holt').build!, db) } as SavedChar;
    expect(castsLight(stale), 'fixture: the stored character lacks the feat’s effect').toBe(false);
    const app = await openApp([stale]);
    flushPersist();
    const rebuilt = loadRoster().find((c) => c.id === 'p2')!;
    expect(castsLight(rebuilt), 'the launch rebuild derives the carried feat').toBe(true);
    expect(app.tab('Inventory')).toContain(GM_ITEM.name);
    expect(app.tab('Feats & features')).toContain(GM_FEAT.name);
    expect(carriedIds(lastPublish('p2')), 'the launch publish carries both').toEqual([`feats:${GM_FEAT.id}`, `items:${GM_ITEM.id}`]);
  }, APP_TIMEOUT);
});

/* ───────────────────────────── round 2 (2026-10-20) ───────────────────────────── */

/** A homebrew item with no book (offered whatever books the character has on). */
const hbItem = (id: string, name: string, description: string) => ({
  id,
  name,
  itemType: 'equipment',
  level: 0,
  bulk: 0,
  traits: [],
  rarity: 'common',
  description,
  source: { license: 'homebrew' },
});
const withItems = (sc: SavedChar, ids: string[]): SavedChar =>
  ({
    ...sc,
    play: { ...sc.play!, inventory: [...sc.play!.inventory!, ...ids.map((itemId, i) => ({ instanceId: `inst-${i}`, itemId, quantity: 1 }) as InventoryItem)] },
  }) as SavedChar;
const publishesTo = (cid: string, charId: string) => gm.publishes.filter((p) => p.campaignId === cid && p.charId === charId);
const setInput = (el: HTMLInputElement, value: string) => {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setValue.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const press = (el: Element | null | undefined) => act(() => void el!.dispatchEvent(new MouseEvent('click', { bubbles: true })));

describe('(R1) what each campaign is sent: what ITS shared homebrew already gives its members only FILLS a gap', () => {
  const A = 'camp-a';
  const B = 'camp-b';
  const camp = (name: string, items: Record<string, unknown>): CampaignHbCampaign =>
    ({ name, sources: {}, content: { items }, updatedAt: '2026-10-20T08:00:00.000Z' }) as unknown as CampaignHbCampaign;
  const fillOf = (sc: unknown) => (sc as SavedChar).carried?.fill ?? [];
  /** The player's character, in both campaigns, using `ids`. */
  const inBoth = (ids: string[]) => {
    const base = saved('p7', 'Wren Tollan');
    return withItems({ ...base, build: { ...base.build!, campaignIds: [A, B] } as BuildState, character: { ...base.character, campaignIds: [A, B] } } as SavedChar, ids);
  };

  it('a record shared in campaign A goes to A fill-only (its edit does not republish there, his delete leaves no gap), to B winning; the player’s own goes to both', async () => {
    /*
     * 2026-10-20, checker findings saving-C2 and saving-R2-chk-1. Carried to the campaign that shares it as a
     * WINNING copy, a GM's edit of his shared record changed every PC sheet using it: every player's app
     * republished, and the moved `updated_at` turned his chained tracker push into "not applied". Left OUT of it,
     * the record went "Unknown item" on the GM's views the moment he deleted it from his homebrew.
     * mutation-proof: compare `JSON.stringify(published)` (not `publishKey(published)`) in App's publish effect
     * (src/App.tsx) and this goes red: the GM's edit of the record camp-a shares republishes the sheet to camp-a.
     */
    const X = hbItem('custom-shared-a-tide-bell-x1', 'Tide Bell', 'Shared in camp A.');
    const Y = hbItem('custom-shared-b-reef-hook-y1', 'Reef Hook', 'Shared in camp B.');
    const Z = hbItem('custom-own-kelp-rope-z1', 'Kelp Rope', 'The player made this one.');
    stubData();
    const { loadContent, rebuildContent } = await import('../src/data');
    await loadContent();
    saveSyncOwner('player-1');
    saveCampaignHbCache('player-1', { [A]: camp('Camp A', { [X.id]: X }), [B]: camp('Camp B', { [Y.id]: Y }) }, [A, B]);
    saveHomebrewItem(Z as never);
    rebuildContent();
    await openApp([inBoth([X.id, Y.id, Z.id])]);

    expect(publishesTo(A, 'p7'), 'fixture: one launch publish to A').toHaveLength(1);
    expect(publishesTo(B, 'p7'), 'fixture: one launch publish to B').toHaveLength(1);
    const toA = publishesTo(A, 'p7')[0].sheet as SavedChar;
    expect(carriedIds(toA), 'to A: all three ride along').toEqual([`items:${X.id}`, `items:${Y.id}`, `items:${Z.id}`].sort());
    expect(fillOf(toA), 'A’s own share only fills a gap there').toEqual([`items:${X.id}`]);
    expect(fillOf(publishesTo(B, 'p7')[0].sheet), 'to B: only B’s').toEqual([`items:${Y.id}`]);
    // The GM of A, on his device: his own record wins while he has it; deleted from his homebrew (the player
    // has not pulled and republished yet), the copy fills the gap — no "Unknown item" (finding saving-R2-chk-1).
    const gmX = { ...X, description: 'The GM’s current text.' };
    expect(foreignContent({ ...db, items: { ...db.items, [X.id]: gmX } } as ContentDatabase, toA).items[X.id].description).toBe('The GM’s current text.');
    expect(foreignContent(db, toA).items[X.id]?.name, 'deleted on his side: still resolves').toBe(X.name);

    // The GM of A edits his shared record; this device's pull lands it (a sync that changed the homebrew).
    saveCampaignHbCache('player-1', { [A]: camp('Camp A', { [X.id]: { ...X, description: 'Rung louder now.' } }), [B]: camp('Camp B', { [Y.id]: Y }) }, [A, B]);
    saveHomebrewItem(hbItem('custom-own-unrelated-w1', 'Unrelated Thing', 'Nothing to do with it.') as never); // the sync's own change
    await act(async () => {
      window.dispatchEvent(new Event('hh-synced'));
      await new Promise((r) => setTimeout(r, 50));
    });
    await wait(600);
    expect(publishesTo(A, 'p7'), 'no republish to the campaign whose share changed').toHaveLength(1);
    expect(publishesTo(B, 'p7'), 'fixture (positive control): B carries it, so B is sent the new text').toHaveLength(2);
    expect((publishesTo(B, 'p7')[1].sheet as SavedChar).carried!.items![X.id].description).toBe('Rung louder now.');

    // The player edits their OWN record: both campaigns are sent it.
    saveHomebrewItem({ ...Z, description: 'Tarred against the salt.' } as never);
    await act(async () => {
      window.dispatchEvent(new Event('hh-synced'));
      await new Promise((r) => setTimeout(r, 50));
    });
    await wait(600);
    expect(publishesTo(A, 'p7'), 'A republished with the player’s own edit').toHaveLength(2);
    expect(publishesTo(B, 'p7')).toHaveLength(3);
    expect((publishesTo(A, 'p7')[1].sheet as SavedChar).carried!.items![Z.id].description).toBe('Tarred against the salt.');
    expect(fillOf(publishesTo(A, 'p7')[1].sheet), 'A’s own share still only fills').toEqual([`items:${X.id}`]);
  }, APP_TIMEOUT);

  it('two campaigns sharing one id with different text: B is sent the copy the PLAYER sees (A’s), winning', async () => {
    /*
     * 2026-10-20, checker finding saving-R2-chk-3. The player's view takes a duplicate shared id from the FIRST
     * campaign of the cache (src/data/index.ts mergeWithSeed). Marked fill-only for B as well, B's GM and members
     * would draw B's text while the player's sheet uses A's ("the others should see the same item as the player").
     * mutation-proof: make carriedForCampaign mark an id whenever the campaign merely HOLDS it (`origins.get(key)
     * !== undefined`, not `=== cid`, in src/data/carried.ts) and this goes red: B's publish marks X fill-only.
     */
    const X = hbItem('custom-shared-both-net-x2', 'Drift Net', 'Camp A’s text.');
    const xB = { ...X, description: 'Camp B’s text.' };
    stubData();
    const { loadContent, rebuildContent } = await import('../src/data');
    await loadContent();
    saveSyncOwner('player-1');
    saveCampaignHbCache('player-1', { [A]: camp('Camp A', { [X.id]: X }), [B]: camp('Camp B', { [X.id]: xB }) }, [A, B]);
    expect(rebuildContent().items[X.id]?.description, 'fixture: the player sees A’s copy (the merge’s pick)').toBe('Camp A’s text.');
    await openApp([inBoth([X.id])]);
    const toB = publishesTo(B, 'p7')[0].sheet as SavedChar;
    expect(fillOf(toB), 'to B: not fill-only').toEqual([]);
    expect(toB.carried?.items?.[X.id]?.description).toBe('Camp A’s text.');
    expect(foreignContent({ ...db, items: { ...db.items, [X.id]: xB } } as ContentDatabase, toB).items[X.id].description, 'B’s GM sees the player’s copy').toBe('Camp A’s text.');
    expect(fillOf(publishesTo(A, 'p7')[0].sheet), 'to A: fill-only').toEqual([`items:${X.id}`]);
  }, APP_TIMEOUT);
});

/** A mode the GM wrote on HIS device (a user mode: no catalog id, no item, no gate). */
const GM_MODE: ModeDef = { id: 'mode-gm-harbor-guard-r2', name: 'Harbor Guard', modifiers: [{ value: 2, type: 'status', target: 'ac' }] };

describe("(R2) a GM's own MODE travels with his push", () => {
  it('the player’s sheet derives with it, the roster keeps it, the publish carries it on; their modes list never gets it', async () => {
    // 2026-10-20, checker finding coverage-F3: a custom mode was dropped from every other device's view of the
    // sheet (applyPlayState keeps only the active ids `content.modes` holds), so the GM's own mode never took.
    // mutation-proof: loop `HOMEBREW_TYPES` (not CARRIED_TYPES) in withCarried (src/data/carried.ts) and this
    // goes red: the player's own view has no such mode, so the sheet derives without it and the publish drops it.
    await openApp([saved('p8', 'Oda Marsh')]);
    const first = publishesTo(CAMP, 'p8')[0].summary as PartySummary;
    expect(first.modes, 'fixture: no mode on before the push').toEqual([]);

    const read = gm.own.get(`${CAMP}|p8`)!.sheet as SavedChar;
    const gmVersion = { ...read, play: { ...read.play!, activeModes: [GM_MODE.id] } } as SavedChar;
    const gmModesDb = { ...db, modes: { ...db.modes, [GM_MODE.id]: GM_MODE } } as ContentDatabase;
    const sent = withCarriedAttached(gmVersion, foreignContent(gmModesDb, gmVersion));
    expect(carriedIds(sent), 'fixture: the push carries his mode').toEqual([`modes:${GM_MODE.id}`]);
    gm.edits = [push('p8', sent)];
    await pull();
    await wait(600);
    flushPersist();

    const entry = loadRoster().find((c) => c.id === 'p8')!;
    expect(entry.play?.activeModes, 'fixture: the push was applied').toContain(GM_MODE.id);
    expect(carriedIds(entry), 'the roster keeps his mode').toEqual([`modes:${GM_MODE.id}`]);
    const after = [...publishesTo(CAMP, 'p8')].pop()!;
    expect(carriedIds(after.sheet), 'the next publish carries it on').toEqual([`modes:${GM_MODE.id}`]);
    const summary = after.summary as PartySummary;
    expect(summary.modes, 'the player’s sheet derives with it: the mode is on').toEqual([GM_MODE.name]);
    expect(summary.ac, 'and its +2 status to AC counts').toBe(first.ac + 2);
    expect(loadModes()[GM_MODE.id], 'never written into the player’s own modes').toBeUndefined();
  }, APP_TIMEOUT);
});

describe("(R3) the player's OWN sheet: a GM-given item only the roster entry carries is copy-on-write", () => {
  /*
   * 2026-10-20, checker finding N1. Edited in place on the player's own sheet — or "deleted" from Add items,
   * which retires it by SAVING it — the GM's record was written into the player's homebrew (owner ruling
   * 2026-10-20: "i dont want it in the homebrew"). App provides CopyOnWriteItemsContext with those ids.
   */
  const GIFT = hbItem('custom-gm-gift-coral-key-g3', 'Coral Key of the Shoals', 'The GM made this key.');
  const OWN = hbItem('custom-own-lamp-of-the-shoals-o3', 'Lamp of the Shoals', 'The player made this lamp.');
  const giftDb = { ...db, items: { ...db.items, [GIFT.id]: GIFT } } as unknown as ContentDatabase;
  async function openWithGift(id: string) {
    stubData();
    const { loadContent, rebuildContent } = await import('../src/data');
    await loadContent();
    saveHomebrewItem(OWN as never); // the player's own record: the positive control
    rebuildContent();
    const sc = withItems(saved(id, 'Bram Coldwater'), [GIFT.id]);
    const entry = withCarriedAttached(sc, foreignContent(giftDb, sc));
    expect(carriedIds(entry), 'fixture: the roster entry carries the GM’s key').toEqual([`items:${GIFT.id}`]);
    return openApp([entry]);
  }

  it('the Add-items list offers no Delete on it (the player’s own record keeps its Delete)', async () => {
    // mutation-proof: drop App's `<CopyOnWriteItemsContext.Provider value={carriedOnlyItems}>` around the own
    // sheet (src/App.tsx; value null) and this goes red: the GM's key offers "Delete".
    const app = await openWithGift('p9');
    expect(app.tab('Inventory'), 'fixture: the key draws').toContain(GIFT.name);
    press([...app.host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Add item')));
    await wait(50);
    const search = document.querySelector<HTMLInputElement>('.fsel-results-search input');
    expect(search, 'fixture: the Add items search').not.toBeNull();
    setInput(search!, 'of the Shoals');
    await wait(50);
    const rows = [...document.querySelectorAll('.ai-row')].map((r) => r.querySelector('.ai-name')?.textContent);
    expect(rows, 'fixture: both are offered').toEqual(expect.arrayContaining([GIFT.name, OWN.name]));
    expect(document.querySelector(`[aria-label="Delete ${OWN.name}"]`), 'fixture (positive control): the player’s own offers Delete').not.toBeNull();
    expect(document.querySelector(`[aria-label="Delete ${GIFT.name}"]`), 'the GM’s key does not').toBeNull();
  }, APP_TIMEOUT);

  it('an edit makes the player’s OWN copy under a new id and repoints the row; the GM’s record never lands in their homebrew', async () => {
    // mutation-proof: drop App's `<CopyOnWriteItemsContext.Provider value={carriedOnlyItems}>` (value null) and
    // this goes red: the edit saves the GM's key under its own id into the player's homebrew.
    const app = await openWithGift('p10');
    app.tab('Inventory');
    const card = [...app.host.querySelectorAll<HTMLElement>('.inv-card')].find((e) => (e.textContent ?? '').includes(GIFT.name));
    expect(card, 'fixture: the key’s inventory card').toBeTruthy();
    press(card);
    await wait(50);
    const pencil = document.querySelector<HTMLElement>('[aria-label="Edit item"]');
    expect(pencil, 'fixture: the item detail offers Edit').not.toBeNull();
    press(pencil);
    await wait(50);
    const name = document.querySelector<HTMLInputElement>('input[placeholder="e.g. Stormcaller blade"]');
    expect(name, 'fixture: the item editor').not.toBeNull();
    setInput(name!, 'Coral Key (re-cut)');
    press(document.querySelector('.ci-save'));
    await wait(600); // the persist and the republish
    flushPersist();

    const entry = loadRoster().find((c) => c.id === 'p10')!;
    const row = entry.play!.inventory!.find((i) => i.instanceId === 'inst-0')!;
    expect(row.itemId, 'the row points at a NEW record').not.toBe(GIFT.id);
    const hb = loadHomebrewContent();
    expect(hb.items[row.itemId]?.name, 'the player’s own copy, theirs because they edited it').toBe('Coral Key (re-cut)');
    expect(hb.items[GIFT.id], 'the GM’s record is never written into their homebrew').toBeUndefined();
    expect(app.tab('Inventory')).toContain('Coral Key (re-cut)');
  }, APP_TIMEOUT);
});

describe("(R5) round 3: on the player's OWN sheet a mode the GM's push brought is the GM's, not theirs", () => {
  /*
   * 2026-10-20, final findings N-a / N-c — owner ruling 2026-10-20: "i dont want it in the homebrew … the
   * others should see the same item as the player". The GM switched his own mode (+2 AC) on for the character
   * and pushed it; the player's device holds it only through the roster entry's `carried`. Delete in the Modes
   * panel wrote a `mode:<id>` tombstone on the PLAYER's account, and the id stayed in the character's active
   * modes: their own sheet dropped the +2, but the GM's device — which holds the mode — still drew it, so the
   * player, the teammates and the GM saw different ACs. An edit wrote the GM's mode into their saved modes.
   * Now Delete is "Remove from this character" and an edit makes the player's own copy (src/App.tsx
   * saveOwnModeDef / removeOwnModeDef, CopyOnWriteModesContext + ModesRemoveFromCharacterContext).
   */
  const gmModesDb = { ...db, modes: { ...db.modes, [GM_MODE.id]: GM_MODE } } as ContentDatabase;
  /** AC as a view of a published sheet draws it: `view` is that viewer's database with the sheet's carried records. */
  const acIn = (sc: SavedChar, view: ContentDatabase) => computeSummary(applyPlayState(sc.character, sc.play, view), view).ac;

  async function openFresh(roster: SavedChar[], own?: ModeDef) {
    stubData();
    const { loadContent, rebuildContent } = await import('../src/data');
    await loadContent();
    if (own) saveMode(own); // the player's OWN saved mode (the positive control)
    rebuildContent(); // the cached database re-merged with this test's storage only
    return openApp(roster);
  }
  /** The GM's push: his mode on, carried the way pushGmEdit carries it; then this device applies it. */
  async function gmPushesMode(charId: string) {
    const read = gm.own.get(`${CAMP}|${charId}`)!.sheet as SavedChar;
    const gmVersion = { ...read, play: { ...read.play!, activeModes: [...(read.play!.activeModes ?? []), GM_MODE.id] } } as SavedChar;
    const sent = withCarriedAttached(gmVersion, foreignContent(gmModesDb, gmVersion));
    expect(carriedIds(sent), 'fixture: the push carries his mode').toContain(`modes:${GM_MODE.id}`);
    gm.edits = [push(charId, sent)];
    await pull();
    await wait(600); // the persist and the republish
    flushPersist();
    expect(loadRoster().find((c) => c.id === charId)!.play?.activeModes, 'fixture: the push was applied').toContain(GM_MODE.id);
  }
  /** Main → conditions "Add" → the Modes tab → the editor of the mode named `name`. */
  async function openModeEditor(app: { host: HTMLElement; tab: (l: string) => string }, name: string) {
    app.tab('Main');
    const add = [...app.host.querySelectorAll<HTMLButtonElement>('button.add-btn')].find((b) => (b.textContent ?? '').trim() === 'Add');
    expect(add, 'fixture: the conditions Add button').toBeTruthy();
    press(add);
    await wait(50);
    const modal = document.querySelector('.cond-modal');
    press([...(modal?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === 'Modes'));
    await wait(50);
    const row = [...document.querySelectorAll<HTMLElement>('.mode-row')].find((r) => (r.textContent ?? '').includes(name));
    expect(row, `fixture: ${name} is listed`).toBeTruthy();
    press(row!.querySelector('.mode-edit'));
    await wait(50);
    expect(document.querySelector('.mode-editor'), 'fixture: the mode editor').not.toBeNull();
  }
  const lastOf = (charId: string) => [...publishesTo(CAMP, charId)].pop()!;

  it('Delete is "Remove from this character": the player, a teammate and the GM all draw the same AC; nothing lands in their modes', async () => {
    // mutation-proof: drop the carried-only branch of App's removeOwnModeDef (src/App.tsx; always `removeModeDef(modeId)`)
    // and this goes red: a `mode:<id>` tombstone on the player's account, the id still active, and the GM's view +2.
    const app = await openFresh([saved('p12', 'Tamsin Reed')]);
    const before = lastOf('p12').summary as PartySummary;
    await gmPushesMode('p12');
    expect((lastOf('p12').summary as PartySummary).ac, 'fixture: the mode counts on the player’s sheet').toBe(before.ac + 2);

    await openModeEditor(app, GM_MODE.name);
    const remove = document.querySelector<HTMLButtonElement>('.me-delete');
    // mutation-proof: drop App's `<CopyOnWriteModesContext.Provider value={carriedOnlyModes}>` (src/App.tsx) and
    // this goes red: the button says plain "Delete".
    expect(remove?.textContent?.trim(), 'it says what it does').toBe('Remove from this character');
    expect(remove?.title).toContain('this character only');
    press(remove);
    await wait(600); // the persist and the republish
    flushPersist();

    const entry = loadRoster().find((c) => c.id === 'p12')!;
    expect(entry.play?.activeModes ?? [], 'off this character').not.toContain(GM_MODE.id);
    expect(carriedIds(entry), 'and out of what it carries').not.toContain(`modes:${GM_MODE.id}`);
    expect(loadModes()[GM_MODE.id], 'never in the player’s saved modes').toBeUndefined();
    expect(Object.keys(loadTombstones()).filter((k) => k.includes(GM_MODE.id)), 'never a tombstone on their account').toEqual([]);
    const pub = lastOf('p12');
    const sheet = pub.sheet as SavedChar;
    expect(sheet.play?.activeModes ?? [], 'the publish does not list it').not.toContain(GM_MODE.id);
    expect(carriedIds(sheet), 'nor carry it').not.toContain(`modes:${GM_MODE.id}`);
    const player = (pub.summary as PartySummary).ac;
    expect(player, 'the player’s own AC is back').toBe(before.ac);
    expect(acIn(sheet, foreignContent(db, sheet)), 'a teammate without the mode').toBe(player);
    expect(acIn(sheet, foreignContent(gmModesDb, sheet)), 'the GM, whose device holds the mode').toBe(player);
  }, APP_TIMEOUT);

  it('an edit makes the player’s OWN copy under a new id, and the character points at it; the GM’s id never lands in their modes', async () => {
    // mutation-proof: drop the carried-only branch of App's saveOwnModeDef (src/App.tsx; always `saveModeDef(mode)`)
    // and this goes red: the GM's mode is saved under his id into the player's modes.
    const app = await openFresh([saved('p13', 'Ilse Varro')]);
    const before = lastOf('p13').summary as PartySummary;
    await gmPushesMode('p13');
    setPref('pinnedModes', [GM_MODE.id]); // the player pinned the GM's mode to the top of the panel
    await openModeEditor(app, GM_MODE.name);
    setInput(document.querySelector<HTMLInputElement>('.me-val')!, '3');
    press(document.querySelector('.mode-editor .btn-primary'));
    await wait(600);
    flushPersist();

    const mine = Object.values(loadModes());
    expect(mine.map((m) => m.id), 'exactly one saved mode: the player’s copy').toHaveLength(1);
    const copy = mine[0];
    expect(copy.id, 'under a new id').not.toBe(GM_MODE.id);
    expect(copy.modifiers[0].value).toBe(3);
    // mutation-proof: drop `carryModePin(mode.id, copy.id)` from App's saveOwnModeDef (src/App.tsx) and this goes
    // red: the copy, under its fresh id, falls out of the pinned group (2026-10-20, r3-R3-pin-lost-on-copy).
    expect(getPrefs().pinnedModes, 'the pin goes with the copy').toContain(copy.id);
    expect(Object.keys(loadTombstones()).filter((k) => k.includes(GM_MODE.id))).toEqual([]);
    const entry = loadRoster().find((c) => c.id === 'p13')!;
    expect(entry.play?.activeModes, 'the character points at the copy').toEqual([copy.id]);
    expect(carriedIds(entry), 'the GM’s mode, replaced here, is no longer carried').not.toContain(`modes:${GM_MODE.id}`);
    const pub = lastOf('p13');
    expect((pub.sheet as SavedChar).play?.activeModes).toEqual([copy.id]);
    expect(carriedIds(pub.sheet), 'the publish carries the copy so every view draws it').toEqual([`modes:${copy.id}`]);
    expect((pub.summary as PartySummary).ac).toBe(before.ac + 3);
    expect(acIn(pub.sheet as SavedChar, foreignContent(gmModesDb, pub.sheet as SavedChar)), 'the GM sees the same').toBe(before.ac + 3);
  }, APP_TIMEOUT);

  it('positive control: the player’s OWN mode keeps a plain Delete (a tombstone, as ever) and is edited in place', async () => {
    const OWN_MODE: ModeDef = { id: 'mode-own-lantern-ward-r5', name: 'Lantern Ward', modifiers: [{ value: 1, type: 'status', target: 'ac' }] };
    const base = saved('p14', 'Hollis Wren');
    const app = await openFresh([{ ...base, play: { ...base.play!, activeModes: [OWN_MODE.id] } } as SavedChar], OWN_MODE);
    await openModeEditor(app, OWN_MODE.name);
    expect(document.querySelector('.me-delete')?.textContent?.trim(), 'a plain Delete').toBe('Delete');
    setInput(document.querySelector<HTMLInputElement>('.me-val')!, '2');
    press(document.querySelector('.mode-editor .btn-primary'));
    await wait(50);
    expect(Object.keys(loadModes()), 'edited in place: no copy').toEqual([OWN_MODE.id]);
    expect(loadModes()[OWN_MODE.id].modifiers[0].value).toBe(2);

    await openModeEditor(app, OWN_MODE.name);
    press(document.querySelector('.me-delete'));
    await wait(50);
    expect(loadModes()[OWN_MODE.id], 'deleted from their saved modes').toBeUndefined();
    expect(loadTombstones()[`mode:${OWN_MODE.id}`], 'with its tombstone, as ever').toBeGreaterThan(0);
  }, APP_TIMEOUT);
});

describe('(R4) the player’s own Pinned list: a pin of a GM-given record still opens it', () => {
  it('the reopened card resolves the carried record (its book, "Homebrew"), not an unknown one', async () => {
    /*
     * 2026-10-20, checker finding N2: every description popup keeps PinStar, and a pin is its `bucket:id`. On the
     * player's own sheet the card resolves through App's ContentContext — this character's own view, its carried
     * records included.
     * mutation-proof: give App's own-sheet `<ContentContext.Provider value={ownDb}>` the plain `readyContent`
     * (src/App.tsx) and this goes red: the reopened card knows no such record ("Not from the Archives").
     */
    const withGift = withGmChanges(saved('p11', 'Lio Sandoval'));
    const pin: PinnedDesc = { title: GM_ITEM.name, description: 'The words saved with the pin.', key: 'items', slug: GM_ITEM.id, mode: 'mine' };
    const pinned = { ...withGift, play: { ...withGift.play!, pinnedDescs: [pin] } } as SavedChar;
    const entry = withCarriedAttached(pinned, foreignContent(gmDb, pinned));
    expect(carriedIds(entry), 'fixture: the roster entry carries the GM’s item').toContain(`items:${GM_ITEM.id}`);
    const app = await openApp([entry]);
    app.tab('Main');
    const open = app.host.querySelector<HTMLElement>(`.pinned-desc-open[title="Open ${GM_ITEM.name}"]`);
    expect(open, 'fixture: the pin is listed').not.toBeNull();
    press(open);
    await wait(100);
    const card = [...document.querySelectorAll<HTMLElement>('.card-body')].find((e) => (e.textContent ?? '').includes('The words saved with the pin.'));
    expect(card, 'fixture: the card opened').toBeTruthy();
    expect(card!.querySelector('[data-ours-kind="noPage"]')?.textContent, 'the record resolved: a homebrew record').toBe('Homebrew');
    expect(card!.textContent, 'its book, read off the carried record').toContain('GM Book');
  }, APP_TIMEOUT);
});
