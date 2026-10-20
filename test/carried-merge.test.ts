import { describe, expect, it } from 'vitest';
import {
  carriedForCampaign,
  foreignCarriedIds,
  foreignContent,
  keepCarried,
  normalizeCarried,
  partyContent,
  publishKey,
  repointMode,
  sharedOrigins,
  withCarried,
  withCarriedAttached,
  withoutCarried,
  type Carried,
  type OwnTombstones,
} from '../src/data/carried';
import { CATALOG_MODES } from '../src/rules/modes';
import type { CampaignHbCampaign } from '../src/data/storage';
import type { ContentDatabase } from '../src/rules/types';

/**
 * Owner ruling 2026-10-20 (Guy): "the others should see the same item as the player". A sheet's carried
 * records are merged into the database it is VIEWED against (src/data/carried.ts withCarried) — per
 * sheet, never a global layer. These legs pin who wins:
 *  - 'own' (this device's own character): the player's own homebrew always wins; carried only fills a
 *    gap; a record the player DELETED stays deleted (ruling 2026-09-12 #7) until revived.
 *  - 'foreign' (somebody else's sheet): the carried copy wins over the viewer's own homebrew of that id,
 *    never over a printed record, and the viewer's own tombstones are not applied.
 * And that the merged database is memoised: the same object for the same inputs, `content` itself when
 * nothing is added.
 *
 * Every record here is synthetic.
 */

const HB = { license: 'homebrew' } as const;
const PRINTED_ID = 'printed-rapier-q';
const isPrinted = (_t: string, id: string) => id === PRINTED_ID;

const mine = { id: 'hb-shared-cloak', name: 'Cloak (my version)', traits: [], source: HB };
const theirs = { id: 'hb-shared-cloak', name: 'Cloak (their version)', traits: [], source: HB };
const gift = { id: 'hb-gm-gift-amulet', name: 'Amulet of the Tide', traits: [], source: HB };
const printed = { id: PRINTED_ID, name: 'Rapier', traits: [], source: { license: 'ORC' } };
const fakePrinted = { id: PRINTED_ID, name: 'Rapier of Endless Wishes', traits: [], source: HB };

const base = (): ContentDatabase =>
  ({
    items: { [mine.id]: mine, [PRINTED_ID]: printed },
    feats: {},
    spells: {},
    ancestries: {},
    heritages: {},
    backgrounds: {},
    actions: {},
    deities: {},
  }) as unknown as ContentDatabase;

const sheetOf = (...recs: Record<string, unknown>[]) => ({
  carried: { items: Object.fromEntries(recs.map((r) => [r.id as string, r])) },
});

const noTombs: OwnTombstones = { deleted: {}, revived: {} };

