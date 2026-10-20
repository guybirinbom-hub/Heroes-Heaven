// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { authoredKey, hash53, sheetKey } from '../src/data/authored';
import { gmBaseOf, gmEditVerdict, pendingEditStillStands, type PendingGmEdit } from '../src/sheet/gmSync';
import { mergeRosterEdits } from '../src/data/rosterMerge';
import { exportNative, importCharacter } from '../src/data/transfer';
import { rebuildRoster } from '../src/data/rebuild';
import { carriedToKeep, keepCarried } from '../src/data/carried';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { initialPlay } from '../src/rules/play';
import type { SavedChar } from '../src/data/storage';
import type { ContentDatabase, InventoryItem } from '../src/rules/types';

/**
 * OWNER RULING 2026-10-20 (Guy): a character's custom records travel WITH it (`SavedChar.carried`,
 * src/data/carried.ts). This file pins what that field must NOT change, and where it must survive:
 *
 *  1. F1 NEUTRALITY. The GM-edit channel judges by what the player AUTHORED (src/data/authored.ts). Which
 *     copy of a record rides along is the sender's view, not authorship: the authored key and its hash
 *     are byte-for-byte what they were before the field existed, a push is judged exactly as before, and
 *     a published sheet that differs from a GM edit only in `carried` IS that edit, landed.
 *  2. The launch / adopt re-derive (rebuildRoster) builds against the character's own view.
 *  3. Two tabs' roster merge keeps both tabs' carried records (D8: no merge change needed).
 *  4. A file export / import keeps them.
 *
 * Every character and record here is synthetic.
 */

const db = content();
const HB = { license: 'homebrew', book: 'Harbor Notes' } as const;
/** A homebrew feat whose effect the BUILD applies (an innate cantrip), so a re-derive without the record
 *  visibly loses it — a feat id alone stays on `character.feats` either way. */
const FEAT = {
  id: 'hb-feat-harborborn',
  name: 'Harborborn',
  level: 1,
  category: 'ancestry',
  traits: ['human'],
  rarity: 'common',
  description: 'x',
  source: HB,
  innateSpells: [{ spellId: 'light', tradition: 'arcane', atWill: true }],
};
/** Does the built character cast Light from somewhere (a fighter only can through the feat)? */
const castsLight = (sc: SavedChar) => JSON.stringify(sc.character.spellcasting ?? []).includes('"light"');
const ITEM_A = { id: 'custom-net-float-a1', name: 'Net Float', itemType: 'equipment', level: 0, bulk: 0, traits: [], source: HB };
const ITEM_B = { id: 'custom-gull-whistle-b2', name: 'Gull Whistle', itemType: 'equipment', level: 0, bulk: 0, traits: [], source: HB };
const CARRIED = { feats: { [FEAT.id]: FEAT } } as unknown as SavedChar['carried'];

