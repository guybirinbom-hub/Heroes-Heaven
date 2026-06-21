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
  it('keeps 2 slots of the top two ranks, no 10th, with an L1-3 ramp', () => {
    expect(twoRankCasterSlots(1)).toEqual({ 1: 1 });
    expect(twoRankCasterSlots(2)).toEqual({ 1: 2 });
    expect(twoRankCasterSlots(3)).toEqual({ 1: 2, 2: 1 });
    expect(twoRankCasterSlots(4)).toEqual({ 1: 2, 2: 2 });
    // A newly-unlocked top rank gets ONE slot at the odd level, two at the next even level.
    expect(twoRankCasterSlots(5)).toEqual({ 2: 2, 3: 1 });
    expect(twoRankCasterSlots(6)).toEqual({ 2: 2, 3: 2 });
    expect(twoRankCasterSlots(17)).toEqual({ 8: 2, 9: 1 });
    expect(twoRankCasterSlots(18)).toEqual({ 8: 2, 9: 2 });
    expect(twoRankCasterSlots(20)).toEqual({ 8: 2, 9: 2 });
    expect(twoRankCasterSlots(20)[10]).toBeUndefined();
  });
});

describe('psychic slots', () => {
  it('is the full rank progression at 2 slots/rank, 10th at 19', () => {
    expect(psychicSlots(1)).toEqual({ 1: 1 });
    expect(psychicSlots(2)).toEqual({ 1: 2 });
    expect(psychicSlots(17)).toEqual({ 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 1 });
    expect(psychicSlots(19)[10]).toBe(1);
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