describe('withCarried — who wins when a sheet carries a record', () => {
  it("own: the player's own record wins; a carried record only fills an id the device lacks", () => {
    // mutation-proof: drop `cur !== undefined ||` from the own-mode skip in withCarried and this goes red
    // (the carried copy would replace the player's own cloak).
    const db = base();
    const view = withCarried(db, sheetOf(theirs, gift), { mode: 'own', ownTombstones: noTombs, isPrinted });
    expect(view.items[mine.id].name).toBe('Cloak (my version)');
    expect(view.items[gift.id].name, 'a GM-made item a push brought fills the gap').toBe('Amulet of the Tide');
    expect(db.items[gift.id], 'the shared database is never written').toBeUndefined();
  });

  it("foreign: the owner's carried copy wins over the viewer's own homebrew of that id, and fills gaps", () => {
    // mutation-proof: make foreign mode skip whenever `cur !== undefined` (own's rule) and this goes red
    // (the GM would see HIS cloak on the player's sheet — the "unknown/other item" the ruling forbids).
    const view = foreignContent(base(), sheetOf(theirs, gift));
    expect(view.items[mine.id].name).toBe('Cloak (their version)');
    expect(view.items[gift.id].name).toBe('Amulet of the Tide');
  });

  it('neither mode ever replaces a printed record', () => {
    // mutation-proof: drop `|| isPrinted(type, id)` from the carried-record guard in withCarried and this goes red.
    for (const mode of ['own', 'foreign'] as const) {
      const view = withCarried(base(), sheetOf(fakePrinted), { mode, ownTombstones: noTombs, isPrinted });
      expect(view.items[PRINTED_ID].name, mode).toBe('Rapier');
    }
    // A printed id the viewer happens to lack (an older data file) is not filled from a sheet either.
    const lacking = { ...base(), items: {} } as unknown as ContentDatabase;
    expect(withCarried(lacking, sheetOf(fakePrinted), { mode: 'foreign', isPrinted }).items[PRINTED_ID]).toBeUndefined();
  });

  it('foreign: a carried record never lands over a viewer record under a book license', () => {
    // isPrinted says no (a printed id the viewer's index does not know), but the viewer's own record is a
    // book record: it stays.
    const view = withCarried(base(), sheetOf(fakePrinted), { mode: 'foreign', isPrinted: () => false });
    expect(view.items[PRINTED_ID].name).toBe('Rapier');
  });

  it("own: a record this account DELETED stays deleted; a later revive brings the carried copy back", () => {
    // mutation-proof: drop `|| tombstoned(opts.ownTombstones, type, id)` in withCarried and this goes red.
    const k = `hb:items:${gift.id}`;
    const deleted: OwnTombstones = { deleted: { [k]: 2000 }, revived: { [k]: 1000 } };
    expect(withCarried(base(), sheetOf(gift), { mode: 'own', ownTombstones: deleted, isPrinted }).items[gift.id]).toBeUndefined();
    const revived: OwnTombstones = { deleted: { [k]: 2000 }, revived: { [k]: 3000 } };
    expect(withCarried(base(), sheetOf(gift), { mode: 'own', ownTombstones: revived, isPrinted }).items[gift.id]?.name).toBe('Amulet of the Tide');
  });

  it("foreign: the viewer's own tombstones are not applied (a GM deleting his item never blanks a player's copy)", () => {
    const k = `hb:items:${gift.id}`;
    const deleted: OwnTombstones = { deleted: { [k]: 2000 }, revived: {} };
    expect(withCarried(base(), sheetOf(gift), { mode: 'foreign', ownTombstones: deleted, isPrinted }).items[gift.id]?.name).toBe('Amulet of the Tide');
  });

  it('a carried record gets a traits array and the homebrew license, like every record of the database', () => {
    const bare = { id: 'hb-bare-ring', name: 'Bare Ring' };
    const view = foreignContent(base(), { carried: { items: { [bare.id]: bare } } });
    expect(view.items[bare.id].traits).toEqual([]);
    expect(view.items[bare.id].source?.license).toBe('homebrew');
    // A record under the wrong key, or not a record, is ignored rather than guessed at.
    const b = base();
    const odd = foreignContent(b, { carried: { items: { 'hb-wrong-key': gift, 'hb-str': 'nope' } } });
    expect(odd, 'nothing usable: the database itself').toBe(b);
    expect((odd.items as Record<string, unknown>)['hb-wrong-key']).toBeUndefined();
    expect((odd.items as Record<string, unknown>)['hb-str']).toBeUndefined();
  });
});

describe('withCarried — the same object, so downstream memos hold', () => {
  it('returns `content` itself when the sheet carries nothing, or nothing new', () => {
    // mutation-proof: make withCarried always build `{ ...content }` and this goes red.
    const db = base();
    expect(foreignContent(db, {})).toBe(db);
    expect(foreignContent(db, null)).toBe(db);
    expect(withCarried(db, sheetOf(theirs), { mode: 'own', ownTombstones: noTombs, isPrinted }), 'own: only an id I already have').toBe(db);
  });

  it('a second call with the same content and the same carried object returns the same database', () => {
    // mutation-proof: drop the `byKey.set(key, db)` memo store in withCarried and this goes red.
    const db = base();
    const s = sheetOf(gift);
    const a = foreignContent(db, s);
    expect(a).not.toBe(db);
    expect(foreignContent(db, s)).toBe(a);
    expect(foreignContent(db, { carried: s.carried })).toBe(a);
  });

  it('a view of a view adds nothing (the same object back)', () => {
    const s = sheetOf(gift, theirs);
    const once = foreignContent(base(), s);
    expect(foreignContent(once, s)).toBe(once);
  });
});

