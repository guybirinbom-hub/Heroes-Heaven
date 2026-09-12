import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveSpeeds } from '../src/rules/derive';
import { FEAT_SITUATIONAL } from '../src/rules/situationalBonuses';
import type { BuildState } from '../src/rules/build';

const db = content();

/**
 * "…WHEN YOU DON'T HAVE PANACHE, YOU STILL GET HALF THIS STATUS BONUS TO YOUR SPEED, ROUNDED DOWN TO
 * THE NEAREST 5-FOOT INCREMENT." (Vivacious Speed, Player Core 2.)
 *
 * The record carried no number at all — the whole clause was prose on a star. The owner's rule is that
 * a Speed is a real number only when it is ALWAYS on, and the half is exactly that: it applies whether
 * or not you have panache. A 19th-level swashbuckler standing without panache read 25 ft where the
 * book gives 40.
 *
 * The ladder (5 / 10 / 15, stepping at 11th and 19th) is what forced `landSpeedBonus` to accept a
 * formula: typed `number`, the field could say +5 and nothing else, so two of the three tiers had no
 * carrier and the clause stayed prose.
 */
describe('Vivacious Speed pays its always-on half as a real number', () => {
  const swash = (level: number) => build('swashbuckler', level, { ancestryId: 'human' } as Partial<BuildState>);
  const landAt = (level: number) => deriveSpeeds(swash(level), db).land ?? 0;
  const base = (level: number) => deriveSpeeds(build('fighter', level, { ancestryId: 'human' } as Partial<BuildState>), db).land ?? 0;

  it('the record carries the formula, and the feature arrives at 3rd', () => {
    expect(db.classFeatures['vivacious-speed']?.level).toBe(3);
    expect(db.classFeatures['vivacious-speed']?.landSpeedBonus).toBe('5+5*min(2,floor((@actor.level-3)/8))');
  });

  it('a 2nd-level swashbuckler has no floor yet', () => {
    expect(landAt(2)).toBe(base(2));
  });

  it.each([
    [3, 5],
    [6, 5],
    [7, 5],
    [10, 5],
    [11, 10],
    [14, 10],
    [15, 10],
    [18, 10],
    [19, 15],
    [20, 15],
  ])('at level %i the always-on floor is +%i ft', (level, floor) => {
    /* Measured against a same-ancestry character of the same level without the feature, so the test
     * asserts what THIS feature adds rather than what a human's Speed happens to be. */
    expect(landAt(level) - base(level)).toBe(floor);
  });

  it('the printed halving is what the tiers are — full bonus, halved, rounded down to 5 ft', () => {
    /* The clause is arithmetic on the FULL bonus (+10, +5 more at 7th/11th/15th/19th), so the check is
     * that our tiers reproduce the halving rather than a table someone typed. */
    const full = (lvl: number) => 10 + 5 * [7, 11, 15, 19].filter((t) => lvl >= t).length;
    for (let lvl = 3; lvl <= 20; lvl++) {
      expect(landAt(lvl) - base(lvl), `level ${lvl}`).toBe(Math.floor(full(lvl) / 2 / 5) * 5);
    }
  });

  /*
   * desk 154: the star states the PRINTED rule, because the printed rule is now what happens.
   *
   * It used to have to say "half of it … is always on and already in your Speed" — a caveat about the
   * ENGINE, not about the book: only the halved value was carried and the with-panache value reached
   * nothing, so repeating "+10 status" would have promised feet no character ever got. The lane built
   * the conditional half (the record's `whileActive` clause replaces the halved value with the full
   * one, typed status, across all Speeds), so the caveat would now describe a gap that is closed —
   * on the one surface a player reads to find out what panache does.
   *
   * The always-on floor is unchanged and still pinned by the level table above; what this case now
   * guards is that the star does not drift back to describing a limitation.
   */
  it('the star states the printed +10, with no caveat about the floor', () => {
    const star = FEAT_SITUATIONAL['vivacious-speed']!.find((s) => s.targets.some((t) => t.kind === 'speed'))!;
    expect(star.when).toBe('while you have panache');
    expect(star.bonus).toBe('+10 status to your Speeds, increasing by 5 feet at 7th, 11th, 15th and 19th level');
    expect(star.bonus).not.toMatch(/already in your Speed|half of it|instead/i);
  });

  it("…and stylish combatant's own speed bonus stays a star, because it is NOT always on", () => {
    /* The sibling record is the control: +5 status WHILE YOU HAVE PANACHE, with no unconditional half,
     * so the owner's rule leaves it as prose. If this ever became a number the rule would have been
     * misread rather than applied. */
    expect(db.classFeatures['stylish-combatant']?.landSpeedBonus).toBeUndefined();
    const star = FEAT_SITUATIONAL['stylish-combatant']!.find((s) => s.targets.some((t) => t.kind === 'speed'))!;
    expect(star.when).toMatch(/while you have panache/i);
    expect(star.bonus).toBe('+5 status to your Speeds');
  });

  /* The archetype copy of the same clause (feat-6238), reworded for the same reason. */
  it("the swashbuckler's speed archetype feat states its printed +10 too", () => {
    const star = FEAT_SITUATIONAL['swashbucklers-speed']!.find((s) => s.targets.some((t) => t.kind === 'speed'))!;
    expect(star.when).toBe('while you have panache');
    expect(star.bonus).toBe('+10 status to your Speeds');
  });
});
