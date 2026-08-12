import { describe, it, expect } from 'vitest';
import {
  addInventoryItem,
  removeInventoryItem,
  setItemQuantity,
  toggleItemFlag,
  buyItem,
  onCompanionInventory,
  setCompanionInventory,
} from '../src/rules/play';
import type { PlayState } from '../src/rules/play';

/*
 * A companion's gear is rendered by the real InventoryTab, which is written entirely against
 * `play.inventory`. onCompanionInventory is the adapter that lends the companion's pack to that field
 * for one action and puts the result back — so these check that the lending is airtight: the character's
 * own pack must never be touched, and everything else the action did (spending coins) must stick.
 */
const base = (): PlayState =>
  ({
    heroPoints: 0,
    xp: 0,
    inventory: [{ instanceId: 'inv-0', itemId: 'longsword', quantity: 1 }],
    currency: { pp: 0, gp: 100, sp: 0, cp: 0 },
    companions: [
      { id: 'c1', kind: 'animal', name: 'Rex', inventory: [{ instanceId: 'inv-0', itemId: 'barding', quantity: 1 }] },
      { id: 'c2', kind: 'eidolon', name: 'Zed', inventory: [] },
    ],
  }) as unknown as PlayState;

const compInv = (p: PlayState, id: string) => (p.companions ?? []).find((c) => c.id === id)?.inventory ?? [];

describe('companion gear runs through the real inventory actions', () => {
  it('adds to the COMPANION, leaving the character’s pack alone', () => {
    const p = onCompanionInventory(base(), 'c1', (x) => addInventoryItem(x, 'rope'));
    expect(compInv(p, 'c1').map((i) => i.itemId)).toEqual(['barding', 'rope']);
    expect(p.inventory!.map((i) => i.itemId)).toEqual(['longsword']);
  });

  it('removes from the companion by instance id', () => {
    const p = onCompanionInventory(base(), 'c1', (x) => removeInventoryItem(x, 'inv-0'));
    expect(compInv(p, 'c1')).toEqual([]);
    // The character has an inv-0 too — the identical id must not have hit the wrong pack.
    expect(p.inventory!.map((i) => i.instanceId)).toEqual(['inv-0']);
  });

  it('re-quantifies and equips within the companion', () => {
    let p = onCompanionInventory(base(), 'c1', (x) => setItemQuantity(x, 'inv-0', 4));
    expect(compInv(p, 'c1')[0].quantity).toBe(4);
    p = onCompanionInventory(p, 'c1', (x) => toggleItemFlag(x, 'inv-0', 'worn'));
    expect(compInv(p, 'c1')[0].worn).toBe(true);
    expect(p.inventory![0].worn).toBeUndefined();
  });

  it('buying for a companion spends the OWNER’s coins', () => {
    const p = onCompanionInventory(base(), 'c1', (x) => buyItem(x, 'rope', { pp: 0, gp: 5, sp: 0, cp: 0 }));
    expect(compInv(p, 'c1').map((i) => i.itemId)).toContain('rope');
    expect(p.currency!.gp).toBe(95);
  });

  it('touches only the companion it was given', () => {
    const p = onCompanionInventory(base(), 'c1', (x) => addInventoryItem(x, 'rope'));
    expect(compInv(p, 'c2')).toEqual([]);
  });

  it('is a no-op for an unknown companion rather than corrupting the character', () => {
    const before = base();
    const after = onCompanionInventory(before, 'nope', (x) => addInventoryItem(x, 'rope'));
    expect(after).toBe(before);
  });

  it('setCompanionInventory replaces just that companion’s pack', () => {
    const p = setCompanionInventory(base(), 'c2', [{ instanceId: 'inv-9', itemId: 'shield', quantity: 1 }]);
    expect(compInv(p, 'c2').map((i) => i.itemId)).toEqual(['shield']);
    expect(compInv(p, 'c1').map((i) => i.itemId)).toEqual(['barding']);
  });

  it('never mutates the state handed in', () => {
    const p0 = base();
    const snapshot = JSON.stringify(p0);
    onCompanionInventory(p0, 'c1', (x) => addInventoryItem(x, 'rope'));
    expect(JSON.stringify(p0)).toBe(snapshot);
  });
});
