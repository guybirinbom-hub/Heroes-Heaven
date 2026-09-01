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

  it('the star no longer states the floor a second time', () => {
    /* Two carriers for one clause is the shape that makes a sheet contradict itself: a number in the
     * Speed and prose beside it claiming the same feet again. */
    const star = FEAT_SITUATIONAL['vivacious-speed']!.find((s) => s.targets.some((t) => t.kind === 'speed'))!;
    expect(star.when).toBe('while you have panache');
    expect(star.bonus).toMatch(/already in your Speed/i);
  });

  it("…and stylish combatant's own speed bonus stays a star, because it is NOT always on", () => {
    /* The sibling record is the control: +5 status WHILE YOU HAVE PANACHE, with no unconditional half,
     * so the owner's rule leaves it as prose. If this ever became a number the rule would have been
     * misread rather than applied. */
    expect(db.classFeatures['stylish-combatant']?.landSpeedBonus).toBeUndefined();
    const star = FEAT_SITUATIONAL['stylish-combatant']!.find((s) => s.targets.some((t) => t.kind === 'speed'))!;
    expect(star.when).toMatch(/while you have panache/i);
  });
});
