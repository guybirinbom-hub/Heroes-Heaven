import { describe, expect, it } from 'vitest';
import { collectCarried, referencedIds } from '../src/data/carried';
import { seedContent } from '../src/rules/seed';
import { CATALOG_MODES } from '../src/rules/modes';
import { isPrintedId } from '../src/data';
import type { ContentDatabase } from '../src/rules/types';
import type { SavedChar } from '../src/data/storage';

/**
 * Owner ruling 2026-10-20 (Guy): "the others should see the same item as the player". A character's
 * custom records ride along on the sheet it SENDS (src/data/carried.ts collectCarried). These legs pin
 * WHAT is collected: every homebrew record the sheet references — by any field, by an object KEY, and
 * through another homebrew record — and nothing else, in one deterministic order.
 *
 * Every record and character here is synthetic.
 */

const HB = { license: 'homebrew', book: 'Tidewater Notes' } as const;
const ITEM = { id: 'hb-item-brine-lantern', name: 'Brine Lantern', traits: [], level: 1, source: HB };
const FEAT = {
  id: 'hb-feat-tidecaller',
  name: 'Tidecaller',
  traits: [],
  level: 1,
  source: HB,
  // A homebrew feat granting a homebrew spell: the sheet never names the spell itself.
  grants: { spells: [{ spellId: 'hb-spell-undertow' }] },
};
const SPELL_KEYED = { id: 'hb-spell-salt-mist', name: 'Salt Mist', traits: [], rank: 0, source: HB };
const SPELL_GRANTED = { id: 'hb-spell-undertow', name: 'Undertow', traits: [], rank: 1, source: HB };
const UNUSED = { id: 'hb-item-never-carried', name: 'Never Carried', traits: [], level: 0, source: HB };
// A printed record the sheet references: never carried (someone's content may add records, never the book's).
const PRINTED = { id: 'printed-longsword-x', name: 'Longsword', traits: [], level: 0, source: { license: 'ORC', book: 'Player Core' } };
// An id the book prints, overridden by the owner's homebrew: still never carried.
const SEED_ITEM_ID = Object.keys(seedContent.items)[0];

const db = (order: 'a' | 'b' = 'a'): ContentDatabase => {
  const items = [ITEM, UNUSED, PRINTED, { id: SEED_ITEM_ID, name: 'My Own Version', traits: [], source: HB }];
  const spells = [SPELL_KEYED, SPELL_GRANTED];
  const pick = <T,>(xs: T[]) => (order === 'a' ? xs : [...xs].reverse());
  return {
    items: Object.fromEntries(pick(items).map((x) => [x.id, x])),
    feats: { [FEAT.id]: FEAT },
    spells: Object.fromEntries(pick(spells).map((x) => [x.id, x])),
    ancestries: {},
    heritages: {},
    backgrounds: {},
    actions: {},
    deities: {},
  } as unknown as ContentDatabase;
};

const sheet = (order: 'a' | 'b' = 'a'): SavedChar => {
  const inv = [
    { instanceId: 'r1', itemId: ITEM.id, quantity: 1 },
    { instanceId: 'r2', itemId: PRINTED.id, quantity: 1 },
    { instanceId: 'r3', itemId: SEED_ITEM_ID, quantity: 1 },
  ];
  return {
    id: 'c-test-marisol',
    character: {
      name: 'Marisol Tern',
      inventory: order === 'a' ? inv : [...inv].reverse(),
      // The spell is referenced ONLY as a key here, the way spellSources keys its spells.
      spellcasting: [{ id: 'innate', spellSources: { [SPELL_KEYED.id]: 'Tidecaller' } }],
    },
    build: { featPicks: { '1:ancestry:0': FEAT.id } },
    play: {},
  } as unknown as SavedChar;
};

