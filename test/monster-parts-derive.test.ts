import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { applyPlayState, initialPlay } from '../src/rules/play';
import { deriveStrikes, deriveSkill } from '../src/rules/derive';
import { refinementCost } from '../src/rules/monsterParts';
import type { Character, InventoryItem, ItemMonsterPart } from '../src/rules/types';

const db = content();

/** An equipped weapon inventory entry carrying a Monster-Parts blob (and, optionally, runes to prove
 *  the runes are ignored in MP mode). */
function weaponEntry(itemId: string, monsterPart: ItemMonsterPart, over: Partial<InventoryItem> = {}): InventoryItem {
  return {
    instanceId: `inv-${itemId}`,
    itemId,
    quantity: 1,
    equipped: true,
    monsterPart,
    ...over,
  };
}

function withInventory(ch: Character, items: InventoryItem[]): Character {
  return { ...ch, inventory: [...ch.inventory, ...items] };
}

describe('Monster Parts — refined + imbued weapon', () => {
  it('a refined + fire-might imbued longsword yields the right attack bonus, striking dice, and fire rider', () => {
    // Level-16 fighter with the Monster Parts variant on. Refine a longsword (weapons column) to item
    // level 16 → +3 attack item bonus + greater striking (2 extra dice); imbue Fire (Might) at level 16
    // → 1d6 additional fire damage (Might: 1 flat @4, 1d4 @6, 1d6 @8; 16 falls in the 1d6 band).
    const ch = build('fighter', 16, { keyAbility: 'str', variantRules: { monsterParts: true, monsterPartsMode: 'hybrid' } });
    const mp: ItemMonsterPart = {
      kind: 'weapon',
      refineValue: refinementCost(16, 'weapon'), // 10,000 gp → item level 16
      imbuements: [{ propertyId: 'fire', path: 'might', value: refinementCost(16, 'weapon') }],
    };
    const withMp = withInventory(ch, [weaponEntry('longsword', mp)]);
    const strike = deriveStrikes(withMp, db).find((s) => s.base === 'longsword');
    expect(strike).toBeTruthy();
    expect(strike!.mpRefined).toBe(true);
    expect(strike!.potencyBonus).toBe(3); // +3 attack (Table 4A, item level 16)
    expect(strike!.strikingDice).toBe(2); // greater striking = 2 extra dice → 3 total
    // 1 base die + 2 striking = 3d8 slashing, plus the imbued 1d6 fire rider.
    expect(strike!.damage).toContain('3d8');
    expect(strike!.damage).toContain('plus 1d6 fire');
  });

  it('an item in Monster-Parts mode ignores its runes and precious material', () => {
    // A longsword with a +2 potency / greater-striking rune AND a Monster-Parts blob refined to only
    // item level 2 (+1 attack, no striking). The rune values must NOT apply — the refinement wins.
    const ch = build('fighter', 16, { keyAbility: 'str', variantRules: { monsterParts: true } });
    const mp: ItemMonsterPart = {
      kind: 'weapon',
      refineValue: refinementCost(2, 'weapon'), // item level 2 → +1 attack, no striking dice
      imbuements: [],
    };
    const entry = weaponEntry('longsword', mp, { runes: { potency: 2, striking: 'greater' } });
    const strike = deriveStrikes(withInventory(ch, [entry]), db).find((s) => s.base === 'longsword');
    expect(strike).toBeTruthy();
    expect(strike!.potencyBonus).toBe(1); // refinement +1, NOT the +2 potency rune
    expect(strike!.strikingDice).toBe(0); // no striking from refinement; the greater-striking rune is ignored
    expect(strike!.damage).toContain('1d8'); // a single base die (no extra striking dice)
  });

  it('the variant rule OFF leaves a Monster-Parts item as a plain runed weapon', () => {
    // Same item, but variantRules.monsterParts is absent → mpActive is false, so the runes DO apply.
    const ch = build('fighter', 16, { keyAbility: 'str' });
    const mp: ItemMonsterPart = { kind: 'weapon', refineValue: refinementCost(2, 'weapon'), imbuements: [] };
    const entry = weaponEntry('longsword', mp, { runes: { potency: 2, striking: 'greater' } });
    const strike = deriveStrikes(withInventory(ch, [entry]), db).find((s) => s.base === 'longsword');
    expect(strike!.potencyBonus).toBe(2); // the potency rune applies (MP mode inactive)
    expect(strike!.strikingDice).toBe(2); // greater striking applies
    expect(strike!.mpRefined).toBeUndefined();
  });
});

