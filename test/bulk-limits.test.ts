import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveBulk } from '../src/rules/derive';
import type { Character, InventoryItem } from '../src/rules/types';

/**
 * "Increase your maximum and encumbered Bulk limits by 4."
 *
 * deriveBulk computed both thresholds from Strength alone, so Beast of Burden moved no number on the
 * sheet. Armor Regiment Training ("you treat heavy armor as being 1 Bulk lighter") had the same
 * problem from the other side — the carried total ignored it.
 */
const db = content();
const heavy = () => Object.entries(db.items).find(([, it]) => it.itemType === 'armor' && it.category === 'heavy' && it.bulk >= 2)!;
const worn = (itemId: string): InventoryItem => ({ instanceId: 'a1', itemId, quantity: 1, worn: true });

describe('feat-driven Bulk limits', () => {
  it('Beast of Burden raises both thresholds by 4', () => {
    const plain = build('fighter', 5, {});
    const withIt = build('fighter', 5, { featPicks: { '4:general': 'beast-of-burden' } });
    const a = deriveBulk(plain, db);
    const b = deriveBulk(withIt, db);
    expect(b.encumberedAt).toBe(a.encumberedAt + 4);
    expect(b.max).toBe(a.max + 4);
  });

  /** Bulk contributed by an inventory ON TOP of the character's own baseline (starting coin is
   *  itself Bulk, so an absolute comparison would be measuring their purse). */
  const carried = (ch: Character, inventory: InventoryItem[]) =>
    deriveBulk({ ...ch, inventory }, db).total - deriveBulk({ ...ch, inventory: [] }, db).total;

  it('Armor Regiment Training makes WORN heavy armor count 1 Bulk lighter', () => {
    const [armorId, armor] = heavy();
    const base = build('fighter', 5, {});
    const withIt = build('fighter', 5, { featPicks: { '4:class': 'armor-regiment-training' } });
    expect(carried(base, [worn(armorId)])).toBeCloseTo(armor.bulk, 5);
    expect(carried(withIt, [worn(armorId)])).toBeCloseTo(armor.bulk - 1, 5);
  });

  it('it only applies while the armor is WORN, and only to armor', () => {
    const [armorId] = heavy();
    const ch = build('fighter', 5, { featPicks: { '4:class': 'armor-regiment-training' } });
    expect(carried(ch, [{ ...worn(armorId), worn: false }])).toBeCloseTo(db.items[armorId].bulk, 5);

    // A heavy non-armor item is untouched.
    const [gearId, gear] = Object.entries(db.items).find(([, it]) => it.itemType !== 'armor' && it.bulk >= 2)!;
    expect(carried(ch, [{ instanceId: 'g1', itemId: gearId, quantity: 1, worn: true }])).toBeCloseTo(gear.bulk, 5);
  });

  it('the relief never drives an item below 0 Bulk', () => {
    const light = Object.entries(db.items).find(([, it]) => it.itemType === 'armor' && it.category === 'heavy' && it.bulk === 0);
    if (!light) return; // no 0-Bulk heavy armor ships; nothing to prove
    const ch = build('fighter', 5, { featPicks: { '4:class': 'armor-regiment-training' } });
    expect(carried(ch, [worn(light[0])])).toBe(0);
  });

  it('Efficient Preparation raises the commander prepared-tactics cap', () => {
    const plain = build('commander', 8, {});
    const withIt = build('commander', 8, { featPicks: { '8:class': 'efficient-preparation' } });
    // An L8 commander's base cap is FOUR — Expert Tactician (7th) prints "The total number of
    // tactics you can have prepared increases to four" (commanderPreparedMax, batch-18 parity fix).
    expect(plain.commanderTactics?.preparedMax).toBe(4);
    expect(withIt.commanderTactics?.preparedMax).toBe(5);
  });

  it('the data carries both fields', () => {
    expect(db.feats['beast-of-burden'].bulkLimitBonus).toBe(4);
    expect(db.feats['armor-regiment-training'].armorBulkReduction).toEqual({ by: 1, categories: ['heavy'] });
    // Battlecry! printed it twice under two names; both must work.
    expect(db.feats['armored-regiment-training'].armorBulkReduction).toEqual({ by: 1, categories: ['heavy'] });
  });
});
