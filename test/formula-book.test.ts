import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import {
  FORMULA_BOOK_CAPACITY,
  FORMULA_BOOK_ITEM_ID,
  craftableFormulas,
  formulaOptions,
  formulaSlotKey,
  formulaSlots,
  isFormulaBook,
  knownFormulas,
} from '../src/rules/formulaBook';
import { addFormula, initialPlay, pickFormula, playForRebuild, reconcileFormulaBook, removeFormula, removeInventoryItem, applyPlayState, type PlayState } from '../src/rules/play';
import { abilityMod } from '../src/rules/derive';
import type { Character } from '../src/rules/types';

/**
 * The formula book (owner spec Q14).
 *
 * The two things worth guarding are the ones that make it unlike every other grant here: a formula is
 * a REFERENCE, so nothing may appear in the inventory; and a grant is a ONE-TIME WRITE, so destroying
 * the book must destroy the formulas for good.
 */
describe('formula book', () => {
  const db = () => content();
  const bookOf = (inv: { itemId: string }[] | undefined) => (inv ?? []).find((i) => isFormulaBook(db().items[i.itemId]));

  it('an alchemist is handed a formula book, and it says which record gave it', () => {
    const ch = build('alchemist', 1);
    const book = ch.inventory.find((i) => i.itemId === FORMULA_BOOK_ITEM_ID);
    expect(book).toBeTruthy();
    // An alchemist owns several book-granting records (the class feature and the Alchemical Crafting
    // it gains for free); the label names one of them, and there is only ever ONE book.
    expect(book!.grantedBy).toBeTruthy();
    expect(ch.inventory.filter((i) => isFormulaBook(db().items[i.itemId]))).toHaveLength(1);
  });

  it('a character with no formula grant is handed nothing', () => {
    const ch = build('fighter', 1);
    expect(bookOf(ch.inventory)).toBeUndefined();
  });

  it("the alchemist's own book opens two slots at 1st and two more per level", () => {
    expect(formulaSlots(build('alchemist', 1), db()).filter((s) => s.sourceId === 'formula-book')).toHaveLength(2);
    expect(formulaSlots(build('alchemist', 5), db()).filter((s) => s.sourceId === 'formula-book')).toHaveLength(10);
  });

  it("Improbable Elixirs offers one potion per Intelligence modifier, of 9th level or lower", () => {
    const ch = build('alchemist', 18, { featPicks: { '18:class': 'improbable-elixirs' } });
    const slots = formulaSlots(ch, db()).filter((s) => s.sourceId === 'improbable-elixirs');
    expect(slots).toHaveLength(Math.max(1, abilityMod(ch.abilities.int)));
    const opts = formulaOptions(slots[0], ch, db());
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.every((it) => (it.traits ?? []).includes('potion') && (it.level ?? 0) <= 9)).toBe(true);
  });

  it('a slot offers only what its own record allows — Cauldron sees oils and potions, not bombs', () => {
    const ch = build('witch', 2, { featPicks: { '2:class': 'cauldron' } });
    const slot = formulaSlots(ch, db()).find((s) => s.sourceId === 'cauldron')!;
    const opts = formulaOptions(slot, ch, db());
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.every((it) => (it.traits ?? []).some((t) => t === 'oil' || t === 'potion'))).toBe(true);
    expect(opts.some((it) => (it.traits ?? []).includes('bomb'))).toBe(false);
  });

  it('a formula is a reference — writing one adds nothing to the inventory', () => {
    const ch = build('alchemist', 1);
    const play = initialPlay(ch, db());
    const book = bookOf(play.inventory)!;
    const before = play.inventory!.length;
    const after = addFormula(play, book.instanceId, 'elixir-of-life-minor');
    expect(after.inventory).toHaveLength(before);
    expect(after.inventory!.some((i) => i.itemId === 'elixir-of-life-minor')).toBe(false);
    expect(knownFormulas(after.inventory, db())).toEqual(['elixir-of-life-minor']);
  });

  it('add is idempotent, and remove takes the formula back out', () => {
    const ch = build('alchemist', 1);
    let play = initialPlay(ch, db());
    const id = bookOf(play.inventory)!.instanceId;
    play = addFormula(play, id, 'antidote-lesser');
    play = addFormula(play, id, 'antidote-lesser');
    expect(knownFormulas(play.inventory, db())).toEqual(['antidote-lesser']);
    play = removeFormula(play, id, 'antidote-lesser');
    expect(knownFormulas(play.inventory, db())).toEqual([]);
  });

  it('a book holds 100 formulas and not one more', () => {
    const ch = build('alchemist', 1);
    let play = initialPlay(ch, db());
    const id = bookOf(play.inventory)!.instanceId;
    const ids = Object.keys(db().items).slice(0, FORMULA_BOOK_CAPACITY + 5);
    for (const itemId of ids) play = addFormula(play, id, itemId);
    expect(bookOf(play.inventory)!.formulas).toHaveLength(FORMULA_BOOK_CAPACITY);
    // The 101st is a no-op rather than an eviction — the first hundred stay put.
    expect(bookOf(play.inventory)!.formulas).toEqual(ids.slice(0, FORMULA_BOOK_CAPACITY));
  });

  it("answering a slot spends it: the book gains the formula and the slot stops being offered", () => {
    const ch = build('alchemist', 1);
    let play = initialPlay(ch, db());
    const id = bookOf(play.inventory)!.instanceId;
    const slot = formulaSlots(ch, db())[0];
    play = pickFormula(play, id, slot.key, 'elixir-of-life-minor');
    expect(play.formulaPicks?.[slot.key]).toBe('elixir-of-life-minor');
    const overlaid = applyPlayState(ch, play, db());
    expect(formulaSlots(overlaid, db()).filter((s) => !(s.key in (overlaid.formulaPicks ?? {})))).toHaveLength(
      formulaSlots(ch, db()).length - 1,
    );
  });

  it('the builder pick reaches the book exactly once', () => {
    const key = formulaSlotKey('formula-book', 0, 0);
    const ch = build('alchemist', 1, { formulaPicks: { [key]: 'elixir-of-life-minor' } });
    expect(bookOf(ch.inventory)!.formulas).toEqual(['elixir-of-life-minor']);
    // Seeding and then reconciling must not write it a second time (it is already inside the book).
    const play = reconcileFormulaBook(initialPlay(ch, db()), ch, db());
    expect(bookOf(play.inventory)!.formulas).toEqual(['elixir-of-life-minor']);
  });

  it('a pick made in the builder AFTER play began is folded into the live book, once', () => {
    const key = formulaSlotKey('formula-book', 0, 0);
    const before = build('alchemist', 1);
    const played = playForRebuild(initialPlay(before, db()));
    const after = build('alchemist', 1, { formulaPicks: { [key]: 'antiplague-lesser' } });
    let play = reconcileFormulaBook(played, after, db());
    expect(bookOf(play.inventory)!.formulas).toEqual(['antiplague-lesser']);
    // Torn out again, it stays out: the slot is spent, so nothing re-writes it.
    play = removeFormula(play, bookOf(play.inventory)!.instanceId, 'antiplague-lesser');
    play = reconcileFormulaBook(play, after, db());
    expect(bookOf(play.inventory)!.formulas ?? []).toEqual([]);
  });

  it('⚠ losing the book loses the formulas — the feature does not give them back', () => {
    const key = formulaSlotKey('improbable-elixirs', 0, 0);
    const ch = build('alchemist', 18, { featPicks: { '18:class': 'improbable-elixirs' }, formulaPicks: { [key]: 'potion-of-shared-life' } });
    let play: PlayState = reconcileFormulaBook(initialPlay(ch, db()), ch, db());
    expect(knownFormulas(play.inventory, db())).toContain('potion-of-shared-life');

    play = removeInventoryItem(play, bookOf(play.inventory)!.instanceId);
    // A rebuild, then every later mutation, re-runs the reconciler — and it must find nothing to do.
    play = reconcileFormulaBook(playForRebuild(play), ch, db());
    expect(bookOf(play.inventory)).toBeUndefined();
    expect(knownFormulas(play.inventory, db())).toEqual([]);
    // The slot stays spent, so the empty book a player buys later opens with no slots to press.
    expect(play.formulaPicks?.[key]).toBe('potion-of-shared-life');
    const overlaid = applyPlayState(ch, play, db());
    expect(formulaSlots(overlaid, db()).some((s) => s.key === key && !(s.key in (overlaid.formulaPicks ?? {})))).toBe(false);
  });

  it('a book bought after the old one was lost opens empty', () => {
    const key = formulaSlotKey('formula-book', 0, 0);
    const ch = build('alchemist', 1, { formulaPicks: { [key]: 'elixir-of-life-minor' } });
    let play = reconcileFormulaBook(initialPlay(ch, db()), ch, db());
    play = removeInventoryItem(play, bookOf(play.inventory)!.instanceId);
    play = { ...play, inventory: [...(play.inventory ?? []), { instanceId: 'bought-1', itemId: FORMULA_BOOK_ITEM_ID, quantity: 1 }] };
    play = reconcileFormulaBook(play, ch, db());
    expect(bookOf(play.inventory)!.formulas ?? []).toEqual([]);
  });

  it('a granted formula joins the alchemy pool, and leaves it with the book (ruling Q19)', () => {
    const key = formulaSlotKey('improbable-elixirs', 0, 0);
    const ch = build('alchemist', 18, { featPicks: { '18:class': 'improbable-elixirs' }, formulaPicks: { [key]: 'potion-of-shared-life' } });
    let play = reconcileFormulaBook(initialPlay(ch, db()), ch, db());
    expect(craftableFormulas(applyPlayState(ch, play, db()), db())).toContain('potion-of-shared-life');

    play = removeInventoryItem(play, bookOf(play.inventory)!.instanceId);
    expect(craftableFormulas(applyPlayState(ch, play, db()), db())).toEqual([]);
  });

  it("Cauldron's oils are NOT alchemical consumables — its formulas stay out of the alchemy pool", () => {
    const slot = formulaSlotKey('cauldron', 0, 0);
    const ch = build('witch', 2, { featPicks: { '2:class': 'cauldron' }, formulaPicks: { [slot]: 'merciful-balm' } });
    const overlaid: Character = applyPlayState(ch, reconcileFormulaBook(initialPlay(ch, db()), ch, db()), db());
    expect(knownFormulas(overlaid.inventory, db())).toContain('merciful-balm');
    expect(craftableFormulas(overlaid, db())).toEqual([]);
  });
});
