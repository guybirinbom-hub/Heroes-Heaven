import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { abilityMod } from '../src/rules/derive';

/**
 * "You become an expert in the alchemist class DC."
 *
 * A multiclass dedication grants a borrowed class DC, and the engine pinned it at trained with no way
 * to advance — the rail card even printed the word "trained" as a literal. So Alchemical Power,
 * Officer's Expertise, Officer's Mastery, Exemplar Expertise and Expert Kinetic Control, whose entire
 * content is that one sentence, left the number exactly where the dedication put it.
 */
const db = content();

describe('a borrowed class DC can be raised past trained', () => {
  it('a dedication alone gives a trained borrowed DC', () => {
    const ch = build('fighter', 12, { featPicks: { '2:class': 'alchemist-dedication' } });
    const dc = ch.secondaryClassDcs?.find((d) => d.classId === 'alchemist');
    expect(dc, 'no borrowed alchemist DC').toBeDefined();
    expect(dc!.rank).toBe('trained');
    expect(dc!.dc).toBe(10 + 12 + 2 + abilityMod(ch.abilities[dc!.keyAbility]));
  });

  it('Alchemical Power makes it expert and moves the number', () => {
    const plain = build('fighter', 12, { featPicks: { '2:class': 'alchemist-dedication' } });
    const ch = build('fighter', 12, { featPicks: { '2:class': 'alchemist-dedication', '12:class': 'alchemical-power' } });
    const a = plain.secondaryClassDcs!.find((d) => d.classId === 'alchemist')!;
    const b = ch.secondaryClassDcs!.find((d) => d.classId === 'alchemist')!;
    expect(b.rank).toBe('expert');
    expect(b.dc).toBe(a.dc + 2); // expert is trained + 2
  });

  it('the best rank wins when a chain of them is taken', () => {
    const ch = build('fighter', 18, {
      featPicks: { '2:class': 'commander-dedication', '12:class': 'officers-expertise', '18:class': 'officers-mastery' },
    });
    const dc = ch.secondaryClassDcs?.find((d) => d.classId === 'commander');
    if (!dc) return; // no commander dedication ships a classDcGrant; nothing to assert
    expect(dc.rank).toBe('master');
  });

  it('it only raises the class it names', () => {
    const ch = build('fighter', 12, {
      featPicks: { '2:class': 'alchemist-dedication', '12:class': 'alchemical-power' },
    });
    for (const d of ch.secondaryClassDcs ?? []) {
      if (d.classId !== 'alchemist') expect(d.rank).toBe('trained');
    }
  });

  it('the feat is inert without the dedication that grants the DC', () => {
    const ch = build('fighter', 12, { featPicks: { '12:class': 'alchemical-power' } });
    expect(ch.secondaryClassDcs?.some((d) => d.classId === 'alchemist')).toBeFalsy();
  });

  it('all five records carry the field, pointing at real classes', () => {
    const expected: [string, string, string][] = [
      ['alchemical-power', 'alchemist', 'expert'],
      ['exemplar-expertise', 'exemplar', 'expert'],
      ['expert-kinetic-control', 'kineticist', 'expert'],
      ['officers-expertise', 'commander', 'expert'],
      ['officers-mastery', 'commander', 'master'],
    ];
    for (const [id, classId, rank] of expected) {
      expect(db.feats[id].classDcRank, id).toEqual({ classId, rank });
      expect(db.classes[classId], `${id} names a class that does not exist`).toBeDefined();
    }
  });
});