describe('1 · F1 neutrality: `carried` is never authorship', () => {
  const sc = {
    id: 'c-f1',
    character: { name: 'Pell Arno', customization: { theme: 'tide' } },
    build: { level: 1 },
    play: { hp: 3 },
  } as unknown as SavedChar;

  it("the authored key is exactly what it was before the field existed (the gm_base hash cannot move)", () => {
    // mutation-proof: put `carried: sc.carried ?? null` into authoredSheet (src/data/authored.ts) and this goes red.
    expect(authoredKey({ ...sc, carried: CARRIED } as SavedChar)).toBe(authoredKey(sc));
    expect(authoredKey(sc), 'pinned byte for byte').toBe('{"build":{"level":1},"currency":null,"customization":{"theme":"tide"},"play":{"hp":3}}');
    const at = '2026-10-20T10:00:00.000Z';
    expect(gmBaseOf({ sheet: { ...sc, carried: CARRIED } as SavedChar, updatedAt: at })).toEqual(gmBaseOf({ sheet: sc, updatedAt: at }));
    // A sheet with no build: its whole `character` is authored — still never the top-level `carried`.
    const legacy = { id: 'c-legacy', character: { name: 'Old Sheet' } } as unknown as SavedChar;
    expect(authoredKey({ ...legacy, carried: CARRIED } as SavedChar)).toBe(authoredKey(legacy));
  });

  it('sheetKey is the whole sheet less `carried`: every other field still counts', () => {
    // mutation-proof: make sheetKey return `canonicalJson(sc)` (src/data/authored.ts) and this goes red.
    expect(sheetKey({ ...sc, carried: CARRIED })).toBe(sheetKey(sc));
    expect(sheetKey({ ...sc, archived: true })).not.toBe(sheetKey(sc));
    expect(sheetKey({ ...sc, character: { ...sc.character, name: 'Pell Arno II' } })).not.toBe(sheetKey(sc));
  });

  it("a GM push is APPLIED when the player's published row carries records their roster entry does not hold", () => {
    // The player's app publishes `carried` but never writes it back into the roster (App.tsx publish), so
    // the published sheet and the roster entry differ in exactly that field. That must not hold a GM edit.
    const PUB = '2026-10-20T10:00:00.000Z';
    const published = { ...sc, carried: CARRIED } as SavedChar;
    const local = sc;
    const gmVersion = { ...sc, play: { hp: 1 }, carried: { ...CARRIED, items: { [ITEM_A.id]: ITEM_A } } } as unknown as SavedChar;
    const at = '2026-10-20T09:30:00.000Z';
    const row = { updatedAt: at, sheet: gmVersion, gmBase: { v: 1 as const, at, stamp: PUB, hash: hash53(authoredKey(published)), on: null } };
    expect(gmEditVerdict({ row, own: { sheet: published, updatedAt: PUB }, local })).toBe('apply');
    // …and a push that differs from the published sheet only in `carried` changes no authorship: settled.
    const same = { ...row, sheet: { ...sc, carried: { items: { [ITEM_A.id]: ITEM_A } } } as unknown as SavedChar };
    expect(gmEditVerdict({ row: same, own: { sheet: published, updatedAt: PUB }, local })).toBe('settled');
  });

  it("the GM's held edit stands down once the published sheet IS that edit, whatever copies each carries", () => {
    // mutation-proof: compare `canonicalJson(...)` (not `sheetKey`) in gmSync.pendingEditStillStands and this
    // goes red: the overlay stays up over a landed edit.
    const T = '2026-10-20T10:00:00.000Z';
    const edit: PendingGmEdit = {
      campaignId: 'camp',
      charId: sc.id,
      sheet: { ...sc, carried: { items: { [ITEM_A.id]: ITEM_A } } } as unknown as SavedChar,
      pushedAt: '2026-10-20T10:05:00.000Z',
      baseUpdatedAt: T,
    } as PendingGmEdit;
    // Their app applied it and republished with ITS copy of the record — at the same stamp here, so only
    // the content test can answer.
    const landed = { sheet: { ...sc, carried: { items: { [ITEM_A.id]: { ...ITEM_A, name: 'Net Float (theirs)' } } } } as unknown as SavedChar, updatedAt: T };
    expect(pendingEditStillStands(edit, landed)).toBe(false);
    const different = { sheet: { ...sc, play: { hp: 9 } } as unknown as SavedChar, updatedAt: T };
    expect(pendingEditStillStands(edit, different), 'fixture: a different sheet keeps it standing').toBe(true);
  });
});

describe('2 · the re-derive builds against the character’s own view (rebuildRoster)', () => {
  const entry = (): SavedChar => {
    const build = {
      ...emptyBuild(),
      name: 'Dessa Quill',
      level: 1,
      ancestryId: 'human',
      heritageId: 'versatile-human',
      backgroundId: 'acolyte',
      classId: 'fighter',
      keyAbility: 'str',
      featPicks: { '1:ancestry:0': FEAT.id },
    } as BuildState;
    const plain = buildCharacter({ ...build, featPicks: {} } as BuildState, db); // what an older app stored
    return { id: 'c-rebuild', character: plain, build, play: initialPlay(plain, db), carried: CARRIED } as SavedChar;
  };

  it('a carried feat the device lacks is derived onto the character', () => {
    // mutation-proof: build against `content` instead of `ownContent(content, c, tomb)` in
    // src/data/rebuild.ts and this goes red.
    expect(db.feats[FEAT.id], 'fixture: this device lacks the feat').toBeUndefined();
    expect(castsLight(entry()), 'fixture: the stored character was derived without it').toBe(false);
    const [next] = rebuildRoster([entry()], db, { deleted: {}, revived: {} });
    expect(castsLight(next), "the feat's innate cantrip is derived").toBe(true);
    expect(next.carried, 'the field rides on through the re-derive').toEqual(CARRIED);
  });

  it('…unless this account deleted that record (ruling 2026-09-12 #7: "your characters lose it")', () => {
    const k = `hb:feats:${FEAT.id}`;
    const [next] = rebuildRoster([entry()], db, { deleted: { [k]: 2000 }, revived: {} });
    expect(castsLight(next)).toBe(false);
    const [revived] = rebuildRoster([entry()], db, { deleted: { [k]: 2000 }, revived: { [k]: 3000 } });
    expect(castsLight(revived), 'a later revive brings it back').toBe(true);
  });
});

