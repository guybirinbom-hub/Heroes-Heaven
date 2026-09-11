// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { content, mainCasting } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { buildCharacter, emptyBuild, flexibleCollectionSize, type BuildState } from '../src/rules/build';
import type { Character } from '../src/rules/types';

/**
 * FLEXIBLE SPELLCASTER — the spell collection is ONE FLAT POOL (desk #102).
 *
 * Print (AoN archetype-99): *"The number of spells in your spell collection each day equals the total
 * number of spell slots you get each day from your class spells"* — Table 5-1 prints one Collection
 * number per level (4 at 3rd) — and *"The only restriction is that you must select at least one
 * 1st-level spell for your collection each time you prepare, ensuring that you can use all your spell
 * slots each day."*
 *
 * The app built the collection PER RANK — as many collected spells at each rank as slots at that rank,
 * Wanderer's Guide's shape — which is a different pool: it refused a 3rd 2nd-rank spell a 3rd-level
 * flexible cleric may collect, and it never asked for the 1st-rank spell print requires. Both halves
 * are pinned here, on the ENGINE (what the sheet keeps) and on the BUILDER (what the player is
 * offered), because a pool the picker and the sheet size differently loses the player's picks silently.
 *
 * Desk #155 — a flexible wizard, witch or magus takes the spellbook branch above the collection and
 * gets no collection at all — is OPEN and deliberately untouched: nothing here asserts on those three.
 */
const db = content();
const noop = () => undefined;

const RANK1 = ['heal', 'bless'];
const RANK2 = ['restoration', 'spiritual-armament', 'death-knell', 'enhance-victuals'];

/**
 * A flexible CLERIC: a prepared caster with no spellbook, so it reaches the collection branch.
 *
 * CLOISTERED, deliberately — Battle Creed is the cleric doctrine that swaps the full slot table for
 * the reduced two-rank one (src/rules/build.ts:4359, `subOption.slotProgression`), which is a
 * different Collection number at every level and would quietly stop pinning Table 5-1's.
 */
const flexCleric = (level: number, spells: Record<number, string[]>): BuildState =>
  ({
    ...emptyBuild(),
    name: 'flex',
    level,
    classId: 'cleric',
    subclassId: 'cloistered-cleric',
    ancestryId: Object.keys(db.ancestries)[0],
    backgroundId: Object.keys(db.backgrounds)[0],
    keyAbility: 'wis',
    featPicks: { '2:class:0': 'flexible-spellcaster-dedication' },
    spells,
  }) as unknown as BuildState;

const built = (level: number, spells: Record<number, string[]>): Character => buildCharacter(flexCleric(level, spells), db);
const collected = (ch: Character) => Object.values(mainCasting(ch)?.repertoire ?? {}).flat();