describe('withCarried — MODES (round 2, 2026-10-20)', () => {
  /*
   * Checker finding coverage-F3: a custom mode that is on changed the player's AC, and every other view of
   * the sheet dropped it (applyPlayState skips an active id its `content.modes` lacks). Carried modes follow
   * the records' rules: own = this device's saved mode wins, a `mode:<id>` tombstone keeps a deleted one gone;
   * foreign = the carried mode wins over the viewer's own saved mode, never over a catalog or core mode.
   */
  const CATALOG_ID = CATALOG_MODES[0].id;
  const myMode = { id: 'mode-shared-id-m1', name: 'Brace (my version)', modifiers: [{ value: 1, type: 'status', target: 'ac' }] };
  const theirMode = { id: 'mode-shared-id-m1', name: 'Brace (their version)', modifiers: [{ value: 2, type: 'status', target: 'ac' }] };
  const gmMode = { id: 'mode-gm-made-m2', name: 'Harbor Watch', modifiers: [{ value: 1, type: 'circumstance', target: 'perception' }] };
  const fakeCatalog = { ...CATALOG_MODES[0], name: 'A catalog mode, rewritten', predefined: undefined };
  const modesBase = (): ContentDatabase =>
    ({ ...base(), modes: { [myMode.id]: myMode, [CATALOG_ID]: CATALOG_MODES[0] } }) as unknown as ContentDatabase;
  const carrying = (...modes: Record<string, unknown>[]) => ({ carried: { modes: Object.fromEntries(modes.map((m) => [m.id as string, m])) } });

  it("own: the device's saved mode wins, a carried one fills the gap, and a deleted one (mode: tombstone) stays gone", () => {
    // mutation-proof: make `tombstoned` read `hb:modes:<id>` for a mode (src/data/carried.ts, not `mode:<id>`)
    // and this goes red: the mode this account deleted comes back from the roster's copy.
    const view = withCarried(modesBase(), carrying(theirMode, gmMode), { mode: 'own', ownTombstones: noTombs });
    expect(view.modes[myMode.id].name).toBe('Brace (my version)');
    expect(view.modes[gmMode.id]?.name, 'a GM-made mode a push brought').toBe('Harbor Watch');
    const k = `mode:${gmMode.id}`;
    const gone = withCarried(modesBase(), carrying(gmMode), { mode: 'own', ownTombstones: { deleted: { [k]: 2000 }, revived: { [k]: 1000 } } });
    expect(gone.modes[gmMode.id], 'deleted on this device: stays deleted').toBeUndefined();
    const back = withCarried(modesBase(), carrying(gmMode), { mode: 'own', ownTombstones: { deleted: { [k]: 2000 }, revived: { [k]: 3000 } } });
    expect(back.modes[gmMode.id]?.name, 'saved again since: back').toBe('Harbor Watch');
  });

  it("foreign: the owner's carried mode wins over the viewer's saved one, never over a catalog mode", () => {
    // mutation-proof: make withCarried loop `HOMEBREW_TYPES` (not CARRIED_TYPES) and this goes red: the viewer
    // keeps HIS mode under that id, and the GM-made one is missing.
    const view = foreignContent(modesBase(), carrying(theirMode, gmMode, fakeCatalog));
    expect(view.modes[myMode.id].name).toBe('Brace (their version)');
    expect(view.modes[gmMode.id]?.name).toBe('Harbor Watch');
    expect(view.modes[CATALOG_ID].name, 'the catalog is printed').toBe(CATALOG_MODES[0].name);
    // A mode stays the object it came as: no `traits` or `source` stamped on it.
    expect(view.modes[gmMode.id]).toBe(gmMode);
  });

  it('a carried mode without its modifiers list is ignored, never drawn (a mode reader walks it)', () => {
    // mutation-proof: drop the `Array.isArray(rec.modifiers)` half of `usable` (src/data/carried.ts) and this
    // goes red: the broken mode lands in the view.
    const broken = { id: 'mode-broken-m3', name: 'Broken' };
    const b = modesBase();
    expect(foreignContent(b, carrying(broken)), 'nothing usable: the database itself').toBe(b);
    expect(normalizeCarried({ modes: { [broken.id]: broken, [gmMode.id]: gmMode } })).toEqual({ modes: { [gmMode.id]: gmMode } });
  });

  it('keepCarried drops a mode copy this device holds itself or deleted, and keeps the rest', () => {
    // mutation-proof: make carriedToKeep pass `modes` through unjudged (its old HOMEBREW_TYPES test) and this
    // goes red: the roster would keep a copy of the player's own mode.
    const k = `mode:${gmMode.id}`;
    const deleted: OwnTombstones = { deleted: { [k]: 2000 }, revived: {} };
    const sheet = { id: 'c-k', carried: { modes: { [theirMode.id]: theirMode, [gmMode.id]: gmMode } } } as unknown as { carried?: Carried };
    expect(keepCarried(sheet, modesBase(), noTombs).carried).toEqual({ modes: { [gmMode.id]: gmMode } });
    expect('carried' in keepCarried(sheet, modesBase(), deleted), 'nothing left: the field goes').toBe(false);
  });
});

