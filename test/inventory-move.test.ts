import { describe, it, expect } from 'vitest';
import { emptyPlay, toggleItemFlag, updateInventoryItem, type PlayState } from '../src/rules/play';

// Backs the inventory drag-and-drop: relocating an item patches its carry flags +
// containerInstanceId on the matching instance only.
describe('updateInventoryItem (drag-and-drop relocation)', () => {
  const base: PlayState = {
    ...emptyPlay(),
    inventory: [
      { instanceId: 'a', itemId: 'sword', quantity: 1, equipped: true },
      { instanceId: 'b', itemId: 'potion', quantity: 2 },
    ],
  };

  it('un-equips and moves an item into a container (only that instance)', () => {
    const out = updateInventoryItem(base, 'a', { equipped: false, worn: false, containerInstanceId: 'pack' });
    const a = out.inventory!.find((i) => i.instanceId === 'a')!;
    const b = out.inventory!.find((i) => i.instanceId === 'b')!;
    expect(a.equipped).toBe(false);
    expect(a.containerInstanceId).toBe('pack');
    expect(b).toEqual(base.inventory![1]); // untouched
  });

  it('equipping clears the container assignment', () => {
    const inPack: PlayState = { ...base, inventory: [{ instanceId: 'a', itemId: 'sword', quantity: 1, containerInstanceId: 'pack' }] };
    const out = updateInventoryItem(inPack, 'a', { equipped: true, containerInstanceId: undefined });
    const a = out.inventory!.find((i) => i.instanceId === 'a')!;
    expect(a.equipped).toBe(true);
    expect(a.containerInstanceId).toBeUndefined();
  });
});

// The Equipped section only lists "loose" items, so wielding/wearing/investing an item that lives in a
// backpack must pull it OUT of the container — otherwise it stays hidden in the container after equipping.
describe('toggleItemFlag (equip button pulls item out of its container)', () => {
  const inPack: PlayState = {
    ...emptyPlay(),
    inventory: [{ instanceId: 'a', itemId: 'sword', quantity: 1, containerInstanceId: 'pack' }],
  };

  for (const flag of ['equipped', 'worn', 'invested'] as const) {
    it(`${flag} clears containerInstanceId (moves the item to Equipped)`, () => {
      const out = toggleItemFlag(inPack, 'a', flag);
      const a = out.inventory!.find((i) => i.instanceId === 'a')!;
      expect(a[flag]).toBe(true);
      expect(a.containerInstanceId).toBeUndefined();
    });
  }

  it('un-equipping just clears the flag (item stays loose → Carried)', () => {
    const equipped: PlayState = { ...emptyPlay(), inventory: [{ instanceId: 'a', itemId: 'sword', quantity: 1, equipped: true }] };
    const out = toggleItemFlag(equipped, 'a', 'equipped');
    const a = out.inventory!.find((i) => i.instanceId === 'a')!;
    expect(a.equipped).toBe(false);
    expect(a.containerInstanceId).toBeUndefined();
  });
});