describe('collectCarried — what a sent sheet carries', () => {
  it('collects a homebrew item, feat and spell referenced through an inventory itemId, a feat pick and a spellSources KEY', () => {
    // mutation-proof: drop `out.add(k)` for object keys in referencedIds (src/data/carried.ts) and this goes red
    // (Salt Mist is referenced only as a key).
    const c = collectCarried(sheet(), db(), { isPrinted: () => false })!;
    expect(Object.keys(c.items ?? {})).toContain(ITEM.id);
    expect(Object.keys(c.feats ?? {})).toEqual([FEAT.id]);
    expect(Object.keys(c.spells ?? {}), 'a spell named only as a spellSources key').toContain(SPELL_KEYED.id);
    expect(c.items![ITEM.id], 'the record itself, as the sender sees it').toBe(ITEM);
  });

  it("follows a homebrew feat's own reference to a homebrew spell", () => {
    // mutation-proof: drop the `queue.push(ref)` of a collected record's own references in collectCarried and
    // this goes red (Undertow is named only inside the Tidecaller feat).
    const c = collectCarried(sheet(), db(), { isPrinted: () => false })!;
    expect(Object.keys(c.spells ?? {})).toEqual([SPELL_KEYED.id, SPELL_GRANTED.id].sort());
  });

  it('leaves out printed records — by license and by printed id — and homebrew the sheet never references', () => {
    // mutation-proof: drop `|| isPrinted(type, id)` in collectCarried and this goes red (the seed id is carried).
    const c = collectCarried(sheet(), db())!; // the real isPrintedId: the seed's own ids are printed
    expect(Object.keys(c.items ?? {})).toEqual([ITEM.id]);
    expect(c.items![PRINTED.id], 'a printed record (ORC license) never rides along').toBeUndefined();
    expect(c.items![SEED_ITEM_ID], 'an own homebrew reusing a printed id never rides along').toBeUndefined();
    expect(c.items![UNUSED.id], 'unreferenced homebrew stays home').toBeUndefined();
    expect(c.ancestries, 'no empty buckets').toBeUndefined();
  });

  it('a copy-on-write `custom-` item still under the book license (not yet re-merged) is carried', () => {
    const copy = { id: 'custom-longsword-k3j', name: 'Notched Longsword', traits: [], source: { license: 'ORC' } };
    const d = { ...db(), items: { ...db().items, [copy.id]: copy } } as ContentDatabase;
    const s = sheet();
    (s.character as unknown as { inventory: unknown[] }).inventory.push({ instanceId: 'r9', itemId: copy.id, quantity: 1 });
    expect(collectCarried(s, d, { isPrinted: () => false })!.items![copy.id]).toBe(copy);
  });

  it('is deterministic: the same JSON whatever order the sheet and the database list things in', () => {
    // mutation-proof: drop the `.sort()` of the ids in collectCarried and this goes red.
    const a = JSON.stringify(collectCarried(sheet('a'), db('a'), { isPrinted: () => false }));
    const b = JSON.stringify(collectCarried(sheet('b'), db('b'), { isPrinted: () => false }));
    expect(b).toBe(a);
    expect(Object.keys(JSON.parse(a))).toEqual(['feats', 'items', 'spells']);
  });

  it("follows a .ref-link inside a homebrew record's description (and inside long notes) to the record it links", () => {
    // 2026-10-20, checker finding semantics-C3: the link in a carried feat's description opened nothing on the
    // GM's device, because the spell it links rode nowhere.
    // mutation-proof: drop `for (const id of refLinkIds(v)) out.add(id)` from referencedIds
    // (src/data/carried.ts) and this goes red (Ember Bolt and Cinder Ward are named only inside a link).
    const BOLT = { id: 'hb-spells-ember-bolt-ab12', name: 'Ember Bolt', traits: [], rank: 1, source: HB };
    const WARD = { id: "hb-spells-cinder-ward-o'7", name: 'Cinder Ward', traits: [], rank: 1, source: HB };
    const ADEPT = {
      id: 'hb-feat-ember-adept',
      name: 'Ember Adept',
      traits: [],
      level: 1,
      source: HB,
      // Written the way the rich editor writes a link (src/sheet/RichEditor.tsx), attribute-escaped.
      description: `<p>You learn <a class="ref-link" data-ref-key="spells" data-ref-id="${BOLT.id}">Ember Bolt</a>.</p>`,
    };
    const d = { ...db(), feats: { [ADEPT.id]: ADEPT }, spells: { [BOLT.id]: BOLT, [WARD.id]: WARD } } as unknown as ContentDatabase;
    const s = { id: 'c-ref', character: { name: 'Ash Wren' }, build: { featPicks: { '1:class:0': ADEPT.id } }, play: {} } as unknown as SavedChar;
    expect(Object.keys(collectCarried(s, d, { isPrinted: () => false })!.spells ?? {})).toEqual([BOLT.id]);
    // A link in the character's own notes — a string far past the id length limit — counts too.
    const notes = 'x'.repeat(600) + `<a class="ref-link" data-ref-key="spells" data-ref-id="hb-spells-cinder-ward-o&#39;7">Cinder Ward</a>`;
    const withNotes = { ...s, play: { notes } } as unknown as SavedChar;
    expect(Object.keys(collectCarried(withNotes, d, { isPrinted: () => false })!.spells ?? {}).sort()).toEqual([BOLT.id, WARD.id].sort());
  });

  it('a homebrew heritage named only by a phase-2 "Take anyway" block rides along, and stops once the block is gone (tweaks p2 WP1, C32)', () => {
    // tweaks p2 WP1: a choice block stores the record id as its own whole string field (C32), so the GM's device
    // gets the heritage the player took anyway; the block's id and kind are no record and are never carried.
    const HERITAGE = { id: 'hb-heritage-reef-born', name: 'Reef-Born', traits: [], ancestryId: 'hb-ancestry-none', source: HB };
    const d = { ...db(), heritages: { [HERITAGE.id]: HERITAGE } } as unknown as ContentDatabase;
    const block = { id: 't1_k3f9', kind: 'choice.allowAnywayAnyPicker', v: 1, picker: 'heritage', record: HERITAGE.id, reason: 'GM: raised in the reef' };
    const withBlock = (blocks: unknown[]): SavedChar => {
      const s = sheet();
      return { ...s, build: { ...(s.build as object), heritageId: HERITAGE.id, overrides: { blocks } } } as unknown as SavedChar;
    };
    expect(Object.keys(collectCarried(withBlock([block]), d, { isPrinted: () => false })!.heritages ?? {})).toEqual([HERITAGE.id]);
    // named ONLY by the block (the pick itself cleared): still carried — a paused or kept block still points at it
    const onlyBlock = withBlock([{ ...block, on: false }]);
    delete (onlyBlock.build as { heritageId?: string }).heritageId;
    expect(Object.keys(collectCarried(onlyBlock, d, { isPrinted: () => false })!.heritages ?? {})).toEqual([HERITAGE.id]);
    // the block deleted and the pick gone: nothing of it rides along
    const gone = withBlock([]);
    delete (gone.build as { heritageId?: string }).heritageId;
    expect(collectCarried(gone, d, { isPrinted: () => false })!.heritages).toBeUndefined();
  });

  it('nothing to carry is undefined, and a sheet\'s own `carried` is never read as a reference', () => {
    const plain = { id: 'c-plain', character: { name: 'Plain' }, build: {}, play: {} } as unknown as SavedChar;
    expect(collectCarried(plain, db(), { isPrinted: () => false })).toBeUndefined();
    const stale = { ...plain, carried: { items: { [UNUSED.id]: UNUSED } } } as unknown as SavedChar;
    expect(referencedIds(stale).has(UNUSED.id), 'an id only inside carried is no reference').toBe(false);
    expect(collectCarried(stale, db(), { isPrinted: () => false }), 'a record no longer used stops riding along').toBeUndefined();
  });
});