describe('carriedForCampaign — what ONE campaign is sent (round 2, 2026-10-20)', () => {
  /*
   * Checker finding saving-C2: carried in every publish as a WINNING copy, a GM's edit of his campaign's shared
   * homebrew changed every PC sheet using it, and the republishes turned his chained tracker push into "not
   * applied". Finding saving-R2-chk-1: left OUT instead, the record went "Unknown item" on every other view the
   * moment the GM deleted it. So what the player's view took from THAT campaign's share goes FILL-only, and its
   * text stays out of the publish's "already sent" test (publishKey). Finding saving-R2-chk-3: only when the
   * player's view holds that campaign's copy (sharedOrigins: the first campaign wins, as mergeWithSeed picks).
   */
  const X = { id: 'hb-items-shared-in-a', name: 'Shared in A', traits: [], source: HB };
  const Y = { id: 'hb-items-shared-in-b', name: 'Shared in B', traits: [], source: HB };
  const Z = { id: 'hb-items-players-own', name: 'The player’s own', traits: [], source: HB };
  const M = { id: 'mode-own-m9', name: 'Own mode', modifiers: [] };
  const carried = { items: { [X.id]: X, [Y.id]: Y, [Z.id]: Z }, modes: { [M.id]: M } } as unknown as Carried;
  const camp = (items: Record<string, unknown>) => ({ name: '', sources: {}, content: { items }, updatedAt: '' }) as unknown as CampaignHbCampaign;
  const origins = sharedOrigins({ A: camp({ [X.id]: X }), B: camp({ [Y.id]: Y }) }, () => false);

  it("marks fill-only what the player's view took from THAT campaign; another campaign's record, the player's own and modes go as winning copies", () => {
    // mutation-proof: make carriedForCampaign return `carried` unchanged (src/data/carried.ts) and this goes red.
    const toA = carriedForCampaign(carried, 'A', origins)!;
    expect(toA.fill).toEqual([`items:${X.id}`]);
    expect(Object.keys(toA.items ?? {}).sort(), 'every record still rides along').toEqual([X.id, Y.id, Z.id].sort());
    expect(Object.keys(toA.modes ?? {})).toEqual([M.id]);
    expect(carriedForCampaign(carried, 'B', origins)!.fill).toEqual([`items:${Y.id}`]);
    expect(JSON.stringify(carriedForCampaign(carried, 'A', origins)), 'deterministic JSON').toBe(JSON.stringify(toA));
  });

  it("keeps the player's own record under an id the campaign also shares a winning copy (theirs wins on their device)", () => {
    // mutation-proof: drop `&& !ownWins?.has(key)` in carriedForCampaign and this goes red.
    expect(carriedForCampaign(carried, 'A', origins, new Set([`items:${X.id}`]))).toBe(carried);
  });

  it('two campaigns sharing one id: fill-only only to the campaign whose copy the player sees; the other gets a winning copy', () => {
    /*
     * Finding saving-R2-chk-3: A's and B's GMs both share X, with different text. The player's view holds A's
     * (the first campaign of the cache — ./index.ts mergeWithSeed). Marked fill-only for B too, B's members would
     * draw B's text while the player sees A's.
     * mutation-proof: make sharedOrigins keep the LAST campaign holding an id (src/data/carried.ts, `out.set` without
     * the `!out.has(key)` test) and this goes red.
     */
    const xB = { ...X, name: 'Shared in A, B’s text' };
    const both = sharedOrigins({ A: camp({ [X.id]: X }), B: camp({ [X.id]: xB }) }, () => false);
    const onlyX = { items: { [X.id]: X } } as unknown as Carried;
    expect(carriedForCampaign(onlyX, 'A', both)!.fill).toEqual([`items:${X.id}`]);
    expect(carriedForCampaign(onlyX, 'B', both), 'to B: the player’s (A’s) copy, winning').toBe(onlyX);
    expect(foreignContent({ ...base(), items: { [X.id]: xB } } as unknown as ContentDatabase, { carried: onlyX }).items[X.id].name).toBe('Shared in A');
  });

  it('sharedOrigins skips a printed id, as the merge does', () => {
    expect(sharedOrigins({ A: camp({ [PRINTED_ID]: fakePrinted }) }, isPrinted).size).toBe(0);
  });

  it('is `carried` itself when nothing is marked', () => {
    expect(carriedForCampaign(carried, 'C', origins)).toBe(carried);
    expect(carriedForCampaign(undefined, 'A', origins)).toBeUndefined();
  });
});

