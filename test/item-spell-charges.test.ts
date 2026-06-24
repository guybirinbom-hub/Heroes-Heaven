import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { chargeCounterId, chargeCostToCast, canCastFromItem, itemCounters } from '../src/rules/itemUses';
import type { InventoryItem, Item } from '../src/rules/types';

const db = content();
const staff = db.items['staff-of-healing']; // counter 'pool', max:'level' (level 4)
const wand = db.items['magic-wand-1st-rank-spell']; // counter 'freq', 1/day
const scroll = Object.values(db.items).find(
  (it): it is Item => it.itemType === 'consumable' && it.consumableType === 'scroll',
);

const inv = (itemId: string, counters?: InventoryItem['counters']): InventoryItem =>
  ({ instanceId: 'i', itemId, quantity: 1, counters }) as InventoryItem;

describe('item spell charges', () => {
  it('identifies the right charge counter (staff pool / wand freq / scroll none)', () => {
    expect(chargeCounterId(staff)).toBe('pool');
    expect(chargeCounterId(wand)).toBe('freq');
    if (scroll) expect(chargeCounterId(scroll)).toBeNull();
  });

  it('charge cost: a staff spends the spell rank, a wand spends 1, cantrips are free', () => {
    expect(chargeCostToCast(staff, 1)).toBe(1);
    expect(chargeCostToCast(staff, 3)).toBe(3);
    expect(chargeCostToCast(staff, 0)).toBe(0); // cantrip — at will
    expect(chargeCostToCast(wand, 1)).toBe(1);
  });

  it('a fresh staff starts with charges = its level and can cast', () => {
    const full = inv('staff-of-healing'); // no stored counters → startsFull
    const u = itemCounters(staff, full).find((c) => c.id === 'pool')!;
    expect(u.max).toBe(staff.level); // 4
    expect(u.current).toBe(staff.level); // startsFull:true
    expect(canCastFromItem(staff, full, 1)).toBe(true);
  });

  it('charge gating: not enough charges blocks a leveled cast but never a cantrip', () => {
    const empty = inv('staff-of-healing', { pool: { current: 0, max: 4 } });
    expect(canCastFromItem(staff, empty, 1)).toBe(false); // no charges for a rank-1 spell
    expect(canCastFromItem(staff, empty, 0)).toBe(true); // a cantrip is still free
    const one = inv('staff-of-healing', { pool: { current: 1, max: 4 } });
    expect(canCastFromItem(staff, one, 1)).toBe(true);
    expect(canCastFromItem(staff, one, 3)).toBe(false); // a rank-3 cast needs 3 charges
  });

  it('a wand is 1/day', () => {
    const ready = inv('magic-wand-1st-rank-spell'); // startsFull → 1
    expect(canCastFromItem(wand, ready, 1)).toBe(true);
    const used = inv('magic-wand-1st-rank-spell', { freq: { current: 0, max: 1 } });
    expect(canCastFromItem(wand, used, 1)).toBe(false);
  });
});
