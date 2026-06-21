import { describe, it, expect } from 'vitest';
import {
  addCompanionItem,
  buyCompanionItem,
  removeCompanionItem,
  setCompanionItemQty,
  toggleCompanionItemFlag,
  type PlayState,
} from '../src/rules/play';

const base = (): PlayState => ({
  currency: { gp: 100 },
  companions: [
    { id: 'c1', kind: 'animal', name: 'Wolf' },
    { id: 'c2', kind: 'familiar', name: 'Cat' },
  ],
});
const comp = (p: PlayState, id: string) => p.companions!.find((c) => c.id === id)!;

describe('companion inventory', () => {
  it('addCompanionItem adds gear to the right companion only', () => {
    const p = addCompanionItem(base(), 'c1', 'hide-barding');
    expect(comp(p, 'c1').inventory).toEqual([{ instanceId: 'inv-0', itemId: 'hide-barding', quantity: 1 }]);
    expect(comp(p, 'c2').inventory).toBeUndefined();
  });

  it('buyCompanionItem deducts the character coins, then adds — and refuses if unaffordable', () => {
    const ok = buyCompanionItem(base(), 'c1', 'barding', { gp: 30 });
    expect(comp(ok, 'c1').inventory).toHaveLength(1);
    expect(ok.currency).toEqual({ gp: 70 });
    const broke = buyCompanionItem(base(), 'c1', 'barding', { gp: 9999 });
    expect(comp(broke, 'c1').inventory).toBeUndefined(); // unchanged
    expect(broke.currency).toEqual({ gp: 100 });
  });

  it('quantity, equip flag, and removal work', () => {
    let p = addCompanionItem(base(), 'c1', 'rations');
    const inst = comp(p, 'c1').inventory![0].instanceId;
    p = setCompanionItemQty(p, 'c1', inst, 5);
    expect(comp(p, 'c1').inventory![0].quantity).toBe(5);
    p = setCompanionItemQty(p, 'c1', inst, 0); // clamps to 1
    expect(comp(p, 'c1').inventory![0].quantity).toBe(1);
    p = toggleCompanionItemFlag(p, 'c1', inst, 'worn');
    expect(comp(p, 'c1').inventory![0].worn).toBe(true);
    p = removeCompanionItem(p, 'c1', inst);
    expect(comp(p, 'c1').inventory).toEqual([]);
  });
});
