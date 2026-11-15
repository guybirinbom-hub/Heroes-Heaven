import { afterEach, describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { copyNumbers, idSequence, mintDerivedId, mintUniqueId, nextSequence, setIdTokenSource } from '../src/rules/recordIds';
import {
  addCompanionItem,
  addFormula,
  addGalleryImage,
  addInventoryItem,
  addNotePage,
  addPlayCompanion,
  applyPlayState,
  attachItem,
  bumpItemQuantity,
  buyItem,
  derivedCompanionId,
  emptyPlay,
  initialPlay,
  makeProfileImage,
  nextNoteId,
  playForRebuild,
  reconcileFormulaBook,
  removeInventoryItem,
  setGalleryCaption,
  setPortrait,
  updateInventoryItem,
  updatePlayCompanion,
  type PlayState,
} from '../src/rules/play';
import { coinsToCp } from '../src/rules/wealth';
import { itemSpellRow, itemSpellRows } from '../src/rules/itemUses';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { contentFor } from '../src/rules/blocks/content';
import { mergeRosterEdits } from '../src/data/rosterMerge';
import { FORMULA_BOOK_ITEM_ID } from '../src/rules/formulaBook';
import type { CompanionConfig, InventoryItem } from '../src/rules/types';

/**
 * IDS OF THE RECORDS A PLAYER ADDS (package H, 2026-10-20; src/rules/recordIds.ts).
 *
 * Two tabs of one browser profile — and a GM's device giving a player an item — merge each other's roster
 * writes record by record, by key (src/data/rosterMerge.ts). The keys of inventory rows, companions, notes
 * pages and gallery pictures were numbered in sequence (`inv-${max + 1}`), so two tabs adding at once gave
 * two different records ONE key and the merge mixed them into one: tab A's rope and tab B's five worn
 * torches became one worn rope; the same rope bought in both tabs became one rope (a purchase lost); a
 * deleted row's freed number went to the next add, and an edit of the deleted row in the other tab
 * landed on the new item (independent checker's finding 1, 2026-10-19).
 *
 * Every "two tabs" leg below runs both directions of the merge — tab A folding B's write and tab B
 * folding A's — and checks BOTH. RED ON 6393b29 (run 2026-10-20 against a `git archive` copy of HEAD
 * with this file and src/rules/recordIds.ts added, first round): 14 of 23 fail — every two-tabs leg,
 * the reuse leg (`the torch took the rope’s edit`), and the helper legs that check play.ts mints. Of the
 * DERIVED legs only the formula book and the builder Save pass there (those mints were already
 * deterministic); they guard that the fix did not swing too far.
 * MUTATION (same day, on a scratch copy of the fix): mint the formula book, the builder row and the
 * made-real companion with the UNIQUE id instead — the three derived legs fail, on `a derived id is a
 * plain inv-N`, on the two Saves' rows differing, and on `inA: the eidolon twice: expected 2 to be 1`.
 *
 * SECOND ROUND (the checkers' findings, 2026-10-20) — each leg's red run is in its own comment:
 * a derived id names WHAT was derived (two different automatic companions made real at once stay two),
 * a peeled talisman's id is guarded, Make profile picture gives the old portrait a new id, and
 * counts/coins stay VALUE merges — pinned both ways (rosterMerge.ts header says why).
 *
 * THIRD ROUND (2026-10-20): the merge's own "two items under one key are two rows" guard (rounds 1–2)
 * is gone — every checker round found a case it broke — and the id REUSE it covered is fixed where the
 * id is minted: a builder Save never hands a new row an id another row held (play.ts
 * mergeRebuiltInventory), so the merge never meets two items on one key. See the builder-Save legs.
 *
 * FOURTH ROUND (2026-10-20, the checker's round-3 findings): the build's item spells resolve one row per
 * entry and by held spell (two scrolls of one item, two identical wands), the Save matches a scroll by
 * its spell as well as its item, a later Save takes an untouched replacement off by its derived id, and
 * the previous build's ids being taken is pinned. Each leg's red run is in its own comment.
 *
 * Synthetic data only.
 */
const db = () => content();
afterEach(() => setIdTokenSource(null));

const entry = (play: PlayState) => ({ id: 'pc', play });
/** What each tab holds once it has folded the other's write: A merges B's, B merges A's. Both go
 *  through JSON on the way, as storage does. */
function bothTabs(base: PlayState, a: PlayState, b: PlayState): { inA: PlayState; inB: PlayState } {
  const j = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const inA = mergeRosterEdits([entry(j(base))], [entry(j(a))], [entry(j(b))])[0].play;
  const inB = mergeRosterEdits([entry(j(base))], [entry(j(b))], [entry(j(a))])[0].play;
  return { inA, inB };
}
const rowsOf = (p: PlayState, itemId: string) => (p.inventory ?? []).filter((i) => i.itemId === itemId);
const UNIQUE = /^inv-[a-z0-9]+-(\d+)$/;

const row = (instanceId: string, itemId: string, extra: Partial<InventoryItem> = {}): InventoryItem => ({ instanceId, itemId, quantity: 1, ...extra });
/** An old save: every id a plain `inv-N`. */
const oldSave = (): PlayState => ({
  ...emptyPlay(),
  inventory: [row('inv-0', 'healing-potion-minor', { quantity: 3 }), row('inv-1', 'rope')],
});

describe('the id helper (src/rules/recordIds.ts)', () => {
  it('a unique id is `prefix-token-N`; N is max(trailing number) + 1, the acquisition order', () => {
    const ids = ['inv-0', 'inv-k3x9a2b1-7', 'granted-2', 'inv-3', 'no-number'];
    expect(nextSequence(ids)).toBe(8);
    expect(nextSequence([])).toBe(0);
    const id = mintUniqueId('inv', ids);
    expect(id).toMatch(UNIQUE);
    expect(idSequence(id)).toBe(8);
    expect(idSequence('no-number')).toBe(-1);
  });

  it('a derived id names what was derived: the same record → the same id, a different one → a different id', () => {
    const ids = ['inv-0', 'inv-k3x9a2b1-7'];
    expect(mintDerivedId('inv', 'formula-book-blank', ids)).toBe('inv-formula-book-blank-8');
    expect(mintDerivedId('inv', 'formula-book-blank', [...ids])).toBe('inv-formula-book-blank-8');
    expect(mintDerivedId('inv', 'shortbow', ids)).toBe('inv-shortbow-8');
    expect(mintDerivedId('cmp', 'featcmp-Pet’s Friend', ['cmp-0'])).toBe('cmp-featcmp-pet-s-friend-1');
    expect(mintDerivedId('inv', '', ids)).toBe('inv-8');
    expect(idSequence(mintDerivedId('inv', 'potion-2', ids)), 'a source ending in a digit keeps N last').toBe(8);
  });

  it('every mint is unique, even from the very same list (two tabs, or one tab twice)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(mintUniqueId('inv', ['inv-0']));
    expect(seen.size).toBe(500);
    for (const id of seen) expect(id).toMatch(/^inv-[a-z0-9]{8}-1$/);
  });

  it('the token seam: a test can pin it; a token that would break the id’s shape falls back to a random one', () => {
    setIdTokenSource(() => 'tok');
    expect(mintUniqueId('inv', ['inv-4'])).toBe('inv-tok-5');
    setIdTokenSource(() => '');
    expect(mintUniqueId('inv', ['inv-4'])).toMatch(/^inv-[a-z0-9]{8}-5$/);
    setIdTokenSource(() => 'A-1');
    expect(mintUniqueId('inv', ['inv-4'])).toMatch(/^inv-[a-z0-9]{8}-5$/);
    setIdTokenSource(null);
    expect(mintUniqueId('inv', [])).toMatch(/^inv-[a-z0-9]{8}-0$/);
  });

  it('an OLD save (plain inv-N ids) keeps every row exactly as stored; the new row continues its numbering', () => {
    const old = oldSave();
    const next = addInventoryItem(old, 'torch');
    expect(next.inventory!.slice(0, 2)).toEqual(old.inventory);
    expect(next.inventory![2].instanceId).toMatch(UNIQUE);
    expect(idSequence(next.inventory![2].instanceId)).toBe(2);
  });

  it('acquisition order survives: each add numbers after the last; deleting the highest row never hands its id on', () => {
    let p = oldSave();
    p = addInventoryItem(p, 'torch');
    p = addInventoryItem(p, 'chalk');
    expect(p.inventory!.map((i) => idSequence(i.instanceId))).toEqual([0, 1, 2, 3]);
    const chalk = p.inventory![3].instanceId;
    p = removeInventoryItem(p, chalk);
    p = addInventoryItem(p, 'waterskin');
    expect(p.inventory![3].instanceId).not.toBe(chalk);
  });

  it('duplicate copies are numbered in ACQUISITION order — old ids and new ones mixed, whatever the list order', () => {
    const rows = [row('inv-x1-7', 'longsword'), row('inv-3', 'longsword'), row('inv-y2-5', 'longsword'), row('inv-4', 'rope')];
    const want = new Map([
      ['inv-3', ' 1'],
      ['inv-y2-5', ' 2'],
      ['inv-x1-7', ' 3'],
    ]);
    expect(copyNumbers(rows)).toEqual(want);
    expect(copyNumbers([...rows].reverse())).toEqual(want);
  });

  it('two copies minted at one number in two tabs are numbered the same way in every tab, by id', () => {
    const a = row('inv-bbb-6', 'rope');
    const b = row('inv-aaa-6', 'rope');
    const want = new Map([
      ['inv-aaa-6', ' 1'],
      ['inv-bbb-6', ' 2'],
    ]);
    expect(copyNumbers([a, b])).toEqual(want);
    expect(copyNumbers([b, a])).toEqual(want);
    // An id with no number keeps list order, after the numbered ones.
    expect(copyNumbers([row('custom', 'rope'), a, row('other', 'rope')])).toEqual(
      new Map([
        ['inv-bbb-6', ' 1'],
        ['custom', ' 2'],
        ['other', ' 3'],
      ]),
    );
  });
});

