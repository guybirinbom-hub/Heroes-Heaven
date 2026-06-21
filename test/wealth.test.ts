import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { coinsToCp, cpToCoins, startingWealthGp } from '../src/rules/wealth';
import { deriveBulk, abilityMod } from '../src/rules/derive';

const c = content();

describe('starting wealth + currency', () => {
  it('level 1 = 15 gp', () => expect(startingWealthGp(1)).toBe(15));
  it('coin conversion round-trips', () => {
    expect(coinsToCp({ gp: 1, sp: 2, cp: 3 })).toBe(123);
    expect(cpToCoins(123)).toEqual({ gp: 1, sp: 2, cp: 3 });
    expect(cpToCoins(1500)).toEqual({ gp: 15 });
  });
  it('a level-1 character with no gear has the full 15 gp', () => {
    expect(coinsToCp(build('fighter', 1, { inventory: [] }).currency)).toBe(1500);
  });
  it('buying gear deducts its price from the budget', () => {
    const sword = c.items['longsword'];
    expect(coinsToCp(sword.price)).toBe(100); // 1 gp
    const ch = build('fighter', 1, { inventory: [{ itemId: 'longsword', quantity: 1 }] });
    expect(coinsToCp(ch.currency)).toBe(1400); // 15 gp − 1 gp
  });
  it('over-budget floors currency at 0', () => {
    const ch = build('fighter', 1, { inventory: [{ itemId: 'longsword', quantity: 100 }] }); // 100 gp > 15
    expect(coinsToCp(ch.currency)).toBe(0);
  });
});

describe('encumbrance thresholds', () => {
  it('encumberedAt = 5 + Str mod, max = 10 + Str mod', () => {
    const ch = build('fighter', 1, {});
    const str = abilityMod(ch.abilities.str);
    const bulk = deriveBulk(ch, c);
    expect(bulk.encumberedAt).toBe(5 + str);
    expect(bulk.max).toBe(10 + str);
  });
});
