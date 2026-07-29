import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { ownedFeatureIds, deriveDefenses } from '../src/rules/derive';
import { buildCharacter, emptyBuild } from '../src/rules/build';
import type { BuildState } from '../src/rules/build';

const c = content();

/**
 * SUBCLASS VARIANTS OF A LISTED FEATURE.
 *
 * A class lists the generic prose record (`field-discovery`) in cls.features; the mechanics live in
 * `field-discovery-<subclass>`, which nothing referenced. `critSpecSources` already resolved that
 * suffix for its own purpose, so the convention was real but only half-wired — a toxicologist
 * alchemist never got the poison resistance their research field is supposed to grant.
 */

const build = (over: Partial<BuildState>): BuildState => ({ ...emptyBuild(), ...over });

describe('subclass feature variants are owned', () => {
  it('a toxicologist owns field-discovery-toxicologist from level 5', () => {
    const at = (level: number) =>
      ownedFeatureIds(buildCharacter(build({ classId: 'alchemist', subclassId: 'toxicologist', level }), c), c);
    expect(at(4).has('field-discovery-toxicologist')).toBe(false); // the class gains it at 5
    expect(at(5).has('field-discovery-toxicologist')).toBe(true);
  });

  it('and actually gains the poison resistance it grants', () => {
    const ch = buildCharacter(build({ classId: 'alchemist', subclassId: 'toxicologist', level: 8 }), c);
    const poison = deriveDefenses(ch, c).resistances.find((r) => r.type === 'poison');
    expect(poison, 'toxicologist has no poison resistance').toBeTruthy();
    expect(poison!.value).toBe(4); // half of level 8
  });

  it('a bomber does NOT get the toxicologist variant', () => {
    const ch = buildCharacter(build({ classId: 'alchemist', subclassId: 'bomber', level: 8 }), c);
    expect(ownedFeatureIds(ch, c).has('field-discovery-toxicologist')).toBe(false);
    expect(deriveDefenses(ch, c).resistances.some((r) => r.type === 'poison')).toBe(false);
  });

  it('a variant of a feature the class has NOT reached yet stays unowned', () => {
    // The gate is the generic feature's level, so a subclass can't hand you a level-13 benefit at 1.
    const ch = buildCharacter(build({ classId: 'alchemist', subclassId: 'toxicologist', level: 1 }), c);
    for (const id of ownedFeatureIds(ch, c)) expect(c.classFeatures[id]?.level ?? 1).toBeLessThanOrEqual(1);
  });

  it('warpriest Shield Block is granted ONCE, not twice', () => {
    // The subclass option grants shield-block AND first-doctrine-warpriest.grantsFeats names it.
    // Owning the variant must not produce a duplicate feat row.
    const ch = buildCharacter(build({ classId: 'cleric', subclassId: 'warpriest', level: 3, deityId: 'gorum' }), c);
    expect(ch.feats.filter((f) => f.featId === 'shield-block').length).toBeLessThanOrEqual(1);
  });
});
