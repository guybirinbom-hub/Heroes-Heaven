// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect, useRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content } from './_content';
import type { SavedChar } from '../src/data/storage';
import type { BuildState } from '../src/rules/build';
import type { ContentDatabase, InventoryItem } from '../src/rules/types';

/**
 * OWNER RULING 2026-10-20 (Guy): "i dont want it in the homebrew and also its a problem that when the gm
 * or players view another character they see custom items as unknown items, the others should see the
 * same item as the player".
 *
 * A player's custom records — an item, a feat, a cantrip, a deity, all made on THEIR device — now ride
 * along on the sheet they publish (`SavedChar.carried`, src/data/carried.ts), and every other view of
 * that sheet draws them from there:
 *   (A) a teammate's read-only view (PartyMembers useMemberViewer),
 *   (B) the GM's edit sheet (GmEditSheet),
 *   (C) the GM's push carries them, plus anything HE made in their sheet, to the player's device — the
 *       gm_character_edits row and the pending overlay holding the same object,
 *   (D) and which copy of a record rode along is never "the player changed this" (F1 neutrality).
 * Not through campaign homebrew: nothing here touches a homebrew store.
 *
 * Every character and record here is synthetic.
 */

const server = vi.hoisted(() => ({
  /** `campaign_characters`, keyed campaign|char. */
  chars: new Map<string, Record<string, unknown>>(),
  /** `gm_character_edits`, keyed campaign|char. */
  edits: new Map<string, Record<string, unknown>>(),
  editWrites: [] as Record<string, unknown>[],
}));

vi.mock('../src/data/supabase', () => {
  const rows = (table: string): Record<string, unknown>[] => [...(table === 'campaign_characters' ? server.chars : server.edits).values()];
  function from(table: string) {
    const where: Record<string, unknown> = {};
    const matched = () => rows(table).filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
    const answer = () => ({ data: matched(), error: null });
    const q = {
      select: () => q,
      eq: (col: string, val: unknown) => {
        where[col] = val;
        return q;
      },
      order: () => Promise.resolve(answer()),
      maybeSingle: () => Promise.resolve({ data: matched()[0] ?? null, error: null }),
      then: (ok: (v: { data: unknown; error: unknown }) => unknown) => Promise.resolve(answer()).then(ok),
      upsert: (row: Record<string, unknown>) => {
        const key = `${row.campaign_id as string}|${row.char_id as string}`;
        if (table === 'campaign_characters') server.chars.set(key, row);
        else {
          server.edits.set(key, row);
          server.editWrites.push(row);
        }
        return Promise.resolve({ error: null });
      },
      delete: () => q,
    };
    return q;
  }
  const channel = {
    on: () => channel,
    subscribe(cb?: (s: string) => void) {
      cb?.('SUBSCRIBED');
      return channel;
    },
  };
  return {
    supabase: {
      from,
      channel: () => channel,
      removeChannel: () => undefined,
      auth: {
        getSession: async () => ({ data: { session: { user: { id: 'gm-1' } } } }),
        getUser: async () => ({ data: { user: { id: 'gm-1' } } }),
        signOut: async () => ({ error: null }),
      },
    },
    isCloudSyncEnabled: true,
    isCloudConfigured: true,
  };
});

const { computeSummary } = await import('../src/sheet/partySummary');
const { applyPlayState, initialPlay } = await import('../src/rules/play');
const { buildCharacter, emptyBuild } = await import('../src/rules/build');
const { fetchPublishedSheet, forgetMissingColumns, pushGmEdit } = await import('../src/data/party');
const { clearGmPendingEdits, gmBaseOf, gmPendingEdit } = await import('../src/sheet/gmSync');
const { collectCarried, foreignContent } = await import('../src/data/carried');
const { loadHomebrewContent } = await import('../src/data/storage');
const { GmEditSheet } = await import('../src/sheet/GmEditSheet');
const { getPrefs, setPref } = await import('../src/data/prefs');
const { useMemberViewer } = await import('../src/sheet/PartyMembers');

const db = content();
const CAMPAIGN = 'camp-carry';
const PLAYER = 'player-1';
const CHAR = 'pc-carry';
const AT = '2026-10-20T10:00:00.000Z';

