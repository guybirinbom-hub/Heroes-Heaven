import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { coinsToCp, cpToCoins, startingWealthGp } from '../src/rules/wealth';
import { deriveBulk, abilityMod } from '../src/rules/derive';

const c = content();

describe('starting wealth + currency', () => {
  // Owner's call (2026-09-17): a NEW character starts with 0 gold, at any level. The
  // STARTING_WEALTH_GP table stays as reference data (still tested below) but buildCharacter no
  // longer spends from it — gold on a fresh character is exactly 0, gear picked in the builder or
  // not.
  it('the STARTING_WEALTH_GP table still holds the reference figure (kept, not applied at creation)', () =>
    expect(startingWealthGp(1)).toBe(15));
  it('coin conversion round-trips', () => {
    expect(coinsToCp({ gp: 1, sp: 2, cp: 3 })).toBe(123);
    expect(cpToCoins(123)).toEqual({ gp: 1, sp: 2, cp: 3 });
    expect(cpToCoins(1500)).toEqual({ gp: 15 });
  });
  it('a new level-1 character with no gear starts at 0 gold', () => {
    expect(coinsToCp(build('fighter', 1, { inventory: [] }).currency)).toBe(0);
  });
  it('picking gear in the builder does not draw from a starting purse (there is none)', () => {
    const sword = c.items['longsword'];
    expect(coinsToCp(sword.price)).toBe(100); // 1 gp — price still normal, just not deducted from a budget
    const ch = build('fighter', 1, { inventory: [{ itemId: 'longsword', quantity: 1 }] });
    expect(coinsToCp(ch.currency)).toBe(0);
  });
  it('a new character has 0 cp/sp/gp/pp at level 1 and at level 7, regardless of the wealth table', () => {
    for (const level of [1, 7]) {
      const ch = build('fighter', level, { inventory: [] });
      expect(ch.currency.cp ?? 0).toBe(0);
      expect(ch.currency.sp ?? 0).toBe(0);
      expect(ch.currency.gp ?? 0).toBe(0);
      expect(ch.currency.pp ?? 0).toBe(0);
    }
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
