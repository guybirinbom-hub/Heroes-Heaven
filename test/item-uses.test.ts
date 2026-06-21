import { describe, it, expect } from 'vitest';
import { setItemCharges, useItemCharge, rest, type PlayState } from '../src/rules/play';
import { itemUses, chargesFor } from '../src/rules/itemUses';
import type { InventoryItem, Item } from '../src/rules/types';
import { content } from './_content';

const base = (): PlayState => ({
  inventory: [
    { instanceId: 'a', itemId: 'wand', quantity: 1 },
    { instanceId: 'b', itemId: 'staff', quantity: 1 },
  ],
});

describe('item limited-use tracking', () => {
  it('setItemCharges adds and clears a tracker', () => {
    let p = setItemCharges(base(), 'a', { current: 1, max: 1, resetsOnRest: true });
    expect(p.inventory!.find((i) => i.instanceId === 'a')!.charges).toEqual({ current: 1, max: 1, resetsOnRest: true });
    p = setItemCharges(p, 'a', undefined);
    expect(p.inventory!.find((i) => i.instanceId === 'a')!.charges).toBeUndefined();
  });

  it('useItemCharge spends and restores, clamped to [0, max]', () => {
    let p = setItemCharges(base(), 'b', { current: 3, max: 3, resetsOnRest: true });
    p = useItemCharge(p, 'b', 1); // spend
    expect(p.inventory!.find((i) => i.instanceId === 'b')!.charges!.current).toBe(2);
    p = useItemCharge(p, 'b', 5); // over-spend clamps at 0
    expect(p.inventory!.find((i) => i.instanceId === 'b')!.charges!.current).toBe(0);
    p = useItemCharge(p, 'b', -10); // restore clamps at max
    expect(p.inventory!.find((i) => i.instanceId === 'b')!.charges!.current).toBe(3);
  });

  it('does nothing for an item without a tracker', () => {
    const p = useItemCharge(base(), 'a', 1);
    expect(p.inventory!.find((i) => i.instanceId === 'a')!.charges).toBeUndefined();
  });
});

describe('rest refills only items that reset on daily preparations', () => {
  it('refills resetsOnRest items to max, leaves others untouched', () => {
    let p = setItemCharges(base(), 'a', { current: 0, max: 1, resetsOnRest: true });
    p = setItemCharges(p, 'b', { current: 0, max: 5, resetsOnRest: false });
    const after = rest(p, { level: 5, conMod: 2 });
    expect(after.inventory!.find((i) => i.instanceId === 'a')!.charges!.current).toBe(1); // refilled
    expect(after.inventory!.find((i) => i.instanceId === 'b')!.charges!.current).toBe(0); // not a daily item
  });

  it('a staff-style daily charge pool refills on rest', () => {
    let p = setItemCharges(base(), 'b', { current: 1, max: 6, resetsOnRest: true });
    const after = rest(p, { level: 11, conMod: 3 });
    expect(after.inventory!.find((i) => i.instanceId === 'b')!.charges!.current).toBe(6);
  });
});

describe('itemUses — data-driven from each item\'s parsed frequency', () => {
  const inv = (over: Partial<InventoryItem> = {}): InventoryItem => ({ instanceId: 'i', itemId: 'x', quantity: 1, ...over });
  const item = (frequency?: { max: number; per: string }): Item =>
    ({ id: 'x', name: 'X', level: 1, bulk: 0, traits: [], rarity: 'common', description: '', itemType: 'equipment', ...(frequency ? { frequency } : {}) } as Item);

  it('returns null for an item with no frequency (no tracker)', () => {
    expect(itemUses(item(undefined), inv())).toBeNull();
  });

  it('seeds current=max from the item frequency until the instance records charges', () => {
    expect(itemUses(item({ max: 3, per: 'day' }), inv())).toEqual({ current: 3, max: 3, resetsOnRest: true, per: 'day' });
    expect(itemUses(item({ max: 3, per: 'day' }), inv({ charges: { current: 1, max: 3 } }))!.current).toBe(1);
  });

  it('per day/hour/round refill on rest; per week/month do not', () => {
    expect(itemUses(item({ max: 1, per: 'day' }), inv())!.resetsOnRest).toBe(true);
    expect(itemUses(item({ max: 1, per: 'hour' }), inv())!.resetsOnRest).toBe(true);
    expect(itemUses(item({ max: 1, per: 'week' }), inv())!.resetsOnRest).toBe(false);
    expect(itemUses(item({ max: 1, per: 'month' }), inv())!.resetsOnRest).toBe(false);
  });

  it('chargesFor clamps to [0, max] and carries the reset flag', () => {
    const info = { current: 2, max: 3, resetsOnRest: true, per: 'day' };
    expect(chargesFor(info, 5)).toEqual({ current: 3, max: 3, resetsOnRest: true });
    expect(chargesFor(info, -1)).toEqual({ current: 0, max: 3, resetsOnRest: true });
  });

  it('real data: per-day items get a tracker, plain gear does not', () => {
    const C = content();
    const cloak = C.items['cloak-of-the-bat'];
    const flaming = C.items['flaming'];
    if (cloak) expect(itemUses(cloak, inv({ itemId: cloak.id }))).toMatchObject({ max: 1, per: 'day', resetsOnRest: true });
    if (flaming) expect(itemUses(flaming, inv({ itemId: flaming.id }))).toBeNull();
  });
});