describe('the collection is one flat pool sized by the total daily class slots', () => {
  // batch 037: flexible-spellcaster#collection-shape
  it('a 3rd-level flexible cleric collects one 1st-rank and three 2nd-rank spells — four, print’s Collection number', () => {
    /* Table 5-1 at 3rd: 2 slots of 1st and 2 of 2nd, Collection 4. The per-rank shape capped the 2nd
     * rank at its own two slots and dropped the third outright. */
    const ch = built(3, { 1: [RANK1[0]], 2: RANK2.slice(0, 3) });
    const main = mainCasting(ch)!;
    expect(main.slots?.[1]).toEqual({ max: 2, used: 0 });
    expect(main.slots?.[2], 'the SLOTS stay per rank — only the collection is flat').toEqual({ max: 2, used: 0 });
    expect(flexibleCollectionSize({ 1: 2, 2: 2 }), 'the sheet and the builder size the pool here').toBe(4);
    expect(main.repertoire?.[1]).toEqual([RANK1[0]]);
    expect(main.repertoire?.[2]).toEqual(RANK2.slice(0, 3));
    expect(collected(ch).length).toBe(4);
  });

  // batch 037: flexible-spellcaster#collection-shape
  // mutation-proof
  it('sizes the pool to Table 5-1’s Collection column at all 20 levels — the capstone 10th slot excluded', () => {
    /* The whole printed column, because the rule is an arithmetic one and one worked level cannot tell
     * a right sum from a wrong one. The tail is the case that matters: Collection is 18 at 17th AND at
     * 19th — nine ranks × 2 — even though the slot table gains the capstone 10th-rank slot in between,
     * because *"Your class most likely has a class feature that gives you a single 10th level spell
     * slot that works a bit differently from other slots. If so, flexible spellcaster doesn't change
     * the way that spell works"* (archetype-99). Summing every rank read 19 there. */
    const printed: Record<number, number> = {
      1: 2, 2: 2, 3: 4, 4: 4, 5: 6, 6: 6, 7: 8, 8: 8, 9: 10, 10: 10,
      11: 12, 12: 12, 13: 14, 14: 14, 15: 16, 16: 16, 17: 18, 18: 18, 19: 18, 20: 18,
    };
    const sized = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => i + 1).map((L) => {
        const slots = mainCasting(built(L, {}))!.slots ?? {};
        return [L, flexibleCollectionSize(Object.fromEntries(Object.entries(slots).map(([r, s]) => [Number(r), s.max])))];
      }),
    );
    expect(sized).toEqual(printed);
    /* …and the capstone slot is still THERE — print leaves it working as normal, it just does not
     * enlarge the collection. */
    expect(mainCasting(built(19, {}))!.slots?.[10], 'the 10th-rank slot still exists, it just is not collected against').toEqual({ max: 1, used: 0 });
  });

  // batch 037: flexible-spellcaster#collection-shape
  it('the pool is a CAP: a fifth pick is not collected', () => {
    const ch = built(3, { 1: RANK1, 2: RANK2.slice(0, 3) });
    expect(collected(ch).length).toBe(4);
  });

  // batch 037: flexible-spellcaster#collection-shape
  it('the sheet CASTS from the collection — a spontaneous entry over the capped slots, every spell heightening', () => {
    /* *"You can cast any of the spells in your collection by using a spell slot of an appropriate
     * level"*, and from 2nd rank *"you can heighten any spell in your spell collection … similar to a
     * spontaneous spellcaster's signature spells"* — so the casting path is the repertoire one, with
     * the stars pinned on rather than offered as a budget. */
    const ch = built(3, { 1: [RANK1[0]], 2: RANK2.slice(0, 3) });
    const main = mainCasting(ch)!;
    expect(main.type).toBe('spontaneous');
    expect(main.prepared, 'nothing is nailed into a slot any more').toBeUndefined();
    expect(new Set(main.signature)).toEqual(new Set([RANK1[0], ...RANK2.slice(0, 3)]));
    expect(main.signatureFixed).toEqual(main.signature);
  });
});

describe('the collection’s one printed restriction: at least one 1st-rank spell', () => {
  // batch 037: flexible-spellcaster#collection-shape
  // mutation-proof
  it('with no 1st-rank spell collected, the last place is HELD rather than filled from a higher rank', () => {
    /* *"you must select at least one 1st-level spell for your collection each time you prepare,
     * ensuring that you can use all your spell slots each day"* — a collection of four 2nd-rank spells
     * leaves both 1st-rank slots uncastable, so it is not a collection print allows. */
    const ch = built(3, { 2: RANK2 });
    expect(mainCasting(ch)?.repertoire?.[1] ?? [], 'no 1st-rank spell was picked').toEqual([]);
    expect(collected(ch).length, 'three of four places filled; the fourth waits for a 1st-rank spell').toBe(3);
  });

  // batch 037: flexible-spellcaster#collection-shape
  // mutation-proof
  it('…and picking one releases it: the same four 2nd-rank picks plus a 1st-rank spell fill the pool', () => {
    const ch = built(3, { 1: [RANK1[0]], 2: RANK2 });
    expect(collected(ch).length).toBe(4);
    expect(mainCasting(ch)?.repertoire?.[1]).toEqual([RANK1[0]]);
  });
});

