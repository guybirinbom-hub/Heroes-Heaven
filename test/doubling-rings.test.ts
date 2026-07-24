import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { deriveStrike, doublingRingsAvailable } from '../src/rules/derive';
import type { Character } from '../src/rules/types';

describe('Doubling Rings — rune duplication', () => {
  const db = content();
  const base = () => build('fighter', 8, { ancestryId: 'human', backgroundId: 'warrior' });
  const withInv = (rings: string | null, tgtItem: string, copy: boolean): Character => {
    const c = base();
    c.inventory = [
      { instanceId: 'src', itemId: 'longsword', quantity: 1, equipped: true, runes: { potency: 2, striking: 'striking' } },
      { instanceId: 'tgt', itemId: tgtItem, quantity: 1, equipped: true, ...(copy ? { copyRunesFrom: 'src' } : {}) },
      ...(rings ? [{ instanceId: 'r', itemId: rings, quantity: 1, invested: true }] : []),
    ] as never;
    return c;
  };
  const potency = (c: Character, id: string) => deriveStrike(c, db, c.inventory.find((i) => i.instanceId === id)!)!.potencyBonus;

  it('copies the source weapon\'s potency onto the target while rings are invested', () => {
    expect(potency(withInv('doubling-rings', 'longsword', true), 'tgt')).toBe(2);
  });
  it('does nothing without the rings invested', () => {
    expect(potency(withInv(null, 'longsword', true), 'tgt')).toBe(0);
  });
  it('base rings require the same weapon group', () => {
    expect(potency(withInv('doubling-rings', 'mace', true), 'tgt')).toBe(0); // sword vs club
  });
  it('greater rings lift the same-group restriction', () => {
    expect(potency(withInv('doubling-rings-greater', 'mace', true), 'tgt')).toBe(2);
  });
  it('is only available with rings invested AND two weapons wielded', () => {
    expect(doublingRingsAvailable(withInv('doubling-rings', 'longsword', false), db)).toBe(true);
    const oneWeapon = base();
    oneWeapon.inventory = [
      { instanceId: 'src', itemId: 'longsword', quantity: 1, equipped: true },
      { instanceId: 'r', itemId: 'doubling-rings', quantity: 1, invested: true },
    ] as never;
    expect(doublingRingsAvailable(oneWeapon, db)).toBe(false);
  });
});

describe('item strike-damage riders', () => {
  it('an invested item adds a global strike-damage rider (Crimson-Fulcrum-Lens pattern)', () => {
    const db = content();
    // Synthetic: give an item a melee strike-damage rider, verify it lands on a melee Strike.
    db.items['cloak-of-elvenkind'].strikeDamage = [{ type: 'spirit', appliesTo: 'melee', flat: 2 }] as never;
    db.items['cloak-of-elvenkind'].itemType = 'equipment' as never;
    try {
      const c = build('fighter', 5, {});
      c.inventory = [
        { instanceId: 'w', itemId: 'longsword', quantity: 1, equipped: true },
        { instanceId: 'c', itemId: 'cloak-of-elvenkind', quantity: 1, worn: true, invested: true },
      ] as never;
      const dmg = deriveStrike(c, db, c.inventory[0])!.damage;
      expect(dmg).toContain('2 spirit');
    } finally {
      delete db.items['cloak-of-elvenkind'].strikeDamage;
    }
  });
  it("a weapon's own intrinsic rider applies only to that weapon", () => {
    const db = content();
    db.items['longsword'].strikeDamage = [{ type: 'poison', appliesTo: 'all', dice: { n: 2, die: 'd6' } }] as never;
    try {
      const c = build('fighter', 5, {});
      c.inventory = [
        { instanceId: 'w', itemId: 'longsword', quantity: 1, equipped: true },
        { instanceId: 'd', itemId: 'dagger', quantity: 1, equipped: true },
      ] as never;
      expect(deriveStrike(c, db, c.inventory[0])!.damage).toContain('2d6 poison');
      expect(deriveStrike(c, db, c.inventory[1])!.damage).not.toContain('poison');
    } finally {
      delete db.items['longsword'].strikeDamage;
    }
  });
});
