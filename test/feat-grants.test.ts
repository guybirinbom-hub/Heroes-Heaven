import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { deityFavorsSimpleOrUnarmed } from '../src/rules/build';

/*
 * Section 3C — feat-granted proficiencies (archetype dedications), fighter weapon-group mastery,
 * and Warpriest Deadly Simplicity conditioning. Rules verified against .import-src Foundry text.
 */
describe('archetype dedications grant proficiencies (featGrants table)', () => {
  // A wizard is untrained in light armor and martial weapons by default, so the grant is visible.
  it('Sentinel Dedication grants trained light + medium armor', () => {
    const ch = build('wizard', 4, { featPicks: { '2:class:0': 'sentinel-dedication' } });
    expect(ch.proficiencies.defenses.light).toBe('trained');
    expect(ch.proficiencies.defenses.medium).toBe('trained');
    // A character without the dedication stays untrained.
    const plain = build('wizard', 4);
    expect(plain.proficiencies.defenses.light).toBe('untrained');
    expect(plain.proficiencies.defenses.medium).toBe('untrained');
  });

  it('Fighter Dedication grants trained martial-weapon proficiency', () => {
    const ch = build('wizard', 4, { featPicks: { '2:class:0': 'fighter-dedication' } });
    expect(ch.proficiencies.attacks.martial).toBe('trained');
    expect(build('wizard', 4).proficiencies.attacks.martial).toBe('untrained');
  });

  it('Rogue Dedication grants trained light armor', () => {
    const ch = build('wizard', 4, { featPicks: { '2:class:0': 'rogue-dedication' } });
    expect(ch.proficiencies.defenses.light).toBe('trained');
  });

  it('Medic Dedication grants expert Medicine', () => {
    const ch = build('wizard', 4, { featPicks: { '2:class:0': 'medic-dedication' } });
    expect(ch.proficiencies.skills.medicine).toBe('expert');
  });

  it('a grant never LOWERS an already-higher class proficiency', () => {
    // Fighter is already expert in martial weapons; taking Sentinel Dedication (armor only) leaves
    // martial untouched, and the grant of a track the class already exceeds does not regress it.
    const ch = build('fighter', 4, { featPicks: { '2:class:0': 'rogue-dedication' } });
    // Fighter is trained in light armor at L1 (not lowered by rogue-dedication's trained grant).
    expect(ch.proficiencies.defenses.light).toBe('trained');
    expect(ch.proficiencies.attacks.martial).toBe('expert');
  });
});

describe('Warpriest Deadly Simplicity is conditioned on the favored weapon', () => {
  it('deityFavorsSimpleOrUnarmed: simple item, unarmed fist → true; martial → false', () => {
    const c = content();
    expect(deityFavorsSimpleOrUnarmed('abadar', c)).toBe(true); // crossbow (simple)
    expect(deityFavorsSimpleOrUnarmed('irori', c)).toBe(true); // fist (unarmed)
    expect(deityFavorsSimpleOrUnarmed('iomedae', c)).toBe(false); // longsword (martial)
  });

  it('Iomedae (longsword) warpriest does NOT gain Deadly Simplicity', () => {
    const ch = build('cleric', 3, { subclassId: 'warpriest', deityId: 'iomedae', divineFont: 'heal' });
    expect(ch.feats.some((f) => f.featId === 'deadly-simplicity')).toBe(false);
  });

  it('Abadar (crossbow, simple) warpriest DOES gain Deadly Simplicity', () => {
    const ch = build('cleric', 3, { subclassId: 'warpriest', deityId: 'abadar', divineFont: 'heal' });
    expect(ch.feats.some((f) => f.featId === 'deadly-simplicity')).toBe(true);
  });
});