describe('collectCarried — the player’s own MODES (round 2, 2026-10-20)', () => {
  /*
   * Checker finding coverage-F3: applyPlayState drops an active mode id the viewer's `content.modes` lacks, so
   * while a custom mode was on, the GM, the teammates and the tracker saw a different AC from the player's.
   * A mode the player WROTE now rides along when the sheet names it (an active mode, a companion's) — never a
   * catalog mode, a consumable's item mode or a gated content mode (src/rules/modes.ts playerModeLibrary).
   */
  const MINE = { id: 'mode-salt-guard-k1', name: 'Salt Guard', modifiers: [{ value: 2, type: 'status', target: 'ac' }] };
  const COMPANION = { id: 'mode-gull-dive-k2', name: 'Gull Dive', modifiers: [{ value: 1, type: 'circumstance', target: 'attack' }] };
  const IDLE = { id: 'mode-never-on-k3', name: 'Never On', modifiers: [] };
  const CATALOG_ID = CATALOG_MODES[0].id;
  const ITEM_MODE = { id: 'elixir-of-brine-mode', name: 'Elixir of Brine', modifiers: [], fromItemId: 'elixir-of-brine' };
  const GATED = { id: 'mode-gated-tide-k4', name: 'Tide Trance', modifiers: [], feats: ['some-dedication'] };
  const modesDb = () =>
    ({
      ...db(),
      modes: {
        [MINE.id]: MINE,
        [COMPANION.id]: COMPANION,
        [IDLE.id]: IDLE,
        [CATALOG_ID]: CATALOG_MODES[0],
        [ITEM_MODE.id]: ITEM_MODE,
        [GATED.id]: GATED,
      },
    }) as unknown as ContentDatabase;
  const sheetOn = (...active: string[]) =>
    ({
      id: 'c-modes',
      character: { name: 'Brin Salt' },
      build: {},
      play: { activeModes: active, companionModes: { 'comp-1': [COMPANION.id] } },
    }) as unknown as SavedChar;

  it('carries the modes the sheet has switched on (its own and a companion’s) — and only those the player wrote', () => {
    // mutation-proof: make collectCarried loop `HOMEBREW_TYPES` again (not CARRIED_TYPES, src/data/carried.ts) and
    // this goes red: no `modes` bucket at all.
    const c = collectCarried(sheetOn(MINE.id, CATALOG_ID, ITEM_MODE.id, GATED.id), modesDb())!; // the real isPrintedId
    expect(Object.keys(c.modes ?? {}).sort()).toEqual([COMPANION.id, MINE.id].sort());
    expect(c.modes![MINE.id], 'the mode itself, as the sender has it').toBe(MINE);
  });

  it('never a catalog, item or gated mode; never one that is not on', () => {
    // mutation-proof: make isAuthored treat every mode as authored (drop the playerModeLibrary test,
    // src/data/carried.ts) and this goes red: the item mode and the gated mode ride along.
    const c = collectCarried(sheetOn(CATALOG_ID, ITEM_MODE.id, GATED.id), modesDb(), { isPrinted: () => false });
    expect(Object.keys(c?.modes ?? {}), 'only the companion’s mode, which the player wrote').toEqual([COMPANION.id]);
    expect(c?.modes?.[IDLE.id], 'a mode that is not on changes nothing anybody sees').toBeUndefined();
  });

  it('isPrintedId knows the printed modes: the catalog’s (and, once core.json is in, its item modes)', () => {
    // mutation-proof: drop the `type === 'modes'` branch of isPrintedId (src/data/index.ts) and this goes red.
    expect(isPrintedId('modes', CATALOG_ID)).toBe(true);
    expect(isPrintedId('modes', MINE.id)).toBe(false);
  });
});
