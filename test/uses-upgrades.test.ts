import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { featUse, featUses, effectiveUses, usesLabel, resetEncounterUses, isSubDaily } from '../src/rules/featUses';
import { normalizeCharacter } from '../src/rules/normalize';
import type { Character } from '../src/rules/types';

const c = content();
const withFeats = (ids: string[], featUsesMap?: Record<string, number>): Character =>
  normalizeCharacter({
    id: 'u', name: 'U', level: 9, classId: 'fighter', keyAbility: 'str', ancestryId: 'human',
    abilities: { str: 18, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
    feats: ids.map((featId) => ({ featId })),
    featUses: featUsesMap,
  });

/**
 * FEATS THAT RETUNE ANOTHER FEAT'S LIMIT.
 *
 * "You can use Cat's Luck once per hour, rather than once per day" is a second feat rewriting the
 * first one's frequency. Eighteen records read that way and carried no field at all, so they did
 * nothing — and a `limitedUses` of their own would have been worse, showing a second pool beside the
 * one they were meant to replace.
 */
describe('uses upgrades', () => {
  it("Cat's Luck is once per day on its own", () => {
    const use = featUse(withFeats(['cats-luck']), c.feats['cats-luck'], c)!;
    expect(use.max).toBe(1);
    expect(use.per).toBe('day');
    expect(use.upgradedBy).toBeUndefined();
  });

  it('Reliable Luck makes it once per hour, and says so', () => {
    const use = featUse(withFeats(['cats-luck', 'reliable-luck']), c.feats['cats-luck'], c)!;
    expect(use.per).toBe('hour');
    expect(use.upgradedBy).toBe(c.feats['reliable-luck'].name);
  });

  it('the upgrade only fires for a character who HAS it', () => {
    expect(featUse(withFeats(['cats-luck', 'fleet']), c.feats['cats-luck'], c)!.per).toBe('day');
  });

  it('the upgrade feat does not add a pool of its own', () => {
    // The whole point: Reliable Luck must not appear as a second tracked ability.
    const uses = featUses(withFeats(['cats-luck', 'reliable-luck']), c);
    expect(uses.map((u) => u.featId)).toEqual(['cats-luck']);
  });

  it('"three times per day" changes the COUNT, not the period', () => {
    const use = featUse(withFeats(['among-humanity', 'forever-among-humanity']), c.feats['among-humanity'], c)!;
    expect([use.max, use.per]).toEqual([3, 'day']);
  });

  it('"at all times" removes the limit rather than zeroing it', () => {
    expect(featUse(withFeats(['divine-wings', 'eternal-wings']), c.feats['divine-wings'], c)).toBeNull();
    expect(featUse(withFeats(['divine-wings']), c.feats['divine-wings'], c)).not.toBeNull();
  });

  it('"once per 10 minutes" is a period the label can state', () => {
    const use = featUse(withFeats(['cats-luck', 'invoke-the-elements', 'stormy-heart']), c.feats['invoke-the-elements'], c)!;
    expect([use.max, use.per, use.every]).toEqual([1, 'minute', 10]);
    expect(usesLabel(use)).toBe('1/10 minutes');
    expect(usesLabel({ max: 1, per: 'day' })).toBe('1/day');
  });

  it('an upgraded feat becomes sub-daily, so a new encounter refills it', () => {
    const ch = withFeats(['cats-luck', 'reliable-luck'], { 'cats-luck': 1 });
    expect(isSubDaily(effectiveUses(ch, c.feats['cats-luck'], c)?.per)).toBe(true);
    expect(resetEncounterUses(ch.featUses, c.feats, { character: ch, content: c })['cats-luck']).toBeUndefined();
    // Without the upgrade it is a DAILY power and must survive the encounter reset.
    const plain = withFeats(['cats-luck'], { 'cats-luck': 1 });
    expect(resetEncounterUses(plain.featUses, c.feats, { character: plain, content: c })['cats-luck']).toBe(1);
  });

  it('every shipped upgrade points at a feat that has something to retune', () => {
    // A no-op upgrade is invisible: it looks wired and changes nothing.
    const bad: string[] = [];
    for (const [id, f] of Object.entries(c.feats)) {
      const up = f.usesUpgrade;
      if (!up) continue;
      const target = c.feats[up.featId];
      if (!target) bad.push(`${id} -> ${up.featId} (not a feat)`);
      else if (!target.limitedUses) bad.push(`${id} -> ${up.featId} (no limitedUses)`);
    }
    expect(bad).toEqual([]);
  });

  it('no feat both retunes another and carries a limit of its own', () => {
    // That would render two pools for one ability.
    const both = Object.entries(c.feats).filter(([, f]) => f.usesUpgrade && f.limitedUses).map(([id]) => id);
    expect(both).toEqual([]);
  });
});

/**
 * A count that GROWS with level. Only Fulu Familiar prints one ("once per day; at 12th twice, at
 * 18th three times"), but a flat max would be a rules error from level 12 on — cheaper to model than
 * to document as wrong.
 */
describe('level-scaling use counts', () => {
  const at = (level: number) =>
    featUse(
      normalizeCharacter({
        id: 'f', name: 'F', level, classId: 'witch', keyAbility: 'int',
        abilities: { str: 10, dex: 12, con: 12, int: 18, wis: 12, cha: 10 },
        feats: [{ featId: 'fulu-familiar' }],
      }),
      c.feats['fulu-familiar'],
      c,
    )!.max;

  it('steps at 12th and 18th, not before', () => {
    expect([at(4), at(11), at(12), at(17), at(18), at(20)]).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it('a flat limit is unaffected by level', () => {
    const flat = (level: number) =>
      featUse(
        normalizeCharacter({
          id: 'g', name: 'G', level, classId: 'fighter', keyAbility: 'str',
          abilities: { str: 18, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
          feats: [{ featId: 'ghost-strike' }],
        }),
        c.feats['ghost-strike'],
        c,
      )!.max;
    expect([flat(1), flat(20)]).toEqual([1, 1]);
  });
});
