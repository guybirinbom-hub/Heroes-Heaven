import { describe, it, expect } from 'vitest';
import { emptyPlay, playForRebuild, type PlayState } from '../src/rules/play';

// Regression for the audit finding: editing a played character ignored gear/spell/resource
// changes because stale play overrides shadowed the rebuild. playForRebuild drops the
// build-derived overrides (so the rebuild wins) while keeping genuine in-play progress.
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

  it('drops build-derived overrides so the rebuild is authoritative', () => {
    expect(out.inventory).toBeUndefined();
    expect(out.currency).toBeUndefined();
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