const HB = { license: 'homebrew', book: 'Ashfall Notes' } as const;
/** The PLAYER's own records — made on their device; the GM's database (`db`) has none of them. */
const ITEM = {
  id: 'custom-cinder-locket-t7',
  name: 'Cinder Locket',
  itemType: 'equipment',
  level: 1,
  bulk: 0.1,
  traits: [],
  rarity: 'common',
  price: { gp: 5 },
  description: 'A locket that stays warm.',
  source: HB,
};
const FEAT = {
  id: 'hb-feat-ashborn-grit',
  name: 'Ashborn Grit',
  level: 1,
  category: 'ancestry',
  traits: ['human'],
  rarity: 'common',
  description: 'Smoke does not trouble you.',
  source: HB,
};
const SPELL = {
  id: 'hb-spell-ember-thread',
  name: 'Ember Thread',
  rank: 0,
  traditions: ['arcane', 'divine', 'occult', 'primal'],
  traits: ['cantrip', 'concentrate', 'manipulate'],
  rarity: 'common',
  cast: { type: 'actions', value: 2 },
  description: 'A thread of fire.',
  source: HB,
};
const DEITY = {
  id: 'hb-deity-vael',
  name: 'Vael of the Low Fires',
  traits: [],
  rarity: 'common',
  description: 'Keeper of banked coals.',
  source: HB,
  divineFont: ['heal'],
  domains: ['fire'],
};
/** The PLAYER's database: the GM's plus their own four records. */
const ownerDb = {
  ...db,
  items: { ...db.items, [ITEM.id]: ITEM },
  feats: { ...db.feats, [FEAT.id]: FEAT },
  spells: { ...db.spells, [SPELL.id]: SPELL },
  deities: { ...db.deities, [DEITY.id]: DEITY },
} as unknown as ContentDatabase;

/** A level-1 sorcerer who follows the player's own deity, took their own feat, knows their own cantrip and
 *  carries their own item — published the way App's publish does (src/App.tsx): `carried` collected
 *  from the player's view of the sheet. `withCarried: false` is the sheet before this fix. */
function playerSheet(opts: { withCarried?: boolean } = {}): SavedChar {
  const cls = db.classes.sorcerer;
  const build = {
    ...emptyBuild(),
    name: 'Ysolde Marrow',
    level: 1,
    classId: 'sorcerer',
    subclassId: cls.subclass?.options[0]?.id ?? null,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: 'acolyte',
    keyAbility: 'cha',
    deityId: DEITY.id,
    cantrips: [SPELL.id],
    featPicks: { '1:ancestry:0': FEAT.id },
  } as BuildState;
  const character = buildCharacter(build, ownerDb);
  const inv = { instanceId: 'loc-1', itemId: ITEM.id, quantity: 1 } as InventoryItem;
  const play = { ...initialPlay(character, ownerDb), inventory: [inv] };
  const sc = { id: CHAR, character, build, play } as SavedChar;
  if (opts.withCarried === false) return sc;
  const carried = collectCarried(sc, ownerDb);
  return { ...sc, ...(carried ? { carried } : {}) };
}

/** What the player's app publishes: summary + sheet, in one row. */
function publish(sc: SavedChar, at = AT): void {
  const live = applyPlayState(sc.character, sc.play, ownerDb);
  server.chars.set(`${CAMPAIGN}|${sc.id}`, {
    campaign_id: CAMPAIGN,
    owner_id: PLAYER,
    char_id: sc.id,
    name: live.name,
    summary: computeSummary(live, ownerDb),
    sheet: sc,
    updated_at: at,
  });
}

/** A teammate's read-only view of the character (the GM's database: none of the player's records). */
function Viewer(): ReactElement {
  const { sheetEl, open } = useMemberViewer(db);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void open(CAMPAIGN, CHAR, PLAYER);
  });
  return <div>{sheetEl}</div>;
}

const gmSheet = (sheet: SavedChar, live: SavedChar = sheet, gmDb: ContentDatabase = db) => (
  <GmEditSheet initial={sheet} live={live} content={gmDb} campaignId={CAMPAIGN} playerOwnerId={PLAYER} onExit={() => undefined} />
);

let root: Root | null = null;
function render(el: ReactElement): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
}
function rerender(el: ReactElement): void {
  act(() => root!.render(el));
}
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
/** The newest `gm_character_edits` write — `[length - 1]`, not `.at(-1)`: the repo's tsconfig lib is ES2020
 *  (round 3, 2026-10-20, finding N-d: the carried tests type-check clean). */
const lastWrite = () => server.editWrites[server.editWrites.length - 1];
const buttonByText = (scope: ParentNode, text: string) =>
  [...scope.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === text) as HTMLButtonElement | undefined;
async function tab(host: HTMLElement, label: string): Promise<string> {
  const b = buttonByText(host, label);
  expect(b, `fixture: the sheet's ${label} tab`).toBeTruthy();
  act(() => b!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await settle();
  return host.textContent ?? '';
}
/** Inventory, Feats, Spells and Details — what each says about the four records. */
async function readFour(host: HTMLElement) {
  const inventory = await tab(host, 'Inventory');
  const feats = await tab(host, 'Feats & features');
  const spells = await tab(host, 'Spells');
  const details = await tab(host, 'Details');
  return { inventory, feats, spells, details };
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
  if (!window.matchMedia)
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
  server.chars.clear();
  server.edits.clear();
  server.editWrites.length = 0;
  forgetMissingColumns();
  clearGmPendingEdits();
  setPref('pinnedModes', []); // device prefs live in the module, not only in localStorage
  localStorage.clear();
});

