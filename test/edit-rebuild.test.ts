import { describe, it, expect } from 'vitest';
import { emptyPlay, playForRebuild, type PlayState } from '../src/rules/play';

// playForRebuild reconciles the play overlay when a build is edited/leveled: it refills the three
// usage counters (expended slots, the spontaneous pool, focus) and KEEPS everything else — the
// player's damage, temp HP, hero points, XP, conditions, pins, notes, and their actual inventory +
// currency, which are real progress (items bought/looted, gold spent), not build-derived. (A prior
// version wrongly dropped inventory/currency, wiping the player's gear on every level-up.)
//
// ⛔ The "drops build-derived spell/resource overrides" case below USED to assert the opposite, and
// it was asserting a data-loss bug: deleting the player's sheet-side spell picks on a rebuild is
// what made a flexible spellcaster's whole collection vanish on a Save that changed nothing (owner
// report 2026-09-22). A pick is now dropped only where the FRESH built character makes it illegal,
// and `playForRebuild(p)` — the call here — is handed no character at all, so it has no legality to
// judge and keeps the overlay verbatim. See test/bug-builder-save-lossless.test.ts for the full
// round-trip with a character on both sides.
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

  it('keeps the spell + resource overrides when it has no build answers to compare', () => {
    expect(out.resources).toEqual({ rage: 1 });
    expect(out.preparedSpells).toEqual({ 'a:1:0': 'heal' });
    expect(out.repertoireSpells).toEqual({ a: { 1: ['heal'] } });
    expect(out.signatureSpells).toEqual({ a: ['heal'] });
  });

  it('resets usage counters (slots/focus refill on rebuild)', () => {
    expect(out.slotsUsed).toEqual({});
    expect(out.expendedSlots).toEqual({});
    expect(out.focusUsed).toBe(0);
  });
});
