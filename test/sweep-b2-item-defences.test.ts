import { describe, it, expect } from 'vitest';
import { deriveDefenses } from '../src/rules/derive';
import type { Character } from '../src/rules/types';
import { content, build } from './_content';

/**
 * Coverage sweep batch 2 wrote item defences (resistances / senses / immunities) into
 * `item.passiveEffects`, NOT onto the item record's top level.
 *
 * That distinction is the whole point and it is invisible to a reader. derive.ts consumes
 * `db.items[inv.itemId]?.passiveEffects` only — there is no read of a top-level `item.resistances`
 * anywhere in src. But 49 item records already carried a top-level one, so the apply script's
 * "does the engine read this field for this collection?" guard was perfectly happy to write a 50th.
 * It would have parsed, shipped, passed every other test, and done nothing.
 *
 * These tests fail if that routing is ever reverted — by a data regen, a re-run of the applier, or
 * an importer change that "tidies" passiveEffects back to the top level.
 */
describe('coverage sweep b2 — item defences reach the sheet', () => {
  const wearing = (itemId: string): Character => {
    const c = build('fighter', 5);
    return { ...c, inventory: [{ instanceId: 'i1', itemId, quantity: 1, invested: true, worn: true }] };
  };

  it('Flaming Star grants its fire resistance while invested', () => {
    const db = content();
    const res = deriveDefenses(wearing('flaming-star'), db).resistances;
    expect(res.some((r) => String(r.type).toLowerCase() === 'fire')).toBe(true);
  });

  it('the greater version grants the larger value', () => {
    const db = content();
    const lesser = deriveDefenses(wearing('flaming-star'), db).resistances.find((r) => String(r.type).toLowerCase() === 'fire');
    const greater = deriveDefenses(wearing('flaming-star-greater'), db).resistances.find((r) => String(r.type).toLowerCase() === 'fire');
    expect(Number(greater?.value)).toBeGreaterThan(Number(lesser?.value));
  });

  it('grants nothing when the item is not carried', () => {
    const db = content();
    const bare = deriveDefenses(build('fighter', 5), db).resistances;
    expect(bare.some((r) => String(r.type).toLowerCase() === 'fire')).toBe(false);
  });

  it('every defence the sweep wrote onto an item lives under passiveEffects, where the engine looks', () => {
    const db = content();
    const TOUCHED = [
      'flaming-star', 'flaming-star-greater',
      'five-feather-wreath', 'five-feather-wreath-greater',
      'foxglove-token',
    ];
    const misplaced = TOUCHED.filter((id) => {
      const it = db.items[id];
      if (!it) return false; // an id that left the data is a different problem
      const pe = it.passiveEffects ?? {};
      return !(pe.resistances?.length || pe.senses?.length || pe.immunities?.length);
    });
    expect(misplaced).toEqual([]);
  });
});