describe('two tabs ADD at the same moment — both records stay, unmixed (checker finding 1)', () => {
  it('a rope in tab A, five worn torches in tab B: one rope, one stack of worn torches, in both tabs', () => {
    const base = oldSave();
    const a = addInventoryItem(base, 'rope');
    const b = addInventoryItem(base, 'torch', { quantity: 5, worn: true });
    for (const [tab, p] of Object.entries(bothTabs(base, a, b))) {
      expect(rowsOf(p, 'rope'), `${tab}: ropes`).toHaveLength(2); // the old one and the new one
      expect(rowsOf(p, 'rope').every((r) => !r.worn && r.quantity === 1), `${tab}: a rope came out worn`).toBe(true);
      expect(rowsOf(p, 'torch'), `${tab}: the torches vanished`).toEqual([expect.objectContaining({ quantity: 5, worn: true })]);
    }
  });

  it('the SAME item bought in both tabs (identical rows) is two purchases, not one', () => {
    const base = oldSave();
    const a = addInventoryItem(base, 'chalk');
    const b = addInventoryItem(base, 'chalk');
    for (const [tab, p] of Object.entries(bothTabs(base, a, b))) expect(rowsOf(p, 'chalk'), `${tab}: a purchase was lost`).toHaveLength(2);
  });

  it('a GM’s device gives an item while the player adds one: both stay', () => {
    const base = oldSave();
    const gm = addInventoryItem(base, 'waterskin'); // minted on the GM's device
    const player = addInventoryItem(base, 'dagger');
    for (const [tab, p] of Object.entries(bothTabs(base, player, gm))) {
      expect(rowsOf(p, 'waterskin'), `${tab}: the GM’s item vanished`).toHaveLength(1);
      expect(rowsOf(p, 'dagger'), `${tab}: the player’s item vanished`).toHaveLength(1);
    }
  });

  it('a kit in both tabs: two backpacks, each holding its own eight items', () => {
    const base: PlayState = { ...emptyPlay(), inventory: [] };
    const a = addInventoryItem(base, 'adventurers-pack');
    const b = addInventoryItem(base, 'adventurers-pack');
    for (const [tab, p] of Object.entries(bothTabs(base, a, b))) {
      const packs = rowsOf(p, 'backpack');
      expect(packs, `${tab}: backpacks`).toHaveLength(2);
      for (const pack of packs) expect((p.inventory ?? []).filter((i) => i.containerInstanceId === pack.instanceId), `${tab}: ${pack.instanceId}`).toHaveLength(8);
    }
  });

  it('one talisman peeled off a stack in tab A, an item added in tab B: both new rows stay', () => {
    const base: PlayState = { ...emptyPlay(), inventory: [row('inv-0', 'longsword'), row('inv-1', 'potency-crystal', { quantity: 3 })] };
    const a = attachItem(base, 'inv-1', 'inv-0');
    // The peeled row's own id is unique (checker 2026-10-20: the rope below is unique anyway, so without
    // this the leg stayed green with attachItem minting a sequential `inv-2`).
    expect(rowsOf(a, 'potency-crystal').find((r) => r.attachedTo)?.instanceId).toMatch(UNIQUE);
    const b = addInventoryItem(base, 'rope');
    for (const [tab, p] of Object.entries(bothTabs(base, a, b))) {
      expect(rowsOf(p, 'potency-crystal').map((r) => [r.quantity, r.attachedTo ?? null]).sort(), tab).toEqual([
        [1, 'inv-0'],
        [2, null],
      ]);
      expect(rowsOf(p, 'rope'), tab).toHaveLength(1);
    }
  });

  it('a talisman peeled off one stack in EACH tab, onto two weapons: two peeled rows, each on its own weapon', () => {
    // Red with attachItem minting `inv-${max + 1}` (run 2026-10-20 on a scratch copy): both peeled rows
    // are `inv-3` and merge into one — `inA: one talisman on each weapon: expected [ 'inv-0' ] to deeply
    // equal [ 'inv-0', 'inv-2' ]`; the leg above then fails on `expected 'inv-2' to match …`.
    const base: PlayState = {
      ...emptyPlay(),
      inventory: [row('inv-0', 'longsword'), row('inv-1', 'potency-crystal', { quantity: 3 }), row('inv-2', 'dagger')],
    };
    const a = attachItem(base, 'inv-1', 'inv-0');
    const b = attachItem(base, 'inv-1', 'inv-2');
    for (const [tab, p] of Object.entries(bothTabs(base, a, b))) {
      const peeled = rowsOf(p, 'potency-crystal').filter((r) => r.attachedTo);
      expect(peeled.map((r) => r.attachedTo).sort(), `${tab}: one talisman on each weapon`).toEqual(['inv-0', 'inv-2']);
      expect(new Set(peeled.map((r) => r.instanceId)).size, tab).toBe(2);
    }
  });

  it('a companion’s pack: an item added in each tab — both stay', () => {
    const base: PlayState = { ...emptyPlay(), companions: [{ id: 'cmp-0', kind: 'animal', name: 'Rex', inventory: [] } as unknown as CompanionConfig] };
    const a = addCompanionItem(base, 'cmp-0', 'rope');
    const b = addCompanionItem(base, 'cmp-0', 'torch');
    for (const [tab, p] of Object.entries(bothTabs(base, a, b))) {
      expect(((p.companions![0] as CompanionConfig & { inventory?: InventoryItem[] }).inventory ?? []).map((i) => i.itemId).sort(), tab).toEqual(['rope', 'torch']);
    }
  });

  it('a companion added in each tab: two companions, neither mixed into the other', () => {
    const base: PlayState = { ...emptyPlay(), companions: [] };
    const a = addPlayCompanion(base, { kind: 'animal', name: 'Rex', typeId: 'wolf' } as Omit<CompanionConfig, 'id'>);
    const b = addPlayCompanion(base, { kind: 'familiar', name: 'Moth' } as Omit<CompanionConfig, 'id'>);
    for (const [tab, p] of Object.entries(bothTabs(base, a, b))) {
      expect((p.companions ?? []).map((c) => `${c.kind}:${c.name}:${c.typeId ?? ''}`).sort(), tab).toEqual(['animal:Rex:wolf', 'familiar:Moth:']);
    }
  });

  it('a notes page added in each tab: two pages', () => {
    const base: PlayState = { ...emptyPlay(), notes: [] };
    const a = updatePageTitle(addNotePage(base), 'Plan');
    const b = updatePageTitle(addNotePage(base), 'Suspects');
    for (const [tab, p] of Object.entries(bothTabs(base, a, b))) expect((p.notes ?? []).map((n) => n.title).sort(), tab).toEqual(['Plan', 'Suspects']);
  });

  it('a notes page opens on the id its add used: the caller mints it once and hands it over', () => {
    const base: PlayState = { ...emptyPlay(), notes: [] };
    const id = nextNoteId(base.notes!);
    expect(addNotePage(base, 'ti-note', undefined, id).notes![0].id).toBe(id);
  });

  it('a picture added in each tab: two pictures', () => {
    const base: PlayState = { ...emptyPlay(), appearance: { gallery: [] } };
    const a = addGalleryImage(base, 'data:image/png;base64,AAAA');
    const b = addGalleryImage(base, 'data:image/png;base64,BBBB');
    for (const [tab, p] of Object.entries(bothTabs(base, a, b))) expect((p.appearance?.gallery ?? []).map((g) => g.img).sort(), tab).toHaveLength(2);
  });

  it('Make profile picture in tab A while tab B captions that picture: the caption never lands on another picture', () => {
    // Red with makeProfileImage storing the old portrait under the promoted picture's id (HEAD's code),
    // run 2026-10-20 on a scratch copy: `the old portrait has an id of its own: expected 'img-…-0' not to
    // be 'img-…-0'`, and with that check taken out, `inA: a caption on the wrong picture: expected
    // 'data:old' to be 'data:castle'` — the old profile picture came out captioned "The castle".
    const base = addGalleryImage(setPortrait(emptyPlay(), 'data:old'), 'data:castle');
    const castle = base.appearance!.gallery![0].id;
    const a = makeProfileImage(base, castle);
    expect(a.appearance!.gallery![0].id, 'the old portrait has an id of its own').not.toBe(castle);
    const b = setGalleryCaption(base, castle, 'The castle');
    for (const [tab, p] of Object.entries(bothTabs(base, a, b))) {
      for (const g of p.appearance?.gallery ?? []) if (g.caption === 'The castle') expect(g.img, `${tab}: a caption on the wrong picture`).toBe('data:castle');
      expect((p.appearance?.gallery ?? []).some((g) => g.img === 'data:old'), `${tab}: the old portrait was lost`).toBe(true);
    }
  });
});

