import { describe, it, expect } from 'vitest';
import { deriveBulk, containerLoads, containerOptionsFor } from '../src/rules/derive';
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

// The tap-to-stow control (ItemDetail) relies on containerOptionsFor to list legal destinations. It
// must agree with the drag-and-drop rules: no self, no descendants (cycles), and respect capacity.
describe('containerOptionsFor (tap-to-stow eligibility)', () => {
  const inv: InventoryItem[] = [
    { instanceId: 'b1', itemId: 'bp', quantity: 1 },
    { instanceId: 'p1', itemId: 'po', quantity: 1, containerInstanceId: 'b1' },
    { instanceId: 'r1', itemId: 'rock', quantity: 1, containerInstanceId: 'b1' },
  ];

  it('lists containers a loose rock can go into, flagging the one it is already in', () => {
    const opts = containerOptionsFor(inv, db, 'r1');
    const byId = Object.fromEntries(opts.map((o) => [o.instanceId, o]));
    expect(new Set(opts.map((o) => o.instanceId))).toEqual(new Set(['b1', 'p1']));
    expect(byId.b1.current).toBe(true); // the rock is in the backpack
    expect(byId.p1.current).toBe(false);
    expect(byId.b1.fits && byId.p1.fits).toBe(true);
  });

  it('excludes the item itself and its own descendants (no cycles)', () => {
    // The backpack can't be stowed into itself or into the pouch that sits inside it.
    const opts = containerOptionsFor(inv, db, 'b1');
    expect(opts.map((o) => o.instanceId)).not.toContain('b1');
    expect(opts.map((o) => o.instanceId)).not.toContain('p1');
    expect(opts).toHaveLength(0);
  });

  it('marks an over-capacity container as not fitting', () => {
    // A 5-Bulk boulder cannot fit a pouch that only holds 4 (minus its ignored 2 => 6 effective room…),
    // so use a tiny box: capacity 1, and a 3-Bulk crate that won't fit.
    const db2 = {
      items: {
        box: { id: 'box', itemType: 'container', name: 'Small Box', bulk: 0.1, ignoredBulk: 0, capacity: { bulk: 1 } },
        crate: { id: 'crate', itemType: 'equipment', name: 'Crate', bulk: 3 },
      },
    } as unknown as ContentDatabase;
    const inv2: InventoryItem[] = [
      { instanceId: 'x1', itemId: 'box', quantity: 1 },
      { instanceId: 'c1', itemId: 'crate', quantity: 1 },
    ];
    const opts = containerOptionsFor(inv2, db2, 'c1');
    expect(opts).toHaveLength(1);
    expect(opts[0].instanceId).toBe('x1');
    expect(opts[0].fits).toBe(false); // 3 Bulk won't fit a 1-Bulk box
  });
});