describe('the BUILDER offers exactly the pool the sheet keeps', () => {
  /** Open the builder on a level page the way a player does — the level chip. */
  const openAt = (b: BuildState, level: number) => {
    const r = renderDom(<Builder content={db} initial={b} onCancel={noop} onCreate={noop} />);
    r.click([...r.host.querySelectorAll<HTMLButtonElement>('button.lchip')].find((x) => (x.textContent ?? '').trim() === String(level)) ?? null);
    return r;
  };
  const addButton = (host: HTMLElement, label: string) => host.querySelector<HTMLButtonElement>(`button.spr-add[data-ctl-title="${label}"]`);

  // batch 037: flexible-spellcaster#collection-shape
  it('draws ONE pool with its count — “Spell collection — 2 / 4 collected” — not a cap per rank', () => {
    const r = openAt(flexCleric(3, { 1: [RANK1[0]], 2: [RANK2[0]] }), 3);
    const text = (r.host.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('Spell collection');
    expect(text, 'the pool count the player spends against').toContain('2 / 4 collected');
    expect(text, 'and the rule it is spent under').toContain('at least one 1st-rank spell');
    r.stop();
  });

  // batch 037: flexible-spellcaster#collection-shape
  // mutation-proof
  it('holds the last place for the 1st-rank spell, and says so where the press lands', () => {
    const r = openAt(flexCleric(3, { 2: RANK2.slice(0, 3) }), 3);
    const rank2 = addButton(r.host, 'Rank 2 spell');
    const rank1 = addButton(r.host, 'Rank 1 spell');
    expect(rank2?.disabled, 'three collected of four, and the fourth is not a 2nd-rank spell’s to take').toBe(true);
    expect(rank2?.title ?? '').toContain('at least one 1st-rank spell');
    expect(rank1?.disabled, 'the 1st-rank picker is the one still open — that is the whole point').toBe(false);
    r.stop();
  });

  /* The rail's "+ add" is only half the control: the player spends the last places INSIDE the picker,
   * which stays open while they do. A picker opened one short of the held place reaches the floor on
   * the next pick, and its rows must say the same thing the button says — the old per-rank line ("all
   * N spells at this rank are chosen") would be a lie, since the rank is not what is full. */
  // batch 037: flexible-spellcaster#collection-shape
  // mutation-proof
  it('says the same thing inside the PICKER, where the last place is actually spent', () => {
    const r = openAt(flexCleric(3, { 2: RANK2.slice(0, 2) }), 3);
    r.click(addButton(r.host, 'Rank 2 spell')); // live: 2 collected, 3 spendable, the 4th held
    const rows = () => [...r.host.querySelectorAll<HTMLElement>('.picker-item, .pick-row')];
    const act = (row: HTMLElement) => (row.classList.contains('pick-row') ? row.querySelector<HTMLButtonElement>('.pick-add') : (row as HTMLButtonElement));
    const live = rows().filter((row) => !act(row)?.disabled);
    expect(live.length, 'the picker opened with places still to spend').toBeGreaterThan(1);
    r.click(act(live[0])); // …and spending one lands on the floor
    const held = rows().find((row) => act(row)?.disabled);
    expect(held, 'every remaining row is now refused').toBeTruthy();
    expect(held!.querySelector('.picker-why')?.textContent ?? '').toContain('at least one 1st-rank spell');
    r.stop();
  });

  // batch 037: flexible-spellcaster#collection-shape
  it('…and with a 1st-rank spell collected, every rank spends the pool to its last place', () => {
    const r = openAt(flexCleric(3, { 1: [RANK1[0]], 2: RANK2.slice(0, 2) }), 3);
    expect(addButton(r.host, 'Rank 2 spell')?.disabled, 'three of four collected, nothing held').toBe(false);
    r.stop();
    const full = openAt(flexCleric(3, { 1: [RANK1[0]], 2: RANK2.slice(0, 3) }), 3);
    expect(addButton(full.host, 'Rank 2 spell')?.disabled, 'four of four — the pool is spent').toBe(true);
    expect(addButton(full.host, 'Rank 2 spell')?.title ?? '').toContain('all 4 spells');
    full.stop();
  });
});

/**
 * THE CAPSTONE SLOT IS OUTSIDE THE COLLECTION.
 *
 * Print (archetype-99): *"Your class most likely has a class feature that gives you a single 10th level
 * spell slot that works a bit differently from other slots. If so, flexible spellcaster doesn't change
 * the way that spell works."* Table 5-1 prints the arithmetic: Collection is 18 at 17th AND at 19th,
 * even though the slot table gains the 10th-rank slot in between.
 *
 * `flexibleCollectionSize` stopped counting at rank 9 (pinned above), but the loop that FILLS the
 * collection still walked rank 10 — so the capstone pick competed for the 18 places and was sliced away
 * the moment the lower ranks filled them. A 19th-level flexible cleric lost its 10th-rank spell.
 */
const LOWER_18: Record<number, string[]> = {
  1: ['heal', 'bless'],
  2: ['restoration', 'spiritual-armament'],
  3: ['circle-of-protection', 'agonizing-despair'],
  4: ['air-walk', 'anathematic-reprisal'],
  5: ['abyssal-plague', 'death-ward'],
  6: ['bacchanalia', 'stone-to-flesh'],
  7: ['divine-vessel', 'ethereal-jaunt'],
  8: ['antimagic-field', 'divine-aura'],
  9: ['crusade', 'astral-labyrinth'],
};
/** The lower-rank half of what the sheet keeps — the collection, which is ranks 1-9 and nothing else. */
const lowerCollected = (ch: Character) =>
  Object.entries(mainCasting(ch)?.repertoire ?? {}).filter(([r]) => Number(r) <= 9).flatMap(([, ids]) => ids);

describe('the class’s single 10th-rank slot is outside the collection', () => {
  // batch 037: flexible-spellcaster#capstone-outside-collection
  it('a 19th-level flexible cleric keeps its 10th-rank spell with all 18 collection places already spent', () => {
    /* The exact case the flat pool broke: 18 lower-rank spells fill the collection, and the capstone
     * pick — walked last, because the loop runs the ranks in order — was charged against a pool with
     * nothing left and silently dropped by `slice(0, 0)`. */
    const ch = built(19, { ...LOWER_18, 10: ['avatar'] });
    const main = mainCasting(ch)!;
    expect(main.slots?.[10], 'the capstone slot is there').toEqual({ max: 1, used: 0 });
    expect(main.repertoire?.[10], 'and the spell picked for it survives the collection’s cap').toEqual(['avatar']);
    expect(lowerCollected(ch).length, 'the collection still holds its printed 18').toBe(18);
    expect(flexibleCollectionSize({ 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 2, 10: 1 })).toBe(18);
  });

  // batch 037: flexible-spellcaster#capstone-outside-collection
  it('the capstone pick spends none of the collection’s places — not even the one the printed floor holds', () => {
    /* *"The number of spells in your spell collection each day equals the total number of spell slots
     * you get each day from your class spells"* — the 10th-rank slot is not one of them, so collecting
     * a spell for it must leave the pool exactly where it was, and the pool exactly where it was must
     * leave the capstone alone.
     *
     * The second half is the one a mutation can reach, and it is the harshest arrangement of it: no
     * 1st-rank spell, so print's floor HOLDS the 18th place, and 18 lower-rank picks then take every
     * place there is to take. A capstone charged against the collection has nothing left to be charged
     * against and is dropped; one outside it is untouched. */
    const alone = built(19, { 10: ['avatar'] });
    expect(mainCasting(alone)?.repertoire?.[10], 'the lone capstone pick is kept').toEqual(['avatar']);
    expect(lowerCollected(alone), 'and it took no collection place with it').toEqual([]);
    const exhausted = built(19, { ...LOWER_18, 1: [], 2: [...LOWER_18[2], 'death-knell', 'enhance-victuals'], 10: ['avatar'] });
    expect(lowerCollected(exhausted).length, 'the floor holds the 18th place, so 17 of the 18 picks land').toBe(17);
    expect(mainCasting(exhausted)?.repertoire?.[10], 'and the capstone is still there — it was never charged').toEqual(['avatar']);
  });
});

describe('the BUILDER draws the capstone slot outside the pool rail', () => {
  /** Open the builder on a level page the way a player does — the level chip. */
  const openAt = (b: BuildState, level: number) => {
    const r = renderDom(<Builder content={db} initial={b} onCancel={noop} onCreate={noop} />);
    r.click([...r.host.querySelectorAll<HTMLButtonElement>('button.lchip')].find((x) => (x.textContent ?? '').trim() === String(level)) ?? null);
    return r;
  };
  const addButton = (host: HTMLElement, label: string) => host.querySelector<HTMLButtonElement>(`button.spr-add[data-ctl-title="${label}"]`);

  // batch 037: flexible-spellcaster#capstone-outside-collection
  it('at 19th the pool rail still says 18 and the 10th-rank row is its own control, capped at one', () => {
    /* The collection is full — every one of its 18 places spent — and the 10th-rank slot the character
     * gains at 19th is still open, because it is not one of them. Drawn inside the rail, its row read
     * the pool's cap and came up disabled: the player was given a slot with no way to fill it. */
    const r = openAt(flexCleric(19, LOWER_18), 19);
    const text = (r.host.textContent ?? '').replace(/\s+/g, ' ');
    expect(text, 'the pool, and its printed size at 19th').toContain('Spell collection — 18 / 18 collected');
    expect(text, 'the 10th-rank slot, named as sitting outside it').toContain('10th rank — outside your spell collection');
    expect(text, 'and the rule said in words where the pick is made').toContain('flexible spellcaster doesn’t change it');
    expect(text, 'its own cap — one slot, one spell').toContain('0 / 1 chosen');
    const rank10 = addButton(r.host, 'Rank 10 spell');
    expect(rank10, 'the row is drawn at all').toBeTruthy();
    expect(rank10?.disabled, 'a full collection does not close the capstone slot').toBe(false);
    r.stop();
  });

  /* The rail's "+ add" is only half the control here too: it opens the picker at 0 / 1 and the picker
   * STAYS OPEN while the pick is made, so the refusal a player actually reaches is the picker's row
   * message, not the button's title. The generic per-rank line — "All 1 spells at this rank are chosen"
   * — is both ungrammatical and the wrong rule: what is full is the class's single 10th-rank slot, and
   * the collection beside it is untouched either way. */
  // batch 037: flexible-spellcaster#capstone-outside-collection
  // mutation-proof
  it('says which slot is full inside the PICKER, where the capstone is actually spent', () => {
    const r = openAt(flexCleric(19, LOWER_18), 19);
    r.click(addButton(r.host, 'Rank 10 spell'));
    const rows = () => [...r.host.querySelectorAll<HTMLElement>('.picker-item, .pick-row')];
    const act = (row: HTMLElement) => (row.classList.contains('pick-row') ? row.querySelector<HTMLButtonElement>('.pick-add') : (row as HTMLButtonElement));
    const live = rows().filter((row) => !act(row)?.disabled);
    expect(live.length, 'the picker opened with the one slot still empty').toBeGreaterThan(1);
    r.click(act(live[0])); // …and one pick fills it
    const held = rows().find((row) => act(row)?.disabled);
    expect(held, 'every other 10th-rank spell is now refused').toBeTruthy();
    expect(held!.querySelector('.picker-why')?.textContent ?? '').toContain('single 10th-rank slot');
    r.stop();
  });

  // batch 037: flexible-spellcaster#capstone-outside-collection
  it('…and spending the capstone slot leaves the pool’s count alone, then closes only itself', () => {
    const r = openAt(flexCleric(19, { ...LOWER_18, 10: ['avatar'] }), 19);
    const text = (r.host.textContent ?? '').replace(/\s+/g, ' ');
    expect(text, 'the 19th collected spell print never gives is not counted here either').toContain('Spell collection — 18 / 18 collected');
    expect(text).toContain('1 / 1 chosen');
    expect(addButton(r.host, 'Rank 10 spell')?.disabled, 'one slot, and it is taken').toBe(true);
    r.stop();
  });
});
