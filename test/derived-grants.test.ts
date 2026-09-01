import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { choiceOwnedFeatureIds, ownedFeatureIds } from '../src/rules/derive';

/**
 * "You gain the instinct ability for the instinct you chose for Barbarian Dedication."
 *
 * The answer was recorded when the DEDICATION was taken. The record naming the benefit and the record
 * holding the choice are different records, and nothing connected them — so a family of archetype
 * feats withheld the benefit of a pick already sitting in the build.
 *
 * Resolving it OWNS the class feature, so its defences, effect choices and situational stars all
 * apply with no further plumbing.
 */
const db = content();

describe('dereferencing a pick recorded on another feat', () => {
  it('Instinct Ability grants the instinct the dedication recorded', () => {
    const instinct = db.feats['barbarian-dedication'].choice!.options![0].value;
    const owned = choiceOwnedFeatureIds(
      [{ featId: 'barbarian-dedication', choice: { value: instinct } }, { featId: 'instinct-ability' }],
      db,
    );
    expect(owned).toContain(instinct);
  });

  it("Implement Initiate builds its target from the implement's name", () => {
    const impl = db.feats['thaumaturge-dedication'].choice!.options![0].value; // 'amulet'
    const owned = choiceOwnedFeatureIds(
      [{ featId: 'thaumaturge-dedication', choice: { value: impl } }, { featId: 'implement-initiate' }],
      db,
    );
    expect(owned).toContain(`initiate-benefit-${impl}`);
  });

  it('it follows the pick — a different answer grants a different feature', () => {
    const [first, second] = db.feats['thaumaturge-dedication'].choice!.options!;
    const of = (v: string) =>
      choiceOwnedFeatureIds([{ featId: 'thaumaturge-dedication', choice: { value: v } }, { featId: 'implement-initiate' }], db);
    expect(of(first.value)).toContain(`initiate-benefit-${first.value}`);
    expect(of(second.value)).not.toContain(`initiate-benefit-${first.value}`);
  });

  it('without the dedication it grants NOTHING — no default pick', () => {
    expect(choiceOwnedFeatureIds([{ featId: 'implement-initiate' }], db)).toEqual([]);
    expect(choiceOwnedFeatureIds([{ featId: 'instinct-ability' }], db)).toEqual([]);
  });

  it('an unanswered choice grants nothing either', () => {
    const owned = choiceOwnedFeatureIds(
      [{ featId: 'thaumaturge-dedication' }, { featId: 'implement-initiate' }],
      db,
    );
    expect(owned).toEqual([]);
  });

  it('every derivedGrant in the data can actually resolve for some answer', () => {
    const bad: string[] = [];
    for (const [id, f] of Object.entries(db.feats)) {
      const d = f.derivedGrant;
      if (!d) continue;
      const src = db.feats[d.fromFeat];
      if (!src) { bad.push(`${id}: fromFeat ${d.fromFeat} is not a feat`); continue; }
      const options = src.choice?.options ?? [];
      if (!options.length) { bad.push(`${id}: ${d.fromFeat} has no choice to dereference`); continue; }
      // A NAMED relation (`map`) is not built FROM the answer, so the derived spelling checks an id
      // the reader will never build — and for the gunslinger ways it checks one that HAPPENS to
      // exist (`way-of-the-drifter` is both a way and a classFeatures record), so this guard would
      // pass over a map with every key misspelt.
      const idOf = (v: string) => {
        const bare = v.replace(/^aon-/, '');
        return d.map ? (d.map[bare] ?? '') : `${d.prefix ?? ''}${bare}${d.suffix ?? ''}`;
      };
      const hits = options.filter((o) => db.classFeatures[idOf(o.value)]);
      if (!hits.length) bad.push(`${id}: no option of ${d.fromFeat} resolves to a class feature`);
    }
    expect(bad).toEqual([]);
  });

  it("Slinger's Readiness grants the initial deed of the way the dedication recorded", () => {
    for (const [way, deed] of [
      ['way-of-the-drifter', 'into-the-fray'],
      ['way-of-the-pistolero', 'ten-paces'],
      ['way-of-the-sniper', 'one-shot-one-kill'],
      ['way-of-the-spellshot', 'energy-shot'],
      ['way-of-the-triggerbrand', 'spring-the-trap'],
      ['way-of-the-vanguard', 'living-fortification'],
    ] as const) {
      const owned = choiceOwnedFeatureIds(
        [{ featId: 'gunslinger-dedication', choice: { value: way } }, { featId: 'slingers-readiness' }],
        db,
      );
      expect(owned, `${way} should hand over ${deed}`).toContain(deed);
    }
    expect(choiceOwnedFeatureIds([{ featId: 'slingers-readiness' }], db)).toEqual([]);
  });

  it('a real barbarian-dedication character owns the instinct through the build', () => {
    const instinct = db.feats['barbarian-dedication'].choice!.options![0].value;
    const ch = build('fighter', 6, {
      featPicks: { '2:class': 'barbarian-dedication', '6:class': 'instinct-ability' },
      featChoices: { '2:class': instinct },
    });
    expect(ownedFeatureIds(ch, db).has(instinct)).toBe(true);
  });
});