function updatePageTitle(p: PlayState, title: string): PlayState {
  return { ...p, notes: p.notes!.map((n, i, all) => (i === all.length - 1 ? { ...n, title } : n)) };
}

describe('id REUSE — tab A deletes the highest row and adds; tab B edits the deleted row', () => {
  it('the new item is never mixed with the old one', () => {
    const base = oldSave(); // potion inv-0, rope inv-1 (the highest)
    const a = addInventoryItem(removeInventoryItem(base, 'inv-1'), 'torch');
    const b = bumpItemQuantity(base, 'inv-1', 1); // two ropes now, in tab B
    for (const [tab, p] of Object.entries(bothTabs(base, a, b))) {
      expect(rowsOf(p, 'torch'), `${tab}: the torch took the rope’s edit`).toEqual([expect.objectContaining({ quantity: 1 })]);
      const torch = rowsOf(p, 'torch')[0];
      expect(torch.instanceId, `${tab}: the torch holds the deleted rope’s id`).not.toBe('inv-1');
      // Whatever became of the rope, nothing is half rope, half torch.
      for (const r of p.inventory ?? []) if (r.instanceId === 'inv-1') expect(r.itemId, tab).toBe('rope');
    }
  });
});

describe('DERIVED records — two tabs deriving the same record mint the SAME id (never a duplicate)', () => {
  it('the formula book two tabs grant at once (each on its own first tap) is ONE book, with both tabs’ changes', () => {
    const ch = build('alchemist', 1);
    expect(ch.inventory.some((i) => i.itemId === FORMULA_BOOK_ITEM_ID), 'fixture: an alchemist is granted the book').toBe(true);
    // A character whose play state predates the grant: no book in play, never handed one.
    const seeded = initialPlay(ch, db());
    const base: PlayState = { ...seeded, inventory: seeded.inventory!.filter((i) => i.itemId !== FORMULA_BOOK_ITEM_ID), formulaBookGranted: undefined };
    // App's updatePlay runs reconcileFormulaBook before every tap, in whichever tab the tap is in.
    const grantedA = reconcileFormulaBook(base, ch, db());
    const grantedB = reconcileFormulaBook(base, ch, db());
    const bookA = rowsOf(grantedA, FORMULA_BOOK_ITEM_ID)[0];
    expect(bookA.instanceId, 'a derived id is `inv-<item>-N`, no random part').toMatch(/^inv-formula-book-blank-\d+$/);
    expect(rowsOf(grantedB, FORMULA_BOOK_ITEM_ID)[0].instanceId).toBe(bookA.instanceId);
    const a = addFormula(grantedA, bookA.instanceId, 'elixir-of-life-minor'); // tab A's tap: write a formula in
    const b = addInventoryItem(grantedB, 'rope'); // tab B's tap: buy a rope
    for (const [tab, p] of Object.entries(bothTabs(base, a, b))) {
      const books = rowsOf(p, FORMULA_BOOK_ITEM_ID);
      expect(books.length, `${tab}: two formula books`).toBe(1);
      expect(books[0].formulas, `${tab}: tab A’s formula`).toEqual(['elixir-of-life-minor']);
      expect(rowsOf(p, 'rope'), `${tab}: tab B’s rope`).toHaveLength(1);
    }
  });

  it('a builder Save both tabs made from the same build adds the same rows, with the same ids', () => {
    const b0: BuildState = {
      ...emptyBuild(),
      name: 'Gear',
      level: 1,
      ancestryId: 'human',
      heritageId: 'versatile-human',
      backgroundId: 'acolyte',
      classId: 'fighter',
      keyAbility: 'str',
      inventory: [{ itemId: 'longsword', quantity: 1 }, { itemId: 'rations', quantity: 2 }, { itemId: 'torch', quantity: 1 }],
    };
    const built = (b: BuildState) => buildCharacter(b, contentFor(db(), b));
    const prev = built(b0);
    // An old save's own add sits at the id the builder's fourth row will want (`inv-3`).
    const play: PlayState = { ...initialPlay(prev, db()), inventory: [...initialPlay(prev, db()).inventory!, row('inv-3', 'dagger')] };
    const next = built({ ...b0, inventory: [...b0.inventory, { itemId: 'shortbow', quantity: 1 }] });
    const inA = playForRebuild(play, next, prev);
    const inB = playForRebuild(play, next, prev);
    expect(inA.inventory).toEqual(inB.inventory);
    const bow = rowsOf(inA, 'shortbow');
    expect(bow).toHaveLength(1);
    expect(bow[0].instanceId, 'the builder row moved off the taken id, to a DERIVED one').toMatch(/^inv-shortbow-\d+$/);
    expect(bow[0].instanceId).not.toBe('inv-3');
    for (const [tab, p] of Object.entries(bothTabs(play, inA, inB))) expect(rowsOf(p, 'shortbow'), `${tab}: the builder’s bow twice`).toHaveLength(1);
  });

  it('a built-in item edited into its own copy in tab A while tab B equips it: ONE row, the copy, equipped', () => {
    // Copy-on-write (InventoryTab / VitalsRail): only the row's itemId changes, under the same key, so the
    // plain merge takes it field by field. A guard against any merge rule that reads "a different itemId
    // under one key" as two records: round 2's split guard made this a phantom plain longsword
    // (checker's C1, 2026-10-20: `inA: rows: expected 3 to be 2`).
    const base: PlayState = { ...emptyPlay(), inventory: [row('inv-0', 'longsword'), row('inv-1', 'rope')] };
    const a = updateInventoryItem(base, 'inv-0', { itemId: 'custom-longsword-k2j4h' });
    const b = updateInventoryItem(base, 'inv-0', { equipped: true });
    for (const [tab, p] of Object.entries(bothTabs(base, a, b))) {
      expect((p.inventory ?? []).length, `${tab}: rows`).toBe(2);
      expect((p.inventory ?? []).find((r) => r.instanceId === 'inv-0'), tab).toMatchObject({ itemId: 'custom-longsword-k2j4h', equipped: true });
    }
  });

  it('an automatic companion made real in both tabs is ONE companion carrying both tabs’ edits', () => {
    const base: PlayState = { ...emptyPlay(), companions: [{ id: 'cmp-0', kind: 'animal', name: 'Rex' } as CompanionConfig] };
    const cfg = { kind: 'eidolon', name: '' } as unknown as Omit<CompanionConfig, 'id'>;
    const id = derivedCompanionId(base.companions!, 'eidolon-auto');
    expect(id).toBe('cmp-eidolon-auto-1');
    // Each tab's edit sets a field the made-real companion did not have (a record new on both sides has
    // no base to say who changed a field both hold — see rosterMerge.ts).
    const a = updatePlayCompanion(addPlayCompanion(base, cfg, id), id, { typeId: 'angel-eidolon' });
    const b = updatePlayCompanion(addPlayCompanion(base, cfg, id), id, { portrait: 'data:image/png;base64,AAAA' });
    for (const [tab, p] of Object.entries(bothTabs(base, a, b))) {
      const eidolons = (p.companions ?? []).filter((c) => c.kind === 'eidolon');
      expect(eidolons.length, `${tab}: the eidolon twice`).toBe(1);
      expect(eidolons[0], tab).toMatchObject({ id, typeId: 'angel-eidolon', portrait: 'data:image/png;base64,AAAA' });
    }
  });

  it('a DIFFERENT automatic companion made real in each tab (the eidolon here, the Pet feat’s familiar there): two companions, unmixed', () => {
    // Red with the derived id `cmp-N` (the first round's fix, and HEAD), run 2026-10-20 on a scratch
    // copy: `inA: expected 2 to be 3` — one creature carrying the eidolon's kind and the pet's grant.
    const base: PlayState = { ...emptyPlay(), companions: [{ id: 'cmp-0', kind: 'animal', name: 'Rex' } as CompanionConfig] };
    const eidolon = { kind: 'eidolon', name: 'Spirit', typeId: 'angel-eidolon' } as unknown as Omit<CompanionConfig, 'id'>;
    const pet = { kind: 'familiar', name: 'Moth', grantSlug: 'pet', abilities: ['scent'] } as unknown as Omit<CompanionConfig, 'id'>;
    const a = addPlayCompanion(base, eidolon, derivedCompanionId(base.companions!, 'eidolon-auto'));
    const b = addPlayCompanion(base, pet, derivedCompanionId(base.companions!, 'featcmp-pet'));
    for (const [tab, p] of Object.entries(bothTabs(base, a, b))) {
      const list = p.companions ?? [];
      expect(list.length, tab).toBe(3);
      expect(list.find((c) => c.kind === 'eidolon'), `${tab}: the eidolon`).toMatchObject({ name: 'Spirit', typeId: 'angel-eidolon' });
      expect(list.find((c) => c.kind === 'eidolon')?.grantSlug, `${tab}: the eidolon carries the pet’s grant`).toBeUndefined();
      expect(list.find((c) => c.kind === 'familiar'), `${tab}: the pet`).toMatchObject({ name: 'Moth', grantSlug: 'pet' });
    }
  });

  it('making real an automatic companion the list already holds (made real in the other tab, folded in since) adds nothing', () => {
    const base: PlayState = { ...emptyPlay(), companions: [] };
    const cfg = { kind: 'eidolon', name: '' } as unknown as Omit<CompanionConfig, 'id'>;
    const id = derivedCompanionId([], 'eidolon-auto');
    const once = addPlayCompanion(base, cfg, id);
    expect(addPlayCompanion(once, cfg, id)).toBe(once);
  });

  it('…while a player’s Add gets a unique id, never the derived one', () => {
    const base: PlayState = { ...emptyPlay(), companions: [] };
    const added = addPlayCompanion(base, { kind: 'familiar', name: 'Moth' } as Omit<CompanionConfig, 'id'>);
    expect(added.companions![0].id).toMatch(/^cmp-[a-z0-9]+-0$/);
  });
});

