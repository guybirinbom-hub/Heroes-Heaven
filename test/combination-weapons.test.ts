import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveStrikes } from '../src/rules/derive';
import type { Character, InventoryItem } from '../src/rules/types';

const db = content();

/**
 * Combination weapons — the Wanderer's Guide parity batches 2–8 flagged all 18 of them as granting
 * nothing, and the flag was right for a reason no comparer could see: our records DID name their
 * second usage in `combinationMeleeForm`, but nothing anywhere read that field. Every combination
 * weapon was therefore a one-Strike weapon on the sheet — you bought a gun sword and got the gun.
 *
 * The printed Combination trait (Treasure Vault Remastered p. 217) settles the shape:
 *
 *   *"A combination weapon has a ranged form or usage and a melee weapon form or usage. The
 *   combination weapons table lists the ranged weapon statistics first and the melee weapon
 *   statistics indented beneath … Since a combination weapon is one weapon with two usages, both
 *   usages share any fundamental runes."*
 *
 * Two things follow, and both are asserted below. Ranged-first is why the BASE record keeps the
 * ranged statistics (their side makes the melee form the base and hands the ranged one over as a
 * separate item — that is the deviation from the printed table, not ours). One-weapon-two-usages is
 * why the melee usage is derived from the SAME inventory row: a second inventory item could not
 * share the first one's runes, which the trait requires it to.
 */
const wield = (itemId: string, over: Partial<InventoryItem> = {}): InventoryItem => ({
  instanceId: 'w1',
  itemId,
  quantity: 1,
  equipped: true,
  ...over,
});

/** Wielded weapons only — everyone always has a Fist, and it is not what any of this is about. */
const strikesFor = (inv: InventoryItem[]) => {
  const ch = build('fighter', 5) as Character;
  return deriveStrikes({ ...ch, inventory: inv }, db).filter((s) => s.instanceId !== 'fist');
};

describe('combination weapons', () => {
  const bases = Object.values(db.items).filter((i) => i.combinationMeleeForm);

  it('every combination weapon names a melee form that exists', () => {
    expect(bases.length).toBeGreaterThanOrEqual(18);
    for (const b of bases) {
      expect(db.items[b.combinationMeleeForm!], `${b.id} → ${b.combinationMeleeForm}`).toBeTruthy();
      // Ranged-first: the base record carries the ranged usage, so it must have a range increment and
      // the melee form must not. A base with no range would mean the two forms had been swapped.
      expect(b.range, `${b.id} base should hold the RANGED usage`).toBeTruthy();
      expect(db.items[b.combinationMeleeForm!].range, `${b.combinationMeleeForm} should hold the MELEE usage`).toBeFalsy();
    }
  });

  it('one equipped crescent cross yields both usages, ranged first', () => {
    const s = strikesFor([wield('crescent-cross')]);
    expect(s).toHaveLength(2);
    expect(s[0].name).toBe('Crescent Cross');
    expect(s[0].ranged).toBe(true);
    expect(s[0].damage).toContain('d6');
    expect(s[1].name).toBe('Crescent Cross (Melee)');
    expect(s[1].ranged).toBe(false);
    expect(s[1].damage).toContain('d4');
    // Distinct instanceIds or the Strikes tab collapses them and the damage popup opens the wrong one.
    expect(s[0].instanceId).not.toBe(s[1].instanceId);
  });

  it('both usages share the fundamental runes on the one weapon', () => {
    const s = strikesFor([wield('crescent-cross', { runes: { potency: 2, striking: 'greater' } })]);
    expect(s).toHaveLength(2);
    expect(s[0].potencyBonus).toBe(2);
    expect(s[1].potencyBonus).toBe(2);
    // The point is the SHARING, not the tier: whatever striking resolves to on the ranged usage is
    // what the melee usage gets, because both read the one inventory row the rune is etched on.
    expect(s[0].strikingDice).toBeGreaterThan(1);
    expect(s[1].strikingDice).toBe(s[0].strikingDice);
  });

  it('the melee usage keeps its own damage type, group and traits', () => {
    const s = strikesFor([wield('gun-sword')]);
    const melee = s.find((x) => x.name.endsWith('(Melee)'))!;
    const ranged = s.find((x) => x.name === 'Gun Sword')!;
    expect(ranged.group).toBe(db.items['gun-sword'].group);
    expect(melee.group).toBe(db.items['gun-sword-melee'].group);
    expect(melee.damage).toContain('d8');
    expect(ranged.damage).toContain('d10');
  });

  it('an unequipped combination weapon yields no Strike at all', () => {
    expect(strikesFor([wield('crescent-cross', { equipped: false })])).toHaveLength(0);
  });

  it('every combination weapon in the corpus produces exactly two Strikes', () => {
    for (const b of bases) {
      const s = strikesFor([wield(b.id)]);
      expect(s.map((x) => x.name), b.id).toEqual([b.name, db.items[b.combinationMeleeForm!].name]);
    }
  });
});