describe('3 · two tabs’ roster merge keeps both tabs’ carried records', () => {
  it('a record each tab added rides along on the merged entry, beside both inventory rows', () => {
    const base = {
      id: 'c-merge',
      character: { name: 'Tamsin Reed' },
      build: { level: 1 },
      play: { inventory: [] as InventoryItem[] },
    } as unknown as SavedChar;
    const add = (sc: SavedChar, rec: { id: string }, instanceId: string) =>
      ({
        ...sc,
        play: { ...sc.play, inventory: [...(sc.play!.inventory ?? []), { instanceId, itemId: rec.id, quantity: 1 }] },
        carried: { ...sc.carried, items: { ...sc.carried?.items, [rec.id]: rec } },
      }) as unknown as SavedChar;
    const local = add(base, ITEM_A, 'i-a');
    const incoming = add(base, ITEM_B, 'i-b');
    const [merged] = mergeRosterEdits([base], [local], [incoming]);
    expect(Object.keys(merged.carried?.items ?? {}).sort()).toEqual([ITEM_A.id, ITEM_B.id].sort());
    expect((merged.play!.inventory ?? []).map((i) => i.itemId).sort()).toEqual([ITEM_A.id, ITEM_B.id].sort());
    // Both tabs already carried something: their additions merge record by record too.
    const both = { ...base, carried: CARRIED } as SavedChar;
    const [merged2] = mergeRosterEdits([both], [add(both, ITEM_A, 'i-a')], [add(both, ITEM_B, 'i-b')]);
    expect(Object.keys(merged2.carried?.items ?? {}).sort()).toEqual([ITEM_A.id, ITEM_B.id].sort());
    expect(merged2.carried?.feats?.[FEAT.id]).toEqual(FEAT);
  });
});

describe('4 · a file export / import keeps the records', () => {
  const sc = (): SavedChar => {
    const character = buildCharacter({ ...emptyBuild(), name: 'Orrin Vale', level: 1, ancestryId: 'human', classId: 'fighter', keyAbility: 'str' } as BuildState, db);
    const inv = { instanceId: 'x-1', itemId: ITEM_A.id, quantity: 1 } as InventoryItem;
    return { id: 'c-file', character, play: { ...initialPlay(character, db), inventory: [inv] } } as SavedChar;
  };

  it('exportNative with the sheet’s view collects what it uses, and importCharacter keeps it on the entry', () => {
    // mutation-proof: drop `...(carried ? { carried } : {})` from importNative (src/data/transfer.ts) and this goes red.
    const view = { ...db, items: { ...db.items, [ITEM_A.id]: ITEM_A, [ITEM_B.id]: ITEM_B } } as unknown as ContentDatabase;
    const text = exportNative(sc(), view);
    expect(Object.keys(JSON.parse(text).carried.items), 'only what it uses').toEqual([ITEM_A.id]);
    const { saved: back } = importCharacter(text, db);
    expect(back.carried?.items?.[ITEM_A.id]).toEqual(ITEM_A);
  });

  it('exportNative without a view passes the field on as it is; a malformed one is dropped on import', () => {
    // mutation-proof: make exportNative ignore `saved.carried` when no view is given and this goes red.
    const withField = { ...sc(), carried: { items: { [ITEM_B.id]: ITEM_B } } } as unknown as SavedChar;
    expect(JSON.parse(exportNative(withField)).carried).toEqual({ items: { [ITEM_B.id]: ITEM_B } });
    const doc = JSON.parse(exportNative(sc()));
    expect('carried' in doc, 'nothing to carry: no field').toBe(false);
    doc.carried = { items: { 'wrong-key': ITEM_A, [ITEM_B.id]: 'not a record' }, notAType: { x: { id: 'x' } } };
    expect(importCharacter(JSON.stringify(doc), db).saved.carried, 'an unknown shape is dropped, never guessed at').toBeUndefined();
  });

  it("an imported file keeps only what this device cannot resolve: never a copy of this account's own record", () => {
    // mutation-proof: drop the `carriedToKeep(...)` around normalizeCarried in importNative (src/data/transfer.ts)
    // and this goes red: the entry holds a copy of Net Float, which this device already owns.
    const both = { ...sc(), play: { ...sc().play!, inventory: [...sc().play!.inventory!, { instanceId: 'x-2', itemId: ITEM_B.id, quantity: 1 }] } } as SavedChar;
    const view = { ...db, items: { ...db.items, [ITEM_A.id]: ITEM_A, [ITEM_B.id]: ITEM_B } } as unknown as ContentDatabase;
    const text = exportNative(both, view);
    const mine = { ...db, items: { ...db.items, [ITEM_A.id]: ITEM_A } } as unknown as ContentDatabase; // A is this account's own
    expect(importCharacter(text, mine).saved.carried).toEqual({ items: { [ITEM_B.id]: ITEM_B } });
  });
});