describe('a builder Save that REPLACES a row never hands the new item the old row’s id (play.ts mergeRebuiltInventory)', () => {
  /*
   * A build row's id is its build INDEX (`inv-1`). Replacing the rope at index 1 with a shortbow gave the
   * shortbow `inv-1`, and the Save removed the untouched rope — which was still `inv-1` in another tab.
   * Its click on that rope then MERGED into the shortbow (the merge goes by key), or its delete deleted
   * the shortbow. Rounds 1–2 tried to tell the two apart inside the merge; the fix is at the mint: every
   * id the play inventory held when the Save began (and every id the previous build handed over) is
   * taken, so the shortbow gets `inv-shortbow-N`.
   * RED with the old mint (only `kept` + `added` taken; run 2026-10-20 on a scratch copy): the first
   * leg on `the bow holds the rope’s id: expected 'inv-1' not to be 'inv-1'`, the two-tabs leg on `bump,
   * inA: a bow carrying the rope’s edit` (a shortbow ×3); run on the delete alone, with the key check
   * taken out, on `delete, inB: the bow: expected [] to have a length of 1 but got +0` — the bow lost.
   */
  const gear = (items: BuildState['inventory']): BuildState => ({
    ...emptyBuild(),
    name: 'Gear',
    level: 1,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: 'acolyte',
    classId: 'fighter',
    keyAbility: 'str',
    inventory: items,
  });
  const built = (b: BuildState) => buildCharacter(b, contentFor(db(), b));
  const SWORD = { itemId: 'longsword', quantity: 1 };
  const prev = built(gear([SWORD, { itemId: 'rope', quantity: 1 }]));
  const next = built(gear([SWORD, { itemId: 'shortbow', quantity: 1 }]));
  const play = () => initialPlay(prev, db());
  const ropeId = () => rowsOf(play(), 'rope')[0].instanceId;
  const j = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  /** One tab folding another's write, as rosterTabs hands it over: (base, this tab, the write). */
  const fold = (base: PlayState, local: PlayState, incoming: PlayState): PlayState =>
    mergeRosterEdits([entry(j(base))], [entry(j(local))], [entry(j(incoming))])[0].play;

  it('the new item gets an id of its own (a DERIVED one, the same in every tab), never the rope’s', () => {
    expect(next.inventory.find((i) => i.itemId === 'shortbow')!.instanceId, 'fixture: the build hands the bow the rope’s index').toBe(ropeId());
    const a = playForRebuild(play(), next, prev);
    expect(rowsOf(a, 'rope'), 'fixture: the untouched rope left with the Save').toHaveLength(0);
    const bow = rowsOf(a, 'shortbow');
    expect(bow).toHaveLength(1);
    expect(bow[0].instanceId, 'the bow holds the rope’s id').not.toBe(ropeId());
    expect(bow[0].instanceId).toMatch(/^inv-shortbow-\d+$/);
    expect(playForRebuild(play(), next, prev).inventory, 'two tabs Saving the same build mint the same id').toEqual(a.inventory);
  });

  it('…while tab B bumps, equips or deletes the old rope: never mixed, the bow never lost, the tabs converge', () => {
    const edits: Record<string, (p: PlayState) => PlayState> = {
      bump: (p) => bumpItemQuantity(p, ropeId(), 2),
      equip: (p) => updateInventoryItem(p, ropeId(), { worn: true }),
      delete: (p) => removeInventoryItem(p, ropeId()),
    };
    for (const [name, edit] of Object.entries(edits)) {
      const base = play();
      const a = playForRebuild(base, next, prev);
      const b = edit(base);
      // Both write inside one debounce, each folding the other's write on its own state.
      for (const [tab, p] of Object.entries(bothTabs(base, a, b))) {
        const bows = rowsOf(p, 'shortbow');
        expect(bows, `${name}, ${tab}: the bow`).toHaveLength(1);
        expect(bows[0], `${name}, ${tab}: a bow carrying the rope’s edit`).toEqual({ instanceId: bows[0].instanceId, itemId: 'shortbow', quantity: 1 });
        for (const r of p.inventory ?? []) if (r.instanceId === ropeId()) expect(r.itemId, `${name}, ${tab}: the rope’s key holds another item`).toBe('rope');
        expect(new Set((p.inventory ?? []).map((r) => r.instanceId)).size, `${name}, ${tab}: one id per row`).toBe((p.inventory ?? []).length);
      }
      // The real order: one tab's write lands first, the other folds it into its own and writes; the first
      // then takes that write. Either way round, both end on ONE inventory holding the bow.
      for (const [order, [first, second]] of Object.entries({ 'A first': [a, b], 'B first': [b, a] })) {
        const secondWrites = fold(base, second, first);
        const firstTakes = fold(first, first, secondWrites);
        expect(firstTakes.inventory, `${name}, ${order}: the tabs converge`).toEqual(secondWrites.inventory);
        expect(rowsOf(secondWrites, 'shortbow'), `${name}, ${order}: the bow was lost`).toHaveLength(1);
        expect(rowsOf(secondWrites, 'longsword'), `${name}, ${order}: the sword`).toHaveLength(1);
      }
    }
  });

  it('saving the builder again with no change adds nothing; a later Save asking for a SECOND bow still gets it', () => {
    // RED with "deleted in play" read off the build INDEX (the bow lives at `inv-shortbow-N`, not `inv-1`,
    // so the next Save counted the bow as sold and swallowed the second one; run 2026-10-20 on a scratch
    // copy): `the second bow: expected [ { …(5) } ] to have a length of 2 but got 1`.
    const once = playForRebuild(play(), next, prev);
    const again = playForRebuild(once, next, next);
    expect(again.inventory, 'a Save that changes nothing changes nothing').toEqual(once.inventory);
    const two = built(gear([SWORD, { itemId: 'shortbow', quantity: 1 }, { itemId: 'shortbow', quantity: 1 }]));
    expect(rowsOf(playForRebuild(again, two, next), 'shortbow'), 'the second bow').toHaveLength(2);
    // …and still never the first bow handed back after the player sold it.
    const sold = { ...again, inventory: again.inventory!.filter((r) => r.itemId !== 'shortbow') };
    expect(rowsOf(playForRebuild(sold, next, next), 'shortbow'), 'a sold bow came back').toHaveLength(0);
  });

  it('a built-in item edited into its own copy in play: a Save with no change does not hand the plain one back beside it', () => {
    // RED with 6393b29's count (the row's build index is still live, so nothing counted it gone; run
    // 2026-10-20 on a scratch copy): `a second, plain longsword: expected [ { …(5) } ] to have a length of
    // +0 but got 1`.
    const p0 = play();
    const copied = updateInventoryItem(p0, rowsOf(p0, 'longsword')[0].instanceId, { itemId: 'custom-longsword-k2j4h' });
    expect(rowsOf(playForRebuild(copied, prev, prev), 'longsword'), 'a second, plain longsword').toHaveLength(0);
  });

  it('the build’s item spells find the replaced row by its item — never another row at that index', () => {
    // RED with SpellsTab's old lookup by id alone (run 2026-10-20 on a scratch copy): `the wand’s row:
    // expected undefined to be { …(5) }` — the wand's spells lost their charges and cast button; with the
    // by-item fallback but the row at the index taken whatever it holds, the sold-wand leg: `expected {
    // instanceId: 'inv-0', …(4) } to be undefined` (the sword, which a cast would have spent).
    const wandBuild = built(gear([SWORD, { itemId: 'wand-of-fey-flames', quantity: 1 }]));
    const out = playForRebuild(play(), wandBuild, prev);
    const sheet = applyPlayState(wandBuild, out, db());
    const e = sheet.spellcasting.find((x) => x.type === 'items' && /Fey Flames/.test(x.name))!;
    expect(e.itemInstanceId, 'fixture: the entry names the build index').toBe(ropeId());
    const wandRow = rowsOf(out, 'wand-of-fey-flames')[0];
    expect(itemSpellRow(e, sheet.inventory, db().items), 'the wand’s row').toBe(sheet.inventory.find((r) => r.instanceId === wandRow.instanceId));
    // The wand sold, and its index now names the SWORD: no row, rather than casting (and spending) the sword.
    const swordAt = sheet.inventory.find((r) => r.itemId === 'longsword')!;
    expect(itemSpellRow({ ...e, itemInstanceId: swordAt.instanceId }, sheet.inventory.filter((r) => r !== wandRow && r.itemId !== 'wand-of-fey-flames'), db().items)).toBeUndefined();
    // A copy-on-write copy of the wand is still the wand's row.
    const copy = { ...wandRow, itemId: 'custom-wand-x' };
    expect(itemSpellRow(e, [swordAt, copy], { 'custom-wand-x': { basedOn: 'wand-of-fey-flames' } })).toBe(copy);
  });

  /** The sheet after a builder Save from `from` to `to` (`use` = what the player did in play first), and
   *  the row each item-spell entry resolves to. */
  const swapped = (from: BuildState['inventory'], to: BuildState['inventory'], use: (p: PlayState) => PlayState = (p) => p) => {
    const before = built(gear(from));
    const after = built(gear(to));
    const out = playForRebuild(use(initialPlay(before, db())), after, before);
    const sheet = applyPlayState(after, out, db());
    const entries = sheet.spellcasting.filter((x) => x.type === 'items');
    return { out, sheet, entries, rows: itemSpellRows(entries, sheet.inventory, db().items) };
  };
  const SCROLL = '1st-rank-scroll';
  const scroll = (heldSpell: string) => ({ itemId: SCROLL, quantity: 1, heldSpell });
  const ROPE = { itemId: 'rope', quantity: 1 };
  const spellsHeld = (p: PlayState) => rowsOf(p, SCROLL).map((r) => r.heldSpell).sort();
  const useScroll = (spell: string) => (p: PlayState) => removeInventoryItem(p, (p.inventory ?? []).find((r) => r.heldSpell === spell)!.instanceId);

  it('two scrolls of one item holding different spells: the Save hands over the right scroll, and each entry casts from ITS scroll', () => {
    // Checker, 2026-10-20, round 3: a fear-scroll cast that found the heal scroll removed the heal scroll.
    // And a heal scroll and a fear scroll are ONE itemId, so the Save matched them to each other.
    // RED (runs 2026-10-20 on a scratch copy) — the Save matching by itemId alone: `the Save: one heal
    // scroll and one fear scroll: expected [ 'heal', 'heal' ] to deeply equal [ 'fear', 'heal' ]` and, for
    // (2), `expected [ 'heal' ] to deeply equal [ 'fear' ]`; `itemHeldSpell` ignored by the row lookup:
    // `the heal entry on the fear scroll: expected { …(6) } to be undefined`.
    // (1) The fear scroll in the rope's place, the heal scroll kept: both on the sheet, once each.
    const one = swapped([ROPE, scroll('heal')], [scroll('fear'), scroll('heal')]);
    expect(spellsHeld(one.out), 'the Save: one heal scroll and one fear scroll').toEqual(['fear', 'heal']);
    expect(one.entries.map((e) => e.itemHeldSpell).sort(), 'fixture: one entry per scroll').toEqual(['fear', 'heal']);
    for (const e of one.entries) expect(one.rows.get(e.id)?.heldSpell, `the ${e.itemHeldSpell} entry’s row`).toBe(e.itemHeldSpell);
    // (2) The heal scroll USED in play, then the same swap: the fear scroll arrives, the used one stays used.
    const two = swapped([ROPE, scroll('heal')], [scroll('fear'), scroll('heal')], useScroll('heal'));
    expect(spellsHeld(two.out), 'the used heal scroll came back, or the fear scroll never came').toEqual(['fear']);
    // (3) …and the heal entry, whose scroll is gone, casts from NOTHING — never from the fear scroll.
    const three = swapped([scroll('heal'), ROPE], [scroll('heal'), scroll('fear')], useScroll('heal'));
    expect(spellsHeld(three.out), 'fixture: only the fear scroll').toEqual(['fear']);
    const heal = three.entries.find((e) => e.itemHeldSpell === 'heal')!;
    const fear = three.entries.find((e) => e.itemHeldSpell === 'fear')!;
    expect(three.rows.get(heal.id), 'the heal entry on the fear scroll').toBeUndefined();
    expect(three.rows.get(fear.id)?.heldSpell, 'the fear entry’s row').toBe('fear');
  });

  it('removing a scroll in the builder never re-labels the scroll the player KEPT (the rows after it move up an index)', () => {
    // Checker, 2026-10-20, round 5: the builder has no scroll or wand spell picker, so "same build index,
    // same item, another spell" only comes from a removal moving the later rows up. A rule that gave the
    // kept row the build's spell at its index (round 4's "respell") turned the player's packed heal scroll
    // into the fear scroll they had just used. RED with that rule (run 2026-10-20 on a scratch copy):
    // `the kept scroll keeps its spell: expected [ 'fear' ] to deeply equal [ 'heal' ]`.
    const PACK = { itemId: 'backpack', quantity: 1 };
    const packHealUseFear = (p: PlayState) => {
      const pack = rowsOf(p, 'backpack')[0].instanceId;
      const heal = (p.inventory ?? []).find((r) => r.heldSpell === 'heal')!;
      return useScroll('fear')(updateInventoryItem(p, heal.instanceId, { containerInstanceId: pack }));
    };
    const { out } = swapped([PACK, scroll('heal'), scroll('fear')], [PACK, scroll('fear')], packHealUseFear);
    expect(spellsHeld(out), 'the kept scroll keeps its spell (and the used one stays used)').toEqual(['heal']);
    expect(rowsOf(out, SCROLL)[0].containerInstanceId, 'still in the pack').toBe(rowsOf(out, 'backpack')[0].instanceId);
  });

  it('two identical wands (the second put in place of the rope): two entries, two rows — never one charge shared', () => {
    // RED with every entry resolved on its own (no row marked used; run 2026-10-20 on a scratch copy):
    // `two entries on ONE wand: expected 1 to be 2`.
    const WAND = { itemId: 'wand-of-fey-flames', quantity: 1 };
    const { entries, rows } = swapped([WAND, { itemId: 'rope', quantity: 1 }], [WAND, WAND]);
    expect(entries, 'fixture: one entry per wand').toHaveLength(2);
    const got = entries.map((e) => rows.get(e.id));
    expect(got.every((r) => r?.itemId === WAND.itemId), 'each entry has a wand').toBe(true);
    expect(new Set(got).size, 'two entries on ONE wand').toBe(2);
  });

  it('a second swap at the same spot (or dropping the replacement) takes the untouched first replacement off the sheet', () => {
    // The bow, put in the rope's place by Save 1, lives at `inv-shortbow-N`, so the leftovers rule's match
    // by id alone never found it (checker, 2026-10-20, round 3). RED (runs 2026-10-20 on a scratch copy)
    // with that match: `swap twice: expected [ 'crossbow', 'longsword', 'shortbow' ] to deeply equal [
    // 'crossbow', 'longsword' ]`; with the derived-id match but no byte-identical test: `a touched bow:
    // expected [] to have a length of 1 but got +0`; with any id that is byte-identical: `the bought bow:
    // expected [] to have a length of 1 but got +0`.
    const p1 = playForRebuild(play(), next, prev);
    const cross = built(gear([SWORD, { itemId: 'crossbow', quantity: 1 }]));
    const p2 = playForRebuild(p1, cross, next);
    expect((p2.inventory ?? []).map((r) => r.itemId).sort(), 'swap twice').toEqual(['crossbow', 'longsword']);
    const dropped = playForRebuild(p1, built(gear([SWORD])), next);
    expect((dropped.inventory ?? []).map((r) => r.itemId), 'the bow dropped in the builder').toEqual(['longsword']);
    // …but a bow the player TOUCHED (bumped) stays: we cannot tell it is the build's.
    const bumped = bumpItemQuantity(p1, rowsOf(p1, 'shortbow')[0].instanceId, 1);
    expect(rowsOf(playForRebuild(bumped, cross, next), 'shortbow'), 'a touched bow').toHaveLength(1);
    // …and a bow the player BOUGHT (a unique id), identical to the build's, is never taken for it.
    const sold = removeInventoryItem(p1, rowsOf(p1, 'shortbow')[0].instanceId);
    const bought = addInventoryItem(sold, 'shortbow');
    expect(rowsOf(bought, 'shortbow')[0].instanceId, 'fixture: a unique id').toMatch(UNIQUE);
    expect(rowsOf(playForRebuild(bought, built(gear([SWORD])), next), 'shortbow'), 'the bought bow').toHaveLength(1);
  });

  it('the rope deleted in tab A just before its Save, while tab B bumps it: the bow never takes the rope’s id', () => {
    // The previous build's ids count as taken too: tab A's play inventory no longer holds the rope, but tab
    // B's still does (checker, 2026-10-20, round 3: nothing went red when they were left out). RED with
    // `held` = the play inventory's ids only (run 2026-10-20 on a scratch copy): `inA: a bow carrying the
    // rope’s edit: expected { instanceId: 'inv-1', …(2) } to deeply equal { instanceId: 'inv-1', …(2) }`
    // (a shortbow ×3 on the rope's key).
    const base = play();
    const a = playForRebuild(removeInventoryItem(base, ropeId()), next, prev);
    const b = bumpItemQuantity(base, ropeId(), 2);
    for (const [tab, p] of Object.entries(bothTabs(base, a, b))) {
      const bows = rowsOf(p, 'shortbow');
      expect(bows, `${tab}: the bow`).toHaveLength(1);
      expect(bows[0], `${tab}: a bow carrying the rope’s edit`).toEqual({ instanceId: bows[0].instanceId, itemId: 'shortbow', quantity: 1 });
    }
  });
});

