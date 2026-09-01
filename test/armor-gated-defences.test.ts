import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveDefenses } from '../src/rules/derive';
import type { Character } from '../src/rules/types';

/*
 * *"WHILE WEARING YOUR ARMOR, you gain resistance to slashing damage equal to half your level."*
 *
 * Five inventor armour modifications print that gate, and the defence aggregator pushed every owned
 * class feature unconditionally — so the resistance survived taking the suit off. Found by generalising
 * the owner's Speed ruling to the other numeric lanes; worn ITEMS were already gated correctly, so this
 * was only ever the class-feature path.
 *
 * The gate is `armored`, not the innovation DESIGNATION: designation is a manual toggle nothing sets
 * automatically, so gating on it stripped the resistance from every inventor who never flipped it —
 * under-granting the common case to fix a rare one. See the note on `defensesRequire` in types.ts.
 */
const db = content();

const inArmor = (c: Character): Character => ({
  ...c,
  inventory: [...c.inventory, { instanceId: 'suit', itemId: 'half-plate', quantity: 1, worn: true }],
});

const slashing = (c: Character) => deriveDefenses(c, db).resistances.find((r) => r.type === 'slashing')?.value ?? 0;

describe('armour-gated defences', () => {
  const inv = build('inventor', 9, {
    subclassId: 'armor-innovation',
    inventorModifications: { initial: 'muscular-exoskeleton', breakthrough: 'dense-plating' },
  });

  it('grants the resistance while armour is worn', () => {
    expect(slashing(inArmor(inv)), 'half of level 9 is 4').toBe(4);
  });

  it('grants NOTHING with the armour off', () => {
    expect(slashing(inv), 'the clause says "while wearing your armor"').toBe(0);
  });

  it("explorer's clothing is not armour for this purpose", () => {
    /* It is *unarmored*-category, which is the same test `isUnarmored` applies to Monk Moves. */
    const clothed = { ...inv, inventory: [...inv.inventory, { instanceId: 'c', itemId: 'explorers-clothing', quantity: 1, worn: true }] };
    expect(slashing(clothed)).toBe(0);
  });

  it('all five armour modifications carry the gate', () => {
    for (const id of ['dense-plating', 'energy-barrier', 'layered-mesh', 'physical-protections', 'tensile-absorption']) {
      expect(db.classFeatures[id]?.defensesRequire?.armored, `${id} must be gated`).toBe(true);
    }
  });

  it('an UNGATED resistance is untouched — the gate did not become a blanket suppression', () => {
    /* Control: phlogistonic-regulator prints no armour clause, so it must survive with the suit off. */
    const plain = build('inventor', 9, { subclassId: 'armor-innovation', inventorModifications: { initial: 'phlogistonic-regulator' } });
    const cold = deriveDefenses(plain, db).resistances.find((r) => r.type === 'cold')?.value ?? 0;
    expect(cold, 'no "while wearing" clause on this one — it applies unarmoured').toBeGreaterThan(0);
  });
});
