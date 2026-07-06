import { describe, it, expect } from 'vitest';
import { setItemMonsterPart, setItemRefineValue, setItemImbuements, type PlayState } from '../src/rules/play';
import { refinementCost } from '../src/rules/monsterParts';
import type { InventoryItem, ItemMonsterPart } from '../src/rules/types';

function play(over: Partial<PlayState> = {}): PlayState {
  return {
    damage: 0,
    tempHp: 0,
    heroPoints: 0,
    mythicPoints: 0,
    xp: 0,
    shieldDamage: 0,
    ...over,
  } as PlayState;
}

const weapon = (over: Partial<InventoryItem> = {}): InventoryItem => ({
  instanceId: 'w1',
  itemId: 'longsword',
  quantity: 1,
  equipped: true,
  ...over,
});

describe('Monster Parts — per-item mode toggle', () => {
  it('setting a blob clears runes (either/or)', () => {
    const p = play({ inventory: [weapon({ runes: { potency: 2, striking: 'greater' } })] });
    const mp: ItemMonsterPart = { kind: 'weapon', refineValue: 250, imbuements: [] };
    const next = setItemMonsterPart(p, 'w1', mp);
    const inv = next.inventory![0];
    expect(inv.monsterPart).toEqual(mp);
    expect(inv.runes).toBeUndefined();
  });

  it('clearing the blob drops the monsterPart field', () => {
    const p = play({ inventory: [weapon({ monsterPart: { kind: 'weapon', refineValue: 20, imbuements: [] } })] });
    const next = setItemMonsterPart(p, 'w1', undefined);
    expect(next.inventory![0].monsterPart).toBeUndefined();
  });
});

describe('Monster Parts — reference-only refine/imbue setters', () => {
  it('setItemRefineValue sets the value freely (no deduction) and clears runes, creating a blob if absent', () => {
    const p = play({ inventory: [weapon({ runes: { potency: 1 } })] });
    const next = setItemRefineValue(p, 'w1', 'weapon', refinementCost(16, 'weapon'));
    const inv = next.inventory![0];
    expect(inv.monsterPart).toEqual({ kind: 'weapon', refineValue: refinementCost(16, 'weapon'), imbuements: [] });
    expect(inv.runes).toBeUndefined(); // either/or
  });

  it('setItemRefineValue keeps existing imbuements and rounds/clamps the value', () => {
    const mp: ItemMonsterPart = { kind: 'weapon', refineValue: 100, imbuements: [{ propertyId: 'fire', path: 'might', value: 100 }] };
    const p = play({ inventory: [weapon({ monsterPart: mp })] });
    const next = setItemRefineValue(p, 'w1', 'weapon', -50.7);
    expect(next.inventory![0].monsterPart).toMatchObject({ refineValue: 0, imbuements: mp.imbuements });
  });

  it('setItemImbuements replaces the imbuement list (no-op without a blob)', () => {
    const withBlob = play({ inventory: [weapon({ monsterPart: { kind: 'weapon', refineValue: 250, imbuements: [] } })] });
    const imbs = [{ propertyId: 'cold', path: 'technique', value: 60 }];
    const next = setItemImbuements(withBlob, 'w1', imbs);
    expect(next.inventory![0].monsterPart!.imbuements).toEqual(imbs);
    // No blob → unchanged.
    const noBlob = play({ inventory: [weapon()] });
    expect(setItemImbuements(noBlob, 'w1', imbs)).toBe(noBlob);
  });
});