describe('fixture', () => {
  it('the player sheet uses all four records and the GM database has none of them', () => {
    const sc = playerSheet();
    for (const [bucket, id] of [['items', ITEM.id], ['feats', FEAT.id], ['spells', SPELL.id], ['deities', DEITY.id]] as const)
      expect((db[bucket] as Record<string, unknown>)[id], `the GM lacks ${id}`).toBeUndefined();
    expect(sc.character.feats.map((f) => f.featId), 'the feat is taken').toContain(FEAT.id);
    expect(sc.character.spellcasting.flatMap((e) => e.cantrips ?? []), 'the cantrip is known').toContain(SPELL.id);
    expect(sc.character.details.deityId).toBe(DEITY.id);
    expect(Object.keys(sc.carried ?? {}).sort(), 'all four ride along').toEqual(['deities', 'feats', 'items', 'spells']);
  });
});

describe('(A) a teammate sees the same records the player does', () => {
  it('the read-only view names the item, the feat, the cantrip and the deity — no "Unknown item"', async () => {
    // mutation-proof: drop `foreignContent(content, viewing.sheet)` from PartyMembers' read-only view (use
    // `content`) and this goes red: "Unknown item", the feat and the cantrip gone, the deity a raw id.
    publish(playerSheet());
    const host = render(<Viewer />);
    await settle();
    await settle();
    const seen = await readFour(host);
    expect(seen.inventory).toContain(ITEM.name);
    expect(seen.inventory).not.toContain('Unknown item');
    expect(seen.feats).toContain(FEAT.name);
    // (The fixture knows one cantrip, so its other openings read "Empty cantrip" legitimately; the
    // defect was the KNOWN one dropping off.)
    expect(seen.spells).toContain(SPELL.name);
    expect(seen.details).toContain(DEITY.name);
    expect(loadHomebrewContent().items[ITEM.id], 'never written into the viewer’s homebrew').toBeUndefined();
  }, 120_000);

  it('the planted bad case: the same sheet WITHOUT carried shows the defect the ruling names', async () => {
    publish(playerSheet({ withCarried: false }));
    const host = render(<Viewer />);
    await settle();
    await settle();
    const seen = await readFour(host);
    expect(seen.inventory, 'the instrument sees the defect').toContain('Unknown item');
    expect(seen.feats).not.toContain(FEAT.name);
    expect(seen.spells).not.toContain(SPELL.name);
    expect(seen.details).not.toContain(DEITY.name);
  }, 120_000);
});

describe('(B) the GM edit sheet draws the player’s records', () => {
  it('names the item, the feat, the cantrip and the deity', async () => {
    // mutation-proof: make GmEditSheet's `viewContent` plain `content` (no foreignContent) and this goes red.
    const host = render(gmSheet(playerSheet()));
    await settle();
    const seen = await readFour(host);
    expect(seen.inventory).toContain(ITEM.name);
    expect(seen.inventory).not.toContain('Unknown item');
    expect(seen.feats).toContain(FEAT.name);
    expect(seen.spells).toContain(SPELL.name);
    expect(seen.details).toContain(DEITY.name);
  }, 120_000);

  it("the player's copy wins over the GM's own homebrew of the same id", async () => {
    const gmOwn = { ...ITEM, name: 'Cinder Locket (GM draft)' };
    const gmDb = { ...db, items: { ...db.items, [ITEM.id]: gmOwn } } as unknown as ContentDatabase;
    const host = render(gmSheet(playerSheet(), playerSheet(), gmDb));
    await settle();
    const inventory = await tab(host, 'Inventory');
    expect(inventory).toContain('Cinder Locket');
    expect(inventory).not.toContain('GM draft');
  }, 120_000);
});