describe('5 · a sheet arriving in the roster keeps only the copies this device cannot resolve (keepCarried)', () => {
  /*
   * 2026-10-20, checker findings saving-C3 / semantics-C2. A GM's push carries every record the sheet uses,
   * the player's OWN homebrew included. Kept in the roster entry, that copy outlived the player's own
   * Homebrew-page Delete: own mode hides a deleted id only through its tombstone, and tombstones are pruned
   * after 180 days — after which the copy filled the record back in (ruling 2026-09-12 #7: "your characters
   * lose it"). App.tsx's GM apply and importNative cut `carried` down with keepCarried as the entry is written.
   */
  const sheet = {
    id: 'c-keep',
    character: { name: 'Bryn Holloway' },
    build: { level: 1 },
    play: {},
    carried: { feats: { [FEAT.id]: FEAT }, items: { [ITEM_A.id]: ITEM_A, [ITEM_B.id]: ITEM_B } },
  } as unknown as SavedChar;
  const none = { deleted: {}, revived: {} };

  it("drops a copy of a record this device holds (the player's own), keeps one it lacks (the GM's)", () => {
    // mutation-proof: drop `own(content[t], id) !== undefined ||` from carriedToKeep (src/data/carried.ts) and
    // this goes red: the player's own Net Float stays in the roster entry.
    const playerDb = { ...db, items: { ...db.items, [ITEM_A.id]: ITEM_A } } as unknown as ContentDatabase;
    const kept = keepCarried(sheet, playerDb, none);
    expect(kept.carried).toEqual({ feats: { [FEAT.id]: FEAT }, items: { [ITEM_B.id]: ITEM_B } });
    expect(sheet.carried?.items?.[ITEM_A.id], 'the sheet it was given is never mutated').toBe(ITEM_A);
  });

  it('drops a record this account deleted, unless revived since', () => {
    // mutation-proof: drop `|| tombstoned(tombstones, t, id)` from carriedToKeep and this goes red.
    const k = `hb:feats:${FEAT.id}`;
    expect(keepCarried(sheet, db, { deleted: { [k]: 2000 }, revived: {} }).carried?.feats).toBeUndefined();
    expect(keepCarried(sheet, db, { deleted: { [k]: 2000 }, revived: { [k]: 3000 } }).carried?.feats?.[FEAT.id]).toBe(FEAT);
  });

  it('the same object when nothing is dropped; no field when nothing is left; untouched before content loads', () => {
    expect(keepCarried(sheet, db, none), 'this device holds none of them').toBe(sheet);
    const all = { ...db, items: { ...db.items, [ITEM_A.id]: ITEM_A, [ITEM_B.id]: ITEM_B }, feats: { ...db.feats, [FEAT.id]: FEAT } } as unknown as ContentDatabase;
    const bare = keepCarried(sheet, all, none);
    expect('carried' in bare, 'every copy resolves here: no field').toBe(false);
    // mutation-proof: make carriedToKeep return undefined (trim it all) when `content` is null and this goes
    // red — unknown is not empty: a list is never trimmed against a database nobody read.
    expect(keepCarried(sheet, null, none)).toBe(sheet);
    expect(carriedToKeep(undefined, db, none)).toBeUndefined();
  });
});
