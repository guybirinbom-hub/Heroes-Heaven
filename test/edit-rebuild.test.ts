import { describe, it, expect } from 'vitest';
import { emptyPlay, playForRebuild, type PlayState } from '../src/rules/play';

// playForRebuild reconciles the play overlay when a build is edited/leveled: it re-derives spell
// prep + class resources from the new build (dropping those overrides) and refills usage counters,
// while KEEPING genuine in-play progress — including the player's actual inventory + currency, which
// are real progress (items bought/looted, gold spent), not build-derived. (A prior version wrongly
// dropped inventory/currency, wiping the player's gear on every level-up.)
describe('playForRebuild (reconcile play state on edit)', () => {
  const p: PlayState = {
    ...emptyPlay(),
    damage: 10,
    tempHp: 3,
    heroPoints: 2,
    xp: 500,
    conditions: [{ id: 'frightened', value: 1 }],
    pinned: ['action:Stride'],
    notes: [{ id: 'note-0', title: 'x', content: 'y', icon: 'ti-note' }],
    inventory: [{ instanceId: 'inv-0', itemId: 'old-sword', quantity: 1 }],
    currency: { gp: 99 },
    resources: { rage: 1 },
    preparedSpells: { 'a:1:0': 'heal' },
    repertoireSpells: { a: { 1: ['heal'] } },
    signatureSpells: { a: ['heal'] },
    slotsUsed: { 'a:1': 2 },
    expendedSlots: { 'a:1:0': true },
    focusUsed: 1,
  };
  const out = playForRebuild(p);

  it('keeps genuine progress (damage, temp, hero, XP, conditions, pins, notes)', () => {
    expect(out.damage).toBe(10);
    expect(out.tempHp).toBe(3);
    expect(out.heroPoints).toBe(2);
    expect(out.xp).toBe(500);
    expect(out.conditions).toEqual([{ id: 'frightened', value: 1 }]);
    expect(out.pinned).toEqual(['action:Stride']);
    expect(out.notes).toHaveLength(1);
  });

  it('keeps the player\'s inventory + currency (real in-play progress, not build-derived)', () => {
    expect(out.inventory).toEqual([{ instanceId: 'inv-0', itemId: 'old-sword', quantity: 1 }]);
    expect(out.currency).toEqual({ gp: 99 });
  });

  it('drops build-derived spell/resource overrides so the rebuild is authoritative', () => {
    expect(out.resources).toBeUndefined();
    expect(out.preparedSpells).toBeUndefined();
    expect(out.repertoireSpells).toBeUndefined();
    expect(out.signatureSpells).toBeUndefined();
  });

  it('resets usage counters (slots/focus refill on rebuild)', () => {
    expect(out.slotsUsed).toEqual({});
    expect(out.expendedSlots).toEqual({});
    expect(out.focusUsed).toBe(0);
  });
});