describe('(C) the GM’s push carries the records', () => {
  const GM_ITEM = {
    id: 'custom-gm-salt-charm-k2',
    name: 'Salt Charm',
    itemType: 'equipment',
    level: 1,
    bulk: 0,
    traits: [],
    rarity: 'common',
    price: { gp: 2 },
    description: 'The GM made this one.',
    source: { license: 'homebrew', book: 'GM Book' },
  };
  const gmDb = { ...db, items: { ...db.items, [GM_ITEM.id]: GM_ITEM } } as unknown as ContentDatabase;

  it('pushGmEdit with the GM content: the row and the pending overlay hold the same sheet, carrying his item and theirs', async () => {
    // mutation-proof: drop the `withCarriedAttached(...)` in pushGmEdit (src/data/party.ts; send `sheet`) and
    // this goes red (the GM's Salt Charm reaches the player as an id with no record).
    const published = playerSheet();
    publish(published);
    const gift = { instanceId: 'gift-1', itemId: GM_ITEM.id, quantity: 1 } as InventoryItem;
    const edited = { ...published, play: { ...published.play!, inventory: [...published.play!.inventory!, gift] } } as SavedChar;
    const res = await pushGmEdit(CAMPAIGN, CHAR, PLAYER, edited, gmBaseOf(await fetchPublishedSheet(CAMPAIGN, CHAR)), null, gmDb);
    expect(res.ok, 'fixture: the push went').toBe(true);
    const row = lastWrite();
    const sent = row.sheet as SavedChar;
    expect(Object.keys(sent.carried?.items ?? {}).sort()).toEqual([GM_ITEM.id, ITEM.id].sort());
    expect(sent.carried?.items?.[GM_ITEM.id]?.name).toBe('Salt Charm');
    expect(sent.carried?.feats?.[FEAT.id]?.name, 'what the player carried goes back with it').toBe(FEAT.name);
    expect(gmPendingEdit(CAMPAIGN, CHAR)?.sheet, 'the overlay holds the very sheet the row does').toBe(sent);
    expect(loadHomebrewContent().items[ITEM.id], 'the player’s records never land in the GM’s homebrew').toBeUndefined();
  });

  it('a push without content (direct callers) sends the sheet as given', async () => {
    const published = playerSheet({ withCarried: false });
    publish(published);
    await pushGmEdit(CAMPAIGN, CHAR, PLAYER, published, gmBaseOf(await fetchPublishedSheet(CAMPAIGN, CHAR)), null);
    expect(lastWrite().sheet).toBe(published);
  });

  it("the GM sheet's Update sends the player's records along (GmEditSheet passes its content)", async () => {
    // mutation-proof: drop the trailing `content` argument from GmEditSheet's pushGmEdit call and this goes
    // red (the sheet still carries the player's own records, but not as collected from the GM's view —
    // here the sheet he opened carried nothing, so nothing would go).
    const bare = playerSheet({ withCarried: false });
    publish(bare);
    // The GM opened a sheet carrying nothing, with the player's records in HIS database (an older
    // player app, records he got another way): the push carries them from his view.
    const host = render(gmSheet(bare, bare, ownerDb));
    await settle();
    const pip = host.querySelector<HTMLButtonElement>('button[aria-label^="Set hero points to"]');
    expect(pip, 'fixture: the GM sheet can be edited').not.toBeNull();
    act(() => pip!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle();
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.gm-update-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    await settle();
    const confirm = buttonByText(document.querySelector('.confirm-modal') ?? document, 'Update');
    expect(confirm, 'fixture: the Update confirm').toBeTruthy();
    await act(async () => {
      confirm!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    await settle();
    await settle();
    expect(server.editWrites, 'fixture: one push').toHaveLength(1);
    const sent = server.editWrites[0].sheet as SavedChar;
    expect(Object.keys(sent.carried ?? {}).sort()).toEqual(['deities', 'feats', 'items', 'spells']);
  }, 120_000);
});

describe('(D) which copy of a record rode along is never “the player changed this”', () => {
  it('a dirty GM sheet: a republish that changes only `carried` raises no banner; a real change does', async () => {
    // mutation-proof: compare `canonicalJson(live)` / `canonicalJson(work)` (not `sheetKey`) in GmEditSheet's
    // reconcile and this goes red: the banner says the player changed the character.
    const first = playerSheet();
    const host = render(gmSheet(first));
    await settle();
    const pip = host.querySelector<HTMLButtonElement>('button[aria-label^="Set hero points to"]');
    act(() => pip!.dispatchEvent(new MouseEvent('click', { bubbles: true }))); // the GM's unsent edit
    await settle();
    // The player edited their locket's description and republished: the same character.
    const recarried = { ...first, carried: { ...first.carried, items: { [ITEM.id]: { ...ITEM, description: 'Warmer now.' } } } } as SavedChar;
    rerender(gmSheet(first, recarried));
    await settle();
    expect(host.querySelector('.gm-live-banner'), 'no "changed on the player’s device"').toBeNull();
    // The positive control: the player really changed the character.
    const renamed = { ...recarried, character: { ...recarried.character, name: 'Ysolde Marrow-Vey' } } as SavedChar;
    rerender(gmSheet(first, renamed));
    await settle();
    expect(host.querySelector('.gm-live-banner'), 'fixture: a real change still raises it').not.toBeNull();
  }, 120_000);

  it('a clean GM sheet takes the newer copies silently, so it draws what the player sees', async () => {
    const first = playerSheet();
    const host = render(gmSheet(first));
    await settle();
    const renamedLocket = { ...ITEM, name: 'Cinder Locket of Embers' };
    const recarried = { ...first, carried: { ...first.carried, items: { [ITEM.id]: renamedLocket } } } as SavedChar;
    rerender(gmSheet(first, recarried));
    await settle();
    expect(host.querySelector('.gm-live-banner')).toBeNull();
    expect(await tab(host, 'Inventory')).toContain('Cinder Locket of Embers');
  }, 120_000);
});

describe("(E) the GM editing the player's carried item makes a copy that reaches the player", () => {
  /*
   * 2026-10-20, checker findings saving-C1 / coverage-F1 / semantics-C1. An in-place edit of a carried record
   * could reach nobody: which copy rides along is not authorship, so the push was 'settled' on the player's
   * device and never applied, the GM's overlay stood down at once, and his sheet went back to the player's
   * copy after telling him "Sent". On the GM's sheet a carried item is copy-on-write (src/sheet/CopyOnWriteItems.tsx):
   * the edit becomes a new record of his, the instance points at it, and that IS a change the player applies.
   */
  async function editLocket(host: HTMLElement, newName: string): Promise<void> {
    await tab(host, 'Inventory');
    const card = [...host.querySelectorAll<HTMLElement>('.inv-card')].find((e) => (e.textContent ?? '').includes(ITEM.name));
    expect(card, 'fixture: the locket’s inventory card').toBeTruthy();
    act(() => card!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle();
    const pencil = document.querySelector<HTMLElement>('[aria-label="Edit item"]');
    expect(pencil, 'fixture: the item detail offers Edit').not.toBeNull();
    act(() => pencil!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle();
    const name = document.querySelector<HTMLInputElement>('input[placeholder="e.g. Stormcaller blade"]');
    expect(name, 'fixture: the item editor').not.toBeNull();
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setValue.call(name, newName);
      name!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => document.querySelector<HTMLButtonElement>('.ci-save')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle();
  }
  async function pressUpdate(host: HTMLElement): Promise<void> {
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.gm-update-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    await settle();
    const confirm = buttonByText(document.querySelector('.confirm-modal') ?? document, 'Update');
    expect(confirm, 'fixture: the Update confirm').toBeTruthy();
    await act(async () => {
      confirm!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    await settle();
    await settle();
  }

  it('the push points the instance at his new record, carries it, and the player’s app APPLIES it', async () => {
    // mutation-proof: drop `&& !copyOnWrite?.has(item.id)` from ItemEditorModal's `editingHomebrew`
    // (src/sheet/ItemEditorModal.tsx) and this goes red: the edit keeps the locket's id, nothing is sent
    // that the player's app would apply, and the locket is still the player's copy.
    const { authoredKey, hash53 } = await import('../src/data/authored');
    const { gmEditVerdict } = await import('../src/sheet/gmSync');
    const published = playerSheet();
    publish(published);
    const host = render(gmSheet(published));
    await settle();
    await editLocket(host, 'Cinder Locket (re-forged)');
    expect(await tab(host, 'Inventory'), 'his edit shows on his sheet at once').toContain('Cinder Locket (re-forged)');
    await pressUpdate(host);
    expect(server.editWrites, 'one push').toHaveLength(1);
    const sent = server.editWrites[0].sheet as SavedChar;
    const row = sent.play!.inventory!.find((i) => i.instanceId === 'loc-1')!;
    expect(row.itemId, 'the instance points at a NEW record').not.toBe(ITEM.id);
    expect(sent.carried?.items?.[row.itemId]?.name, 'which the push carries').toBe('Cinder Locket (re-forged)');
    expect(sent.carried?.items?.[ITEM.id], "the player's own record, now unused here, no longer rides along").toBeUndefined();
    // The player's device: their published sheet is still the one he built on, and their roster entry is it.
    const gmBase = server.editWrites[0].gm_base as { v: 1; at: string; stamp: string; hash: string; on: null };
    expect(gmBase.hash).toBe(hash53(authoredKey(published)));
    const verdict = gmEditVerdict({ row: { updatedAt: String(server.editWrites[0].updated_at), sheet: sent, gmBase }, own: { sheet: published, updatedAt: AT }, local: published });
    expect(verdict, 'a real change to the sheet: applied, never "settled" unapplied').toBe('apply');
    expect(loadHomebrewContent().items[ITEM.id], "the player's record never lands in the GM's homebrew").toBeUndefined();
  }, 120_000);

  it("the Add-items list offers no Delete on the player's carried item (deleting it could reach nobody)", async () => {
    // mutation-proof: drop `&& !copyOnWrite?.has(it.id)` from AddItemsModal's delete control
    // (src/sheet/AddItemsModal.tsx) and this goes red.
    const { AddItemsModal } = await import('../src/sheet/AddItemsModal');
    const { CopyOnWriteItemsContext } = await import('../src/sheet/CopyOnWriteItems');
    const bookless = { ...ITEM, source: { license: 'homebrew' } }; // no book: offered whatever books are on
    const small = { ...db, items: { [bookless.id]: bookless } } as unknown as ContentDatabase;
    const list = (ids: ReadonlySet<string> | null) => (
      <CopyOnWriteItemsContext.Provider value={ids}>
        <AddItemsModal
          content={small}
          currency={{ pp: 0, gp: 100, sp: 0, cp: 0 }}
          onBuy={() => undefined}
          onGive={() => undefined}
          onSaveItem={() => undefined}
          onClose={() => undefined}
        />
      </CopyOnWriteItemsContext.Provider>
    );
    const host = render(list(null));
    await settle();
    expect(host.querySelector(`[aria-label="Delete ${ITEM.name}"]`), 'fixture: an authored item offers Delete elsewhere').not.toBeNull();
    rerender(list(new Set([bookless.id])));
    await settle();
    expect(host.querySelector(`[aria-label="Delete ${ITEM.name}"]`)).toBeNull();
  });
});

describe("(F) the GM editing a MODE the player's sheet carries makes a copy that reaches the player", () => {
  /*
   * 2026-10-20, checker findings saving-R2-chk-2 / coverage-R2-gm-mode-edit-dead. In place, the GM's edit of a
   * carried mode went into HIS saved modes under the player's id, the sheet kept drawing the carried copy (it
   * wins in a foreign view), and the push sent the old one: the edit never showed and never reached the player,
   * and the player's mode landed in his synced modes. Delete did nothing visible. Like a carried item, the edit
   * is now a COPY under a new id, the sheet's active mode repointed to it (src/sheet/GmEditSheet.tsx saveModeDef),
   * and the Modes panel offers no Delete for it (CopyOnWriteModesContext).
   */
  const MODE = { id: 'mode-player-brace-f1', name: 'Shield Brace', modifiers: [{ value: 2, type: 'status', target: 'ac' }] };
  const modeDb = { ...ownerDb, modes: { ...ownerDb.modes, [MODE.id]: MODE } } as unknown as ContentDatabase;
  function braced(): SavedChar {
    const base = playerSheet({ withCarried: false });
    const sc = { ...base, play: { ...base.play!, activeModes: [MODE.id] } } as SavedChar;
    return { ...sc, carried: collectCarried(sc, modeDb) } as SavedChar;
  }
  const click = (el: Element | null | undefined) => act(() => void el!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  async function openModeEditor(host: HTMLElement): Promise<void> {
    await tab(host, 'Main');
    const add = [...host.querySelectorAll<HTMLButtonElement>('button.add-btn')].find((b) => (b.textContent ?? '').trim() === 'Add');
    expect(add, 'fixture: the conditions Add button').toBeTruthy();
    click(add);
    await settle();
    click(buttonByText(document, 'Modes'));
    await settle();
    const row = [...document.querySelectorAll<HTMLElement>('.mode-row')].find((r) => (r.textContent ?? '').includes(MODE.name));
    expect(row, 'fixture: the carried mode is listed').toBeTruthy();
    click(row!.querySelector('.mode-edit'));
    await settle();
    expect(document.querySelector('.mode-editor'), 'fixture: the mode editor').not.toBeNull();
  }

  it('the push carries his copy under a new id, the sheet points at it, and nothing of the player’s lands in his modes', async () => {
    // mutation-proof: drop the `if (copyOnWriteModes.has(mode.id)) { … }` branch from GmEditSheet's saveModeDef
    // (src/sheet/GmEditSheet.tsx) and this goes red: the player's id is saved into the GM's modes, and the push
    // still sends the +2 copy under it.
    const saves: { id: string; value: number }[] = [];
    const sc = braced();
    expect(Object.keys(sc.carried?.modes ?? {}), 'fixture: the sheet carries the mode').toEqual([MODE.id]);
    publish(sc);
    setPref('pinnedModes', [MODE.id]); // the GM pinned the carried mode to the top of the panel
    const host = render(
      <GmEditSheet
        initial={sc}
        live={sc}
        content={db}
        campaignId={CAMPAIGN}
        playerOwnerId={PLAYER}
        onSaveMode={(m) => saves.push({ id: m.id, value: m.modifiers[0]?.value })}
        onExit={() => undefined}
      />,
    );
    await settle();
    await openModeEditor(host);
    expect(document.querySelector('.me-delete'), 'no Delete: it is not his to delete').toBeNull();
    const val = document.querySelector<HTMLInputElement>('.me-val')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setValue.call(val, '3');
      val.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(document.querySelector('.mode-editor .btn-primary'));
    await settle();
    expect(saves, 'his own copy, never the player’s id').toHaveLength(1);
    expect(saves[0].id).not.toBe(MODE.id);
    expect(saves[0].value).toBe(3);
    // mutation-proof: drop `carryModePin(old, copy.id)` from GmEditSheet's saveModeDef (src/sheet/GmEditSheet.tsx)
    // and this goes red: his copy, under its fresh id, falls out of the pinned group (2026-10-20, r3-R3-pin-lost-on-copy).
    expect(getPrefs().pinnedModes, 'the pin goes with the copy').toContain(saves[0].id);
    click(document.querySelector('.picker-close'));
    await settle();

    await act(async () => {
      host.querySelector<HTMLButtonElement>('.gm-update-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    await settle();
    const confirm = buttonByText(document.querySelector('.confirm-modal') ?? document, 'Update');
    expect(confirm, 'fixture: the edit marked the sheet changed (Update asks)').toBeTruthy();
    await act(async () => {
      confirm!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    await settle();
    await settle();
    expect(server.editWrites, 'one push').toHaveLength(1);
    const sent = server.editWrites[0].sheet as SavedChar;
    expect(sent.play?.activeModes, 'the sheet points at his copy').toEqual([saves[0].id]);
    expect(sent.carried?.modes?.[saves[0].id]?.modifiers[0].value, 'which the push carries').toBe(3);
    expect(sent.carried?.modes?.[MODE.id], 'the player’s mode, now off, no longer rides along').toBeUndefined();
    // The player's device draws the sheet with it: +3, not +2.
    const live = applyPlayState(sent.character, sent.play, foreignContent(ownerDb, sent));
    expect((live.activeModes ?? []).map((m) => m.modifiers[0]?.value)).toEqual([3]);
  }, 120_000);

  it('a mode the GM made himself and does not carry here keeps Edit in place and Delete', async () => {
    // The positive control for the panel: CopyOnWriteModesContext holds only carried ids.
    const { ModesPanel } = await import('../src/sheet/ModesPanel');
    const { CopyOnWriteModesContext } = await import('../src/sheet/CopyOnWriteItems');
    const own = { id: 'mode-gm-own-f2', name: 'Lookout', modifiers: [{ value: 1, type: 'status', target: 'perception' }] };
    const panel = (ids: ReadonlySet<string> | null) => (
      <CopyOnWriteModesContext.Provider value={ids}>
        <ModesPanel library={[own as never]} predefined={[]} catalog={[]} activeIds={[own.id]} onToggle={() => undefined} onSave={() => undefined} onDelete={() => undefined} />
      </CopyOnWriteModesContext.Provider>
    );
    // mutation-proof: drop `&& !copyOnWrite?.has(editing.id)` from ModesPanel's onDelete (src/sheet/ModesPanel.tsx)
    // and the second half goes red.
    const host = render(panel(null));
    click(host.querySelector('.mode-edit'));
    await settle();
    expect(document.querySelector('.me-delete'), 'fixture: his own mode offers Delete').not.toBeNull();
    rerender(panel(new Set([own.id])));
    await settle();
    expect(document.querySelector('.me-delete'), 'a carried one does not').toBeNull();
  });
});

describe("(G) round 3: a GM's push keeps the fill-only marks of the sheet it was built on", () => {
  /*
   * 2026-10-20, final finding N-b. The player's publish to a campaign marks the records that campaign's shared
   * homebrew gives its members FILL-only (src/data/carried.ts carriedForCampaign): the GM holds them himself, so
   * on his views his own record wins. pushGmEdit re-collected `carried` without the marks, and while the push
   * waited (the pending overlay hands back the pushed sheet) the pushed copy of HIS shared record won on his own
   * views of that PC: he edited the record and his view of the character still drew the old text.
   */
  const LAMP = {
    id: 'custom-gm-shared-tide-lamp-g1',
    name: 'Tide Lamp',
    itemType: 'equipment',
    level: 0,
    bulk: 0,
    traits: [],
    rarity: 'common',
    description: 'Shared by the GM in this campaign.',
    source: { license: 'homebrew', book: 'GM Book' },
  };
  /** The GM's read-only view of the character, against HIS database: the read overlays his pending push. */
  function GmViewer({ gmDb }: { gmDb: ContentDatabase }): ReactElement {
    const { sheetEl, open } = useMemberViewer(gmDb);
    const started = useRef(false);
    useEffect(() => {
      if (started.current) return;
      started.current = true;
      void open(CAMPAIGN, CHAR, PLAYER);
    });
    return <div>{sheetEl}</div>;
  }

  it('his later edit of his shared record shows on his view of that PC while the push waits; a device without it still resolves it', async () => {
    // mutation-proof: drop the `fillFor(fillKeys(sheet.carried), …)` re-marking from withCarriedAttached
    // (src/data/carried.ts) and this goes red: the pushed sheet carries the lamp as a WINNING copy, and his view
    // of the character draws "Tide Lamp" over his "Tide Lamp (relit)".
    const { carriedForCampaign, keepCarried, ownContent } = await import('../src/data/carried');
    const { fetchMemberSheet } = await import('../src/data/party');
    const base = playerSheet();
    const lampRow = { instanceId: 'lamp-1', itemId: LAMP.id, quantity: 1 } as InventoryItem;
    const sc = { ...base, play: { ...base.play!, inventory: [...base.play!.inventory!, lampRow] } } as SavedChar;
    // The player's view holds the lamp from this campaign's shared homebrew, and their publish marks it.
    const playerView = { ...ownerDb, items: { ...ownerDb.items, [LAMP.id]: LAMP } } as unknown as ContentDatabase;
    const carried = carriedForCampaign(collectCarried(sc, playerView), CAMPAIGN, new Map([[`items:${LAMP.id}`, CAMPAIGN]]));
    const published = { ...sc, carried } as SavedChar;
    expect(published.carried?.fill, 'fixture: the lamp goes fill-only to the campaign that shares it').toEqual([`items:${LAMP.id}`]);
    publish(published);

    // The GM (his database holds his shared lamp) gives the character a hero point and presses Update.
    const gmDb = { ...db, items: { ...db.items, [LAMP.id]: LAMP } } as unknown as ContentDatabase;
    const edited = { ...published, play: { ...published.play!, heroPoints: 3 } } as SavedChar;
    const res = await pushGmEdit(CAMPAIGN, CHAR, PLAYER, edited, gmBaseOf(await fetchPublishedSheet(CAMPAIGN, CHAR)), null, gmDb);
    expect(res.ok, 'fixture: the push went').toBe(true);
    const sent = lastWrite().sheet as SavedChar;
    expect(sent.carried?.items?.[LAMP.id]?.name, 'fixture: the push carries the lamp').toBe('Tide Lamp');
    expect(sent.carried?.fill, 'the lamp stays fill-only in the push').toEqual([`items:${LAMP.id}`]);
    expect(await fetchMemberSheet(CAMPAIGN, CHAR), 'fixture: his reads of the character are the waiting push').toBe(sent);

    // Then he edits his shared lamp. His view of that PC, while the push waits, draws HIS lamp.
    const relit = { ...LAMP, name: 'Tide Lamp (relit)' };
    const gmEdited = { ...db, items: { ...db.items, [LAMP.id]: relit } } as unknown as ContentDatabase;
    const host = render(<GmViewer gmDb={gmEdited} />);
    await settle();
    await settle();
    expect(await tab(host, 'Inventory'), 'his own current record').toContain('Tide Lamp (relit)');

    // The player's device, should it lack the lamp (it has not pulled the share yet): the push fills the gap.
    const kept = keepCarried(sent, db, { deleted: {}, revived: {} });
    expect(Object.keys(kept.carried?.items ?? {}), 'the roster keeps the copy it cannot resolve itself').toContain(LAMP.id);
    expect(ownContent(db, kept, { deleted: {}, revived: {} }).items[LAMP.id]?.name).toBe('Tide Lamp');
    expect(foreignContent(db, sent).items[LAMP.id]?.name, 'and any view without it').toBe('Tide Lamp');
  }, 120_000);
});

describe('the card summary a GM device works out (memberCardSummary)', () => {
  it("counts a carried item's Bulk: the player's own anvil makes them Encumbered on the GM device too", async () => {
    // mutation-proof: use `content` instead of `foreignContent(content, sheet)` in memberSheets.memberCardSummary
    // (and livePlay) and this goes red: the GM device cannot weigh an item it has no record of.
    const { memberCardSummary } = await import('../src/sheet/memberSheets');
    const ANVIL = { ...ITEM, id: 'custom-pocket-anvil-z1', name: 'Pocket Anvil', bulk: 20 };
    const heavyDb = { ...ownerDb, items: { ...ownerDb.items, [ANVIL.id]: ANVIL } } as unknown as ContentDatabase;
    const base = playerSheet();
    const anvil = { instanceId: 'anvil-1', itemId: ANVIL.id, quantity: 1 } as InventoryItem;
    const sc = { ...base, play: { ...base.play!, inventory: [...base.play!.inventory!, anvil] } } as SavedChar;
    const sent = { ...sc, carried: collectCarried(sc, heavyDb) } as SavedChar;
    const conds = (s: { conditions: { name?: string; id?: string }[] }) => s.conditions.map((c) => c.name ?? c.id);
    expect(conds(computeSummary(applyPlayState(sc.character, sc.play, heavyDb), heavyDb)), "fixture: the player's own app says Encumbered").toContain('Encumbered');
    // A member row whose published summary says nothing (an older summary): the GM device works it out.
    const mem = { ownerId: PLAYER, charId: CHAR, name: 'Ysolde Marrow', summary: computeSummary(base.character, db) };
    expect(conds(memberCardSummary(mem as never, sent, db))).toContain('Encumbered');
    expect(foreignContent(db, sent).items[ANVIL.id]?.bulk).toBe(20);
  });
});
