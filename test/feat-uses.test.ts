import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { rest } from '../src/rules/play';
import type { PlayState } from '../src/rules/play';
import { featUse, featUses, spendFeatUse, refundFeatUse, usesLabel } from '../src/rules/featUses';
import type { Character, Feat } from '../src/rules/types';

const c = content();

/**
 * PER-DAY FEAT USES.
 *
 * Items have had trackable uses for a while; feats had none, so ~900 records printing "Frequency once
 * per day" were text the player had to remember unaided. A feat opts in with `limitedUses`; spent uses
 * live in PlayState.featUses and refill at rest, exactly like focus points and spell slots.
 */
describe('feat uses', () => {
  const withLimit = (max: number): Feat => ({ id: 'x-feat', name: 'X', limitedUses: { max, per: 'day' } } as Feat);
  const ch = (spent?: Record<string, number>): Character => ({ ...build('fighter', 5), featUses: spent } as Character);

  it('a feat without limitedUses has no tracker', () => {
    expect(featUse(ch(), { id: 'y', name: 'Y' } as Feat)).toBeNull();
    expect(featUse(ch(), undefined)).toBeNull();
  });

  it('starts full and counts down', () => {
    expect(featUse(ch(), withLimit(3))?.current).toBe(3);
    expect(featUse(ch({ 'x-feat': 2 }), withLimit(3))?.current).toBe(1);
    expect(featUse(ch({ 'x-feat': 3 }), withLimit(3))?.current).toBe(0);
  });

  it('a stale spend count can never show negative uses', () => {
    // Retraining a feat or a data change can leave a spend count higher than the new max.
    expect(featUse(ch({ 'x-feat': 99 }), withLimit(1))?.current).toBe(0);
  });

  it('spend and refund clamp at both ends', () => {
    expect(spendFeatUse({}, 'x-feat', 2)).toEqual({ 'x-feat': 1 });
    expect(spendFeatUse({ 'x-feat': 2 }, 'x-feat', 2)).toEqual({ 'x-feat': 2 });
    expect(refundFeatUse({ 'x-feat': 1 }, 'x-feat')).toEqual({ 'x-feat': 0 });
    expect(refundFeatUse({ 'x-feat': 0 }, 'x-feat')).toEqual({ 'x-feat': 0 });
  });

  it('RESTING refills them, like focus points and slots', () => {
    const play = { damage: 4, featUses: { 'x-feat': 2 } } as unknown as PlayState;
    const after = rest(play, { level: 5, conMod: 2 });
    expect(after.featUses).toEqual({});
    // …while daily CHOICES deliberately survive, since "reuse my last pick" depends on them.
    const withChoice = { damage: 0, dailyChoices: { 'a:b': 'heat' }, featUses: { 'x-feat': 1 } } as unknown as PlayState;
    const after2 = rest(withChoice, { level: 5, conMod: 2 });
    expect(after2.featUses).toEqual({});
    expect(after2.dailyChoices).toEqual({ 'a:b': 'heat' });
  });

  it('lists only the limited-use feats a character actually has', () => {
    expect(featUses(ch(), c)).toEqual([]);
    expect(usesLabel({ max: 1, per: 'day' })).toBe('1/day');
  });
});
