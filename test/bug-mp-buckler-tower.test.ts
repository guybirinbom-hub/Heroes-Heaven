import { describe, it, expect } from 'vitest';
import { deriveShield } from '../src/rules/derive';
import { imbueSlots, mpShieldRefine, refinementCost, shieldFamily, shieldRefinement } from '../src/rules/monsterParts';
import type { MpItemKind } from '../src/rules/monsterParts';
import { content, build } from './_content';
import type { Character, InventoryItem } from '../src/rules/types';

/*
 * bug 2026-09-15: monster-parts shield families
 *
 * The app's own Monster Parts page ("Refining"): "A refined shield uses steel-shield statistics by
 * default (bucklers subtract 2 Hardness / 12 HP / 6 BT; tower shields can't be refined this way)."
 * Table 4C's comment said the buckler adjustment was "handled by the caller" — no caller did it, so a
 * refined buckler read full steel numbers and a tower shield could be refined at all.
 *
 * The data has no field for the family: bucklers ship with empty traits and share acBonus 1 with klars,
 * targes, the sapling shields and Duelist's Beacon. Every buckler and both tower shields say so in their
 * NAME, so the family is read off the name (`shieldFamily`), which also covers a homebrew buckler.
 *
 * Mutation proof (each run once, then restored): dropping the tower branch of mpShieldRefine fails
 * "a tower shield cannot be refined" (expected [ 5, 20, 10 ] to deeply equal [ 7, 42, 21 ]); dropping
 * the buckler subtraction fails "a refined buckler sits 2 / 12 / 6 under the steel numbers" (expected
 * [ 7, 42, 21 ] to deeply equal [ 5, 30, 15 ]).
 */

const db = content();
const refinedTo = (level: number) => ({ kind: 'shield' as MpItemKind, refineValue: refinementCost(level, 'shield'), imbuements: [] });
const fighter: Character = { ...build('fighter', 7), variantRules: { ...(build('fighter', 7).variantRules ?? {}), monsterParts: true } };
const holding = (itemId: string, extra: Partial<InventoryItem> = {}): Character => ({
  ...fighter,
  inventory: [{ instanceId: 's1', itemId, quantity: 1, equipped: true, ...extra } as InventoryItem],
});
const statsOf = (c: Character): [number, number, number] => {
  const s = deriveShield(c, db)!;
  return [s.hardness, s.hp, s.brokenThreshold];
};

describe('shield families are read off the name', () => {
  // bug 2026-09-15: monster-parts shield families
  it('names the family of every shield shape the data ships', () => {
    for (const n of ['Buckler', 'Adamantine Buckler (High-Grade)', 'Gauntlet Buckler', 'War Mage\'s Buckler']) expect(shieldFamily({ name: n })).toBe('buckler');
    for (const n of ['Tower Shield', 'Duskwood Tower Shield (Standard-Grade)']) expect(shieldFamily({ name: n })).toBe('tower');
    for (const n of ['Steel Shield', "Duelist's Beacon", 'Sanguine Klar', 'Sapling Shield (Minor)', 'Sturdy Shield (Minor)', 'Bucklers Bane', 'Towering Shield'])
      expect(shieldFamily({ name: n }), n).toBe('shield');
    expect(shieldFamily(undefined)).toBe('shield');
  });

  // bug 2026-09-15: monster-parts shield families
  it('matches exactly the 24 bucklers and 2 tower shields in core.json, and no other shield', () => {
    const shields = Object.values(db.items).filter((i) => i.itemType === 'shield');
    const bucklers = shields.filter((i) => shieldFamily(i) === 'buckler');
    const towers = shields.filter((i) => shieldFamily(i) === 'tower');
    expect(bucklers.length).toBe(24);
    expect(towers.length).toBe(2);
    for (const s of shields) {
      const named = /buckler/i.test(s.name) ? 'buckler' : /tower shield/i.test(s.name) ? 'tower' : 'shield';
      expect(shieldFamily(s), s.id).toBe(named);
    }
  });
});

describe('Table 4C applies per family', () => {
  // bug 2026-09-15: monster-parts shield families
  it('a refined buckler sits 2 / 12 / 6 under the steel numbers', () => {
    const steel = shieldRefinement(7);
    expect([steel.hardness, steel.hp, steel.bt]).toEqual([7, 42, 21]);
    const b = mpShieldRefine(refinedTo(7), 7, { name: 'Buckler' });
    expect([b.hardness, b.hp, b.bt]).toEqual([5, 30, 15]);
    expect(b.imbueSlots).toBe(1);
    const low = mpShieldRefine(refinedTo(3), 3, { name: 'Buckler' });
    expect([low.hardness, low.hp, low.bt]).toEqual([3, 18, 9]);
    expect(statsOf(holding('buckler', { monsterPart: refinedTo(7) }))).toEqual([5, 30, 15]);
  });

  // bug 2026-09-15: monster-parts shield families
  it('a steel shield keeps the printed steel baseline', () => {
    const s = mpShieldRefine(refinedTo(7), 7, { name: 'Steel Shield' });
    expect([s.hardness, s.hp, s.bt]).toEqual([7, 42, 21]);
    expect(statsOf(holding('steel-shield', { monsterPart: refinedTo(7) }))).toEqual([7, 42, 21]);
  });

  // bug 2026-09-15: monster-parts shield families
  it('a tower shield cannot be refined: it gains nothing and has no imbuing slot', () => {
    const t = mpShieldRefine(refinedTo(7), 7, { name: 'Tower Shield' });
    expect([t.hardness, t.hp, t.bt, t.imbueSlots]).toEqual([0, 0, 0, 0]);
    // The printed statistics stand, refinement or not.
    expect(statsOf(holding('tower-shield'))).toEqual([5, 20, 10]);
    expect(statsOf(holding('tower-shield', { monsterPart: refinedTo(7) }))).toEqual([5, 20, 10]);
  });

  // bug 2026-09-15: monster-parts shield families
  it('the editor offers no imbuing slot on a tower shield, and the usual one on other shields', () => {
    expect(imbueSlots('shield', 7, { name: 'Tower Shield' })).toBe(0);
    expect(imbueSlots('shield', 20, { name: 'Duskwood Tower Shield (Standard-Grade)' })).toBe(0);
    expect(imbueSlots('shield', 7, { name: 'Buckler' })).toBe(1);
    expect(imbueSlots('shield', 7, { name: 'Steel Shield' })).toBe(1);
    expect(imbueSlots('shield', 3, { name: 'Steel Shield' })).toBe(0); // imbuing unlocks at level 4
  });

  // bug 2026-09-15: monster-parts shield families
  it('a tower shield switched to Monster Parts still counts its reinforcing rune', () => {
    // Refinement is denied, so the switch is inert: the minor rune's additive-with-cap numbers apply
    // exactly as they do with the variant rule off (steel-shape 5/20/10 + minor = 8/64/32).
    expect(statsOf(holding('tower-shield', { runes: { reinforcing: 1 } }))).toEqual([8, 64, 32]);
    expect(statsOf(holding('tower-shield', { runes: { reinforcing: 1 }, monsterPart: refinedTo(7) }))).toEqual([8, 64, 32]);
  });
});