describe('a FILL-only record (round 2, 2026-10-20, finding saving-R2-chk-1)', () => {
  /*
   * The GM shares X in campaign A; the player's publish to A carries X fill-only. The GM's own views of the sheet
   * draw HIS record while he has it (his edit shows at once), and still resolve X after he deleted it from his
   * homebrew — before this player's app has pulled, converted it to a kept record and republished.
   */
  const X = { id: 'hb-items-shared-x', name: 'Tide Bell (as the player last sent it)', traits: [], source: HB };
  const xNow = { ...X, name: 'Tide Bell (the GM’s current text)' };
  const camp = (items: Record<string, unknown>) => ({ name: '', sources: {}, content: { items }, updatedAt: '' }) as unknown as CampaignHbCampaign;
  const sent = { carried: carriedForCampaign({ items: { [X.id]: X } } as unknown as Carried, 'A', sharedOrigins({ A: camp({ [X.id]: X }) }, () => false)) };

  it('foreign: never wins over the viewer’s own record of that id; fills it once he deleted his', () => {
    // mutation-proof: drop `fill.has(...) ||` from withCarried's foreign test (src/data/carried.ts) and this goes red:
    // the GM's sheet draws the player's older copy over his own current record.
    const gmHas = { ...base(), items: { [xNow.id]: xNow } } as unknown as ContentDatabase;
    expect(foreignContent(gmHas, sent).items[X.id].name, 'he holds it: his own record').toBe('Tide Bell (the GM’s current text)');
    const gmDeleted = base();
    expect(foreignContent(gmDeleted, sent).items[X.id]?.name, 'he deleted it: the carried copy fills the gap').toBe(X.name);
    expect(partyContent(gmDeleted, [sent]).items[X.id]?.name, 'the tracker GM screen too').toBe(X.name);
  });

  it('publishKey: the text of a fill-only record is not compared; which records are fill-only, and every other record, are', () => {
    // mutation-proof: make publishKey return `JSON.stringify(published)` (src/data/carried.ts) and this goes red.
    const Z = { id: 'hb-items-own-z', name: 'Own', traits: [], source: HB };
    const origins = sharedOrigins({ A: camp({ [X.id]: X }) }, () => false);
    const pub = (x: unknown, z: unknown) => ({ id: 'c', carried: carriedForCampaign({ items: { [X.id]: x, [Z.id]: z } } as unknown as Carried, 'A', origins) });
    expect(publishKey(pub(xNow, Z)), 'the GM edited his shared record: nothing to send').toBe(publishKey(pub(X, Z)));
    expect(publishKey(pub(X, { ...Z, name: 'Own, edited' })), 'the player edited their own: sent').not.toBe(publishKey(pub(X, Z)));
    const unshared = { id: 'c', carried: { items: { [X.id]: X, [Z.id]: Z } } };
    expect(publishKey(unshared), 'no longer shared there: sent').not.toBe(publishKey(pub(X, Z)));
    expect(publishKey(unshared), 'nothing fill-only: the JSON itself').toBe(JSON.stringify(unshared));
  });

  it('foreignCarriedIds: a fill-only record the viewer holds is drawn from his own, so it is not copy-on-write', () => {
    // mutation-proof: make foreignCarriedIds return every carried id (src/data/carried.ts) and this goes red.
    const gmHas = { ...base(), items: { [xNow.id]: xNow } } as unknown as ContentDatabase;
    expect([...foreignCarriedIds(gmHas, sent.carried, 'items')]).toEqual([]);
    expect([...foreignCarriedIds(base(), sent.carried, 'items')], 'deleted on his side: drawn from the copy').toEqual([X.id]);
    expect([...foreignCarriedIds(gmHas, { items: { [X.id]: X } }, 'items')], 'a winning copy always is').toEqual([X.id]);
  });

  it('normalizeCarried and keepCarried keep the fill list only for records they keep', () => {
    // mutation-proof: drop the `fillFor(...)` re-cut in carriedToKeep (src/data/carried.ts) and this goes red: the
    // kept object names a record it no longer holds.
    const gift2 = { ...gift, id: 'hb-gm-gift-2' };
    const c = { items: { [mine.id]: mine, [gift2.id]: gift2 }, fill: [`items:${mine.id}`, `items:${gift2.id}`, 'items:nope', 7] } as unknown as Carried;
    expect(normalizeCarried(c)?.fill).toEqual([`items:${gift2.id}`, `items:${mine.id}`].sort());
    expect(keepCarried({ carried: c }, base(), noTombs).carried).toEqual({ items: { [gift2.id]: gift2 }, fill: [`items:${gift2.id}`] });
    const onlyMine = { items: { [mine.id]: mine }, fill: [`items:${mine.id}`] } as unknown as Carried;
    expect('carried' in keepCarried({ carried: onlyMine }, base(), noTombs), 'a fill list alone is not kept').toBe(false);
  });
});