describe('Monster Parts — apex skill item', () => {
  it('a Charisma skill item imbued to level 17 grants the apex Charisma boost in play', () => {
    const ch = build('fighter', 17, { keyAbility: 'str', variantRules: { monsterParts: true } });
    expect(ch.abilities.cha).toBeLessThan(18);
    const mp: ItemMonsterPart = {
      kind: 'skill',
      refineValue: refinementCost(17, 'skill'), // item level 17 (skills column)
      imbuements: [{ propertyId: 'charisma', path: 'main', value: refinementCost(17, 'skill') }],
      skillKey: 'diplomacy',
    };
    const item: InventoryItem = {
      instanceId: 'inv-cha-item',
      itemId: 'leather-armor', // any base item; only the monsterPart blob drives the apex
      quantity: 1,
      worn: true,
      invested: true,
      monsterPart: mp,
    };
    const live = applyPlayState(ch, { ...initialPlay(ch, db), inventory: [...ch.inventory, item] }, db);
    expect(live.abilities.cha).toBe(18); // raised to 18 (apex)
  });

  it('the apex boost does NOT apply when the imbued property is below level 17', () => {
    const ch = build('fighter', 17, { keyAbility: 'str', variantRules: { monsterParts: true } });
    const before = ch.abilities.cha;
    const mp: ItemMonsterPart = {
      kind: 'skill',
      refineValue: refinementCost(9, 'skill'),
      imbuements: [{ propertyId: 'charisma', path: 'main', value: refinementCost(9, 'skill') }], // level 9 < 17
      skillKey: 'diplomacy',
    };
    const item: InventoryItem = {
      instanceId: 'inv-cha-item',
      itemId: 'leather-armor',
      quantity: 1,
      worn: true,
      invested: true,
      monsterPart: mp,
    };
    const live = applyPlayState(ch, { ...initialPlay(ch, db), inventory: [...ch.inventory, item] }, db);
    expect(live.abilities.cha).toBe(before); // no apex boost yet
  });
});

describe('Monster Parts — refined skill item bonus', () => {
  it('a refined skill item adds an item bonus to its chosen skill only', () => {
    const ch = build('fighter', 17, { keyAbility: 'str', variantRules: { monsterParts: true } });
    const mp: ItemMonsterPart = {
      kind: 'skill',
      refineValue: refinementCost(17, 'skill'), // +3 skill item bonus (Table 4E, level 17)
      imbuements: [],
      skillKey: 'diplomacy',
    };
    const item: InventoryItem = {
      instanceId: 'inv-skill-item',
      itemId: 'leather-armor',
      quantity: 1,
      worn: true,
      invested: true,
      monsterPart: mp,
    };
    const withMp = withInventory(ch, [item]);
    const dip = deriveSkill(withMp, 'diplomacy', db).modifier;
    const dipBase = deriveSkill(ch, 'diplomacy', db).modifier;
    expect(dip - dipBase).toBe(3); // +3 item bonus to the chosen skill
    // A different skill is unaffected.
    const stealth = deriveSkill(withMp, 'stealth', db).modifier;
    const stealthBase = deriveSkill(ch, 'stealth', db).modifier;
    expect(stealth - stealthBase).toBe(0);
  });
});