describe('counts and coins merge as VALUES (rosterMerge.ts header: chosen 2026-10-20)', () => {
  /*
   * The checkers proposed merging a stack's quantity and the purse as CHANGES (base + both deltas). Not
   * done: a three-way merge cannot tell two changes from one change seen twice, and the same cloud copy
   * IS adopted in both tabs at once (every tab runs cloud sync). These pin the choice both ways.
   * MUTATION (run 2026-10-20 on a scratch copy): the proposed counter merge in mergeValue — the first
   * leg fails on `inA: the purse: expected { gp: 8 } to deeply equal { gp: 9 }` (the other device's 1 gp
   * charged twice), and the `it.fails` leg turns red with `Expect test to fail` (it closes the gap).
   */
  it('ONE change seen in both tabs (the same cloud copy adopted in each) counts once — never twice', () => {
    const base: PlayState = { ...emptyPlay(), currency: { gp: 10 }, inventory: [row('inv-0', 'healing-potion-minor', { quantity: 3 })] };
    // Their other device drank a potion and bought a 1 gp item; both tabs adopt that copy.
    const adopted: PlayState = { ...base, currency: { gp: 9 }, inventory: [row('inv-0', 'healing-potion-minor', { quantity: 2 })] };
    for (const [tab, p] of Object.entries(bothTabs(base, { ...adopted, heroPoints: 1 }, { ...adopted, heroPoints: 2 }))) {
      expect(p.currency, `${tab}: the purse`).toEqual({ gp: 9 });
      expect(rowsOf(p, 'healing-potion-minor')[0].quantity, `${tab}: the potions`).toBe(2);
    }
  });

  /* KNOWN GAP, pinned so it cannot go unnoticed either way: two BUYS in two tabs inside one 400 ms
   * debounce keep both items (the id fix) but take one payment — the purse is one value both changed.
   * `it.fails` passes while the gap is open; whoever closes it (per-change ids) flips it to `it`. */
  it.fails('two buys in two tabs inside one debounce pay for both (open: one payment is taken)', () => {
    const base: PlayState = { ...emptyPlay(), currency: { gp: 10 }, inventory: [] };
    const a = buyItem(base, 'rope', { sp: 5 });
    const b = buyItem(base, 'dagger', { sp: 2 });
    for (const [tab, p] of Object.entries(bothTabs(base, a, b))) {
      expect(rowsOf(p, 'rope').length + rowsOf(p, 'dagger').length, `${tab}: both items`).toBe(2);
      expect(coinsToCp(p.currency), `${tab}: the purse`).toBe(930);
    }
  });
});

describe('editing a row keeps its id (nothing re-mints an existing record)', () => {
  it('quantity, flags and patches leave the instanceId alone', () => {
    let p = addInventoryItem(oldSave(), 'rope');
    const id = p.inventory![2].instanceId;
    p = bumpItemQuantity(p, id, 2);
    p = updateInventoryItem(p, id, { worn: true });
    expect(p.inventory![2]).toMatchObject({ instanceId: id, quantity: 3, worn: true });
  });
});