describe('partyContent — the tracker GM screen’s database (round 2, 2026-10-20)', () => {
  it('fills the ids the GM lacks from the party’s sheets — never over his own record, never over a printed one', () => {
    // mutation-proof: make partyContent return `content` (src/data/carried.ts) and this goes red.
    const b = base();
    const sheets = [sheetOf(theirs, gift), null, sheetOf({ ...gift, name: 'Second copy' })];
    const db = partyContent(b, sheets);
    expect(db.items[gift.id]?.name, 'the first sheet holding it gives it').toBe('Amulet of the Tide');
    expect(db.items[mine.id].name, "the GM's own record of that id stays").toBe('Cloak (my version)');
    expect(withCarried(b, sheetOf(fakePrinted), { mode: 'fill', isPrinted }).items[PRINTED_ID].name).toBe('Rapier');
    expect(partyContent(b, sheets), 'the same object for the same inputs').toBe(db);
    expect(partyContent(b, [sheetOf(theirs)]), 'nothing new: the database itself').toBe(b);
  });
});

describe('withCarriedAttached — a send hands back the same sheet when nothing changes', () => {
  const content = (): ContentDatabase => ({ ...base(), items: { ...base().items, [gift.id]: gift } }) as unknown as ContentDatabase;
  /** The shape withCarriedAttached takes: a sheet that may carry records (typed, round 3 2026-10-20, finding N-d). */
  type Sheet = { id: string; character: { inventory: { itemId: string; quantity: number }[] }; carried?: Carried };
  const sheet = (): Sheet => ({ id: 'c-test-reed', character: { inventory: [{ itemId: gift.id, quantity: 1 }] } });

  it('attaches what the sheet uses, keeps the same object on an equal second send, and drops a stale field', () => {
    // mutation-proof: make withCarriedAttached always return `{ ...sheet, carried }` and this goes red (the
    // tracker seam knows its own pushes by object identity — src/integration/pcSheetTruth.ts rule E).
    const sent = withCarriedAttached(sheet(), content());
    expect(Object.keys(sent.carried?.items ?? {})).toEqual([gift.id]);
    expect(withCarriedAttached(sent, content())).toBe(sent);
    const uses: Sheet = { ...sheet(), character: { inventory: [] }, carried: sent.carried };
    const cleared = withCarriedAttached(uses, content());
    expect('carried' in cleared, 'nothing used any more: the field goes').toBe(false);
    const plain: Sheet = { ...sheet(), character: { inventory: [] } };
    expect(withCarriedAttached(plain, content())).toBe(plain);
  });

  /*
   * Round 3 (2026-10-20, final finding N-b). The sheet a GM pushes is the published one, whose campaign-shared
   * records the player's publish marked FILL-only. Re-collected without the marks, the push's copy of his own
   * shared record won on his views of that PC while the push waited (the pending overlay is this sheet): his
   * later edit of the record did not show there.
   */
  it('keeps the fill-only marks the sheet had on the records it still carries — and the same object when that is all', () => {
    // mutation-proof: drop the `fillFor(fillKeys(sheet.carried), …)` re-marking from withCarriedAttached
    // (src/data/carried.ts; attach `collected` as it is) and this goes red: the marks are gone and the GM's
    // view draws the pushed copy over his own edit.
    const shared = { ...gift, name: 'Amulet of the Tide (as shared)' };
    const gmNow = { ...shared, name: 'Amulet of the Tide (his edit)' };
    const published: Sheet = { ...sheet(), carried: { items: { [gift.id]: shared }, fill: [`items:${gift.id}`] } as unknown as Carried };
    const gmDb = { ...base(), items: { ...base().items, [gift.id]: shared } } as unknown as ContentDatabase;
    expect(withCarriedAttached(published, foreignContent(gmDb, published)), 'nothing changed: the very sheet (rule E)').toBe(published);

    const changed: Sheet = { ...published, character: { inventory: [...published.character.inventory, { itemId: theirs.id, quantity: 1 }] } };
    const sent = withCarriedAttached(changed, foreignContent(gmDb, changed));
    expect(sent.carried?.fill, 'the mark stays').toEqual([`items:${gift.id}`]);
    expect(withCarriedAttached(sent, foreignContent(gmDb, sent)), 'a second attach (pushGmEdit after the tracker seam) adds nothing').toBe(sent);
    const gmEdited = { ...base(), items: { ...base().items, [gift.id]: gmNow } } as unknown as ContentDatabase;
    expect(foreignContent(gmEdited, sent).items[gift.id].name, 'his later edit shows on his view of the pushed sheet').toBe('Amulet of the Tide (his edit)');
    const lacks = { ...base(), items: {} } as unknown as ContentDatabase;
    expect(foreignContent(lacks, sent).items[gift.id]?.name, 'a device without it is still filled').toBe('Amulet of the Tide (as shared)');

    // A mark is only ever KEPT: a record the sheet no longer uses takes its mark with it, and a new one gets none.
    const dropped = withCarriedAttached({ ...changed, character: { inventory: [{ itemId: theirs.id, quantity: 1 }] } }, foreignContent(gmDb, changed));
    expect(dropped.carried?.fill, 'the gift is gone, and so is its mark').toBeUndefined();
    expect(Object.keys(dropped.carried?.items ?? {})).toEqual([theirs.id]);
  });
});

