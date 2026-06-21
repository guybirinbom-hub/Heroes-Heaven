import { describe, it, expect } from 'vitest';
import { deriveBulk, containerLoads } from '../src/rules/derive';
import type { Character, ContentDatabase, InventoryItem } from '../src/rules/types';

// Minimal content: two identical containers (own Bulk L, ignore 2, capacity 4) + a 1-Bulk item.
const db = {
  items: {
    bp: { id: 'bp', itemType: 'container', name: 'Backpack', bulk: 0.1, ignoredBulk: 2, capacity: { bulk: 4 } },
    po: { id: 'po', itemType: 'container', name: 'Pouch', bulk: 0.1, ignoredBulk: 2, capacity: { bulk: 4 } },
    rock: { id: 'rock', itemType: 'equipment', name: 'Rock', bulk: 1 },
  },
} as unknown as ContentDatabase;

const char = (inventory: InventoryItem[]): Character =>
  ({ abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, inventory, currency: {} }) as unknown as Character;

describe('nested container bulk', () => {
  it('reduces innermost-first and bubbles up (a deep nest barely weighs anything)', () => {
    // 4 rocks (4 Bulk) in a pouch (−2) inside a backpack (−2): pouch→2.1, backpack→0.2
    const ch = char([
      { instanceId: 'b1', itemId: 'bp', quantity: 1 },
      { instanceId: 'p1', itemId: 'po', quantity: 1, containerInstanceId: 'b1' },
      { instanceId: 'r1', itemId: 'rock', quantity: 4, containerInstanceId: 'p1' },
    ]);
    expect(deriveBulk(ch, db).total).toBe(0.2);
  });

  it('single-level reduction matches the container ignore value', () => {
    // 3 Bulk of rocks in a backpack (−2): 0.1 + max(0, 3−2) = 1.1
    const ch = char([
      { instanceId: 'b1', itemId: 'bp', quantity: 1 },
      { instanceId: 'r1', itemId: 'rock', quantity: 3, containerInstanceId: 'b1' },
    ]);
    expect(deriveBulk(ch, db).total).toBe(1.1);
  });

  it('containerLoads counts a nested container by its effective (loaded) Bulk', () => {
    const ch = char([
      { instanceId: 'b1', itemId: 'bp', quantity: 1 },
      { instanceId: 'p1', itemId: 'po', quantity: 1, containerInstanceId: 'b1' },
      { instanceId: 'r1', itemId: 'rock', quantity: 4, containerInstanceId: 'p1' },
    ]);
    const loads = containerLoads(ch, db);
    // The backpack holds the LOADED pouch: pouch own (0.1) + its reduced contents (4−2) = 2.1,
    // so a fully-loaded sub-container counts against the parent's capacity (can't hide Bulk by nesting).
    expect(loads.b1).toEqual({ used: 2.1, capacity: 4 });
    expect(loads.p1).toEqual({ used: 4, capacity: 4 }); // the rocks fill the pouch exactly
  });
});
