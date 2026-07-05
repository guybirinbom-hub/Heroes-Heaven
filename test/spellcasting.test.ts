import { describe, it, expect } from 'vitest';
import {
  fullCasterSlots,
  twoRankCasterSlots,
  psychicSlots,
  animistPreparedSlots,
  apparitionSlots,
  casterSlots,
  cantripsKnown,
  magusStudiousSpells,
  wizardSpellbookSize,
  maxSpellRank,
  CANTRIPS_KNOWN,
} from '../src/rules/spellcasting';

describe('full caster slots', () => {
  it('ramps a new rank every 2 levels at 2 then 3 slots', () => {
    expect(fullCasterSlots(1)).toEqual({ 1: 2 });
    expect(fullCasterSlots(2)).toEqual({ 1: 3 });
    expect(fullCasterSlots(3)).toEqual({ 1: 3, 2: 2 });
    expect(fullCasterSlots(10)).toEqual({ 1: 3, 2: 3, 3: 3, 4: 3, 5: 3 });
  });
  it('grants a single 10th-rank slot from level 19', () => {
    expect(fullCasterSlots(18)[10]).toBeUndefined();
    expect(fullCasterSlots(19)[10]).toBe(1);
    expect(maxSpellRank(20)).toBe(10);
    expect(maxSpellRank(1)).toBe(1);
  });
});

describe('two-rank caster (magus / summoner)', () => {
  // The authoritative AoN "Spells per Day" table for the magus & summoner (identical for both),
  // transcribed verbatim (the footnoted `*` cells are the magus's separate Studious Spells slots,
  // not base slots, and are excluded). See src/rules/spellcasting.ts twoRankCasterSlots.
  const AON: Record<number, Record<number, number>> = {
    1: { 1: 1 },
    2: { 1: 2 },
    3: { 1: 2, 2: 1 },
    4: { 1: 2, 2: 2 },
    5: { 2: 2, 3: 2 },
    6: { 2: 2, 3: 2 },
    7: { 3: 2, 4: 2 },
    8: { 3: 2, 4: 2 },
    9: { 4: 2, 5: 2 },
    10: { 4: 2, 5: 2 },
    11: { 5: 2, 6: 2 },
    12: { 5: 2, 6: 2 },
    13: { 6: 2, 7: 2 },
    14: { 6: 2, 7: 2 },
    15: { 7: 2, 8: 2 },
    16: { 7: 2, 8: 2 },
    17: { 8: 2, 9: 2 },
    18: { 8: 2, 9: 2 },
    19: { 8: 2, 9: 2 },
    20: { 8: 2, 9: 2 },
  };
  it('matches the AoN magus/summoner Spells per Day table at every level 1-20', () => {
    for (let level = 1; level <= 20; level++) {
      expect(twoRankCasterSlots(level)).toEqual(AON[level]);
    }
  });
  it('gives a newly-unlocked top rank its full 2 slots immediately from 3rd rank on (no odd-level ramp)', () => {
    // Regression: the old heuristic gave 1 slot the level a rank was first accessible (L5,7,9,…,17),
    // but AoN shows 2 slots there (only the 1st two ranks ramp, during levels 1-3).
    expect(twoRankCasterSlots(5)).toEqual({ 2: 2, 3: 2 }); // 3rd rank just unlocked → 2, not 1
    expect(twoRankCasterSlots(9)).toEqual({ 4: 2, 5: 2 }); // 5th rank just unlocked → 2
    expect(twoRankCasterSlots(17)).toEqual({ 8: 2, 9: 2 }); // 9th rank just unlocked → 2
    expect(twoRankCasterSlots(20)[10]).toBeUndefined(); // never a 10th-rank slot
  });
});

describe('psychic slots', () => {
  it('is a limited caster: 2 slots/rank, capped at 9th (no 10th-rank slot)', () => {
    expect(psychicSlots(1)).toEqual({ 1: 1 });
    expect(psychicSlots(2)).toEqual({ 1: 2 });
    expect(psychicSlots(17)).toEqual({ 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 1 });
    expect(psychicSlots(19)[10]).toBeUndefined();
    expect(psychicSlots(20)[9]).toBe(2);
  });
});

describe('animist two pools', () => {
  it('prepared pool: full progression, 2/rank, no 10th', () => {
    expect(animistPreparedSlots(1)).toEqual({ 1: 1 });
    expect(animistPreparedSlots(10)).toEqual({ 1: 2, 2: 2, 3: 2, 4: 2, 5: 2 });
    expect(animistPreparedSlots(19)[10]).toBeUndefined();
    expect(animistPreparedSlots(19)[9]).toBe(2);
  });
  it('apparition pool: AoN Y-column', () => {
    expect(apparitionSlots(1)).toEqual({ 1: 1 });
    expect(apparitionSlots(10)).toEqual({ 1: 2, 2: 2, 3: 2, 4: 1, 5: 1 });
    expect(apparitionSlots(19)).toEqual({ 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 1, 10: 1 });
  });
});

describe('casterSlots dispatch', () => {
  it('routes to the right table by progression', () => {
    expect(casterSlots(5)).toEqual(fullCasterSlots(5));
    expect(casterSlots(5, 'full')).toEqual(fullCasterSlots(5));
    expect(casterSlots(5, 'two-rank')).toEqual(twoRankCasterSlots(5));
    expect(casterSlots(5, 'psychic')).toEqual(psychicSlots(5));
    expect(casterSlots(10, 'animist')).toEqual(animistPreparedSlots(10));
  });
  it('falls back to the FULL prepared table when the progression is undefined (no `progression` field)', () => {
    // A shipped full prepared caster (cleric/druid/witch/wizard) carries no `progression` field, so
    // build.ts passes `undefined` — the default param must yield the complete standard slot table with
    // rank 1 present (not a partial table missing the low ranks).
    expect(casterSlots(5, undefined)).toEqual({ 1: 3, 2: 3, 3: 2 });
    expect(casterSlots(11, undefined)).toEqual({ 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 2 });
  });
});

describe('cantrips known', () => {
  it('is 5 by default, 6 for wizard, 3 for psychic, 2 for animist', () => {
    expect(cantripsKnown('cleric')).toBe(CANTRIPS_KNOWN);
    expect(cantripsKnown('wizard')).toBe(6);
    expect(cantripsKnown('psychic')).toBe(3);
    expect(cantripsKnown('animist')).toBe(2);
  });
});

describe('magus studious spells', () => {
  it('is null before 7, then steps 2nd -> 3rd -> 4th rank', () => {
    expect(magusStudiousSpells(6)).toBeNull();
    expect(magusStudiousSpells(7)?.rank).toBe(2);
    expect(magusStudiousSpells(11)?.rank).toBe(3);
    expect(magusStudiousSpells(13)?.rank).toBe(4);
    expect(magusStudiousSpells(20)?.rank).toBe(4);
    expect(magusStudiousSpells(7)?.spells).toContain('sure-strike');
  });
});

describe('wizard spellbook size', () => {
  it('starts at 5 leveled and adds 2 per level', () => {
    expect(wizardSpellbookSize(1)).toBe(5);
    expect(wizardSpellbookSize(3)).toBe(9);
  });
});