describe('a carried MODE repointed or taken off a character (round 3, 2026-10-20, final findings N-a / N-c)', () => {
  /*
   * One helper for both sheets that copy a carried mode on write — the GM's edit sheet and the player's own
   * (src/sheet/GmEditSheet.tsx saveModeDef, src/App.tsx saveOwnModeDef / removeOwnModeDef). A mode left named
   * anywhere on the character stays ON in every view whose database holds it (the GM's, for his own mode).
   */
  const play = () => ({
    heroPoints: 1,
    activeModes: ['mode-gm-a', 'mode-keep'],
    companionModes: { wolf: ['mode-gm-a'], hawk: ['mode-keep'] },
    tempHpFrom: 'mode-gm-a',
  });

  it('repointMode: the character’s own list, every companion’s and the temporary-HP pool’s owner; null takes it out of all three', () => {
    // mutation-proof: leave `companionModes` as it is in repointMode (src/data/carried.ts) and this goes red: the
    // wolf keeps the GM's mode on.
    const p = play();
    expect(repointMode(p, 'mode-gm-a', 'mode-copy')).toEqual({
      heroPoints: 1,
      activeModes: ['mode-copy', 'mode-keep'],
      companionModes: { wolf: ['mode-copy'], hawk: ['mode-keep'] },
      tempHpFrom: 'mode-copy',
    });
    const off = repointMode(p, 'mode-gm-a', null);
    expect(off.activeModes).toEqual(['mode-keep']);
    expect(off.companionModes).toEqual({ wolf: [], hawk: ['mode-keep'] });
    expect(off.tempHpFrom, 'the pool’s owner is gone; the pool itself is the character’s').toBeUndefined();
    expect(p.activeModes, 'never in place').toEqual(['mode-gm-a', 'mode-keep']);
    expect(repointMode(p, 'mode-nowhere', null), 'named nowhere: the same object').toBe(p);
    const bare = { heroPoints: 1, companionModes: { wolf: ['mode-gm-a'] } };
    expect('activeModes' in repointMode(bare, 'mode-gm-a', null), 'an absent field stays absent').toBe(false);
  });

  it('withoutCarried: the record and its fill mark go; the field goes when nothing is left; the same object when it carries no such record', () => {
    // mutation-proof: keep the old `fill` list in withoutCarried (src/data/carried.ts; skip the `fillFor` re-cut)
    // and this goes red: the fill list names a record the sheet no longer carries.
    const mode = { id: 'mode-gm-a', name: 'Harbor Guard', modifiers: [] };
    const sheet = { id: 'c', carried: { items: { [gift.id]: gift }, modes: { [mode.id]: mode }, fill: [`items:${gift.id}`, `modes:${mode.id}`] } as unknown as Carried };
    expect(withoutCarried(sheet, 'modes', mode.id).carried).toEqual({ items: { [gift.id]: gift }, fill: [`items:${gift.id}`] });
    expect(withoutCarried(sheet, 'modes', 'mode-other'), 'not carried: the same object').toBe(sheet);
    const onlyMode = { id: 'c', carried: { modes: { [mode.id]: mode } } as unknown as Carried };
    expect('carried' in withoutCarried(onlyMode, 'modes', mode.id), 'nothing left: the field goes').toBe(false);
  });
});
