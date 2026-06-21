import { describe, it, expect } from 'vitest';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { kyra } from '../src/rules/seed';
import type { Character } from '../src/rules/types';
import { content, firstSubclass } from './_content';

const C = content();
const roundTrip = (ch: Character): Character => buildCharacter(deriveBuildFromCharacter(ch, C), C);

/** Compare the structural (build-derived) parts of two characters; partialBoosts as a set. */
function expectSameBuild(a: Character, b: Character) {
  expect(b.abilities).toEqual(a.abilities);
  expect([...b.partialBoosts ?? []].sort()).toEqual([...a.partialBoosts ?? []].sort());
  expect(b.proficiencies).toEqual(a.proficiencies);
  expect(b.feats.map((f) => f.featId).sort()).toEqual(a.feats.map((f) => f.featId).sort());
  expect([...b.languages].sort()).toEqual([...a.languages].sort());
  expect(b.hitPoints.current).toEqual(a.hitPoints.current);
  expect(b.skillIncreases ?? []).toEqual(a.skillIncreases ?? []);
  // spellcasting: compare per-entry cantrips + prepared/repertoire/spellbook ids
  const sig = (ch: Character) =>
    ch.spellcasting.map((e) => ({
      id: e.id,
      cantrips: [...e.cantrips].sort(),
      prepared: Object.fromEntries(Object.entries(e.prepared ?? {}).map(([r, s]) => [r, s.map((x) => x.spellId)])),
      repertoire: Object.fromEntries(Object.entries(e.repertoire ?? {}).map(([r, ids]) => [r, [...ids].sort()])),
      spellbook: Object.fromEntries(Object.entries(e.spellbook ?? {}).map(([r, ids]) => [r, [...ids].sort()])),
      font: e.font?.type,
    }));
  expect(sig(b)).toEqual(sig(a));
}

describe('deriveBuildFromCharacter — ability-score reversal', () => {
  it('reproduces final scores + partial boosts across many score patterns', () => {
    const patterns: BuildState['ancestryBoosts'][] = [
      ['str', 'con'],
      ['wis', 'dex'],
      ['cha', 'int'],
    ];
    for (const ab of patterns) {
      for (const level of [1, 5, 10, 15, 20]) {
        const b: BuildState = {
          ...emptyBuild(),
          name: 'AB',
          level,
          classId: 'fighter',
          ancestryId: 'human',
          backgroundId: 'acolyte',
          keyAbility: 'str',
          subclassId: firstSubclass('fighter'),
          ancestryBoosts: ab,
          backgroundBoosts: [],
          levelBoosts: ['str', 'dex', 'con', 'wis'],
          attributeBoosts: { 5: ['str', 'dex', 'con', 'wis'], 10: ['str', 'dex', 'con', 'cha'], 15: ['str', 'con', 'wis', 'int'], 20: ['str', 'dex', 'con', 'wis'] },
        };
        const ch0 = buildCharacter(b, C);
        const ch1 = roundTrip(ch0);
        expect(ch1.abilities, `${ab}@${level}`).toEqual(ch0.abilities);
        expect([...ch1.partialBoosts ?? []].sort(), `partial ${ab}@${level}`).toEqual([...ch0.partialBoosts ?? []].sort());
      }
    }
  });
});

describe('deriveBuildFromCharacter — full structural round-trip', () => {
  it('a rich prepared caster (cleric L5 with spells, font, skills, feats) round-trips', () => {
    const b: BuildState = {
      ...emptyBuild(),
      name: 'Rich Cleric',
      level: 5,
      classId: 'cleric',
      ancestryId: 'human',
      heritageId: 'skilled-human',
      backgroundId: 'acolyte',
      keyAbility: 'wis',
      subclassId: firstSubclass('cleric'),
      deityId: 'sarenrae',
      divineFont: 'heal',
      ancestryBoosts: ['str', 'con'],
      backgroundBoosts: ['wis', 'int'],
      levelBoosts: ['wis', 'dex', 'con', 'cha'],
      attributeBoosts: { 5: ['wis', 'str', 'con', 'dex'] },
      heritageSkill: 'medicine',
      classSkills: ['diplomacy', 'nature', 'society'],
      languages: ['draconic'],
      featPicks: { '1:class:1': 'healing-hands', '2:class:1': 'communal-healing', '2:skill:2': 'battle-medicine' },
      cantrips: ['light', 'guidance', 'stabilize'],
      spells: { 1: ['heal', 'bless'], 2: ['heal'], 3: ['heal'] },
    };
    const ch0 = buildCharacter(b, C);
    expectSameBuild(ch0, roundTrip(ch0));
  });

  it('round-trips a minimal build for a spread of classes and levels', () => {
    const cases: [string, number][] = [
      ['fighter', 1], ['fighter', 12], ['cleric', 5], ['wizard', 7], ['rogue', 3],
      ['ranger', 9], ['barbarian', 5], ['bard', 6], ['champion', 4], ['monk', 8],
    ];
    for (const [classId, level] of cases) {
      const cls = C.classes[classId];
      if (!cls) continue;
      const b: BuildState = {
        ...emptyBuild(),
        name: 't',
        level,
        classId,
        ancestryId: 'human',
        backgroundId: 'acolyte',
        keyAbility: cls.keyAbility.length === 1 ? cls.keyAbility[0] : null,
        subclassId: firstSubclass(classId),
        ancestryBoosts: ['con', 'wis'],
        backgroundBoosts: ['str', 'int'],
        levelBoosts: ['str', 'dex', 'con', 'cha'],
      };
      const ch0 = buildCharacter(b, C);
      expectSameBuild(ch0, roundTrip(ch0));
    }
  });
});

describe('deriveBuildFromCharacter — the hand-authored seed (Kyra)', () => {
  it('reopening Kyra reproduces her abilities, identity, feats, and languages', () => {
    const reb = roundTrip(kyra);
    expect(reb.abilities).toEqual(kyra.abilities);
    expect([...reb.partialBoosts ?? []].sort()).toEqual([...kyra.partialBoosts ?? []].sort());
    expect(reb.level).toBe(5);
    expect(reb.ancestryId).toBe('human');
    expect(reb.heritageId).toBe('skilled-human');
    expect(reb.classId).toBe('cleric');
    expect(reb.subclassId).toBe(kyra.subclassId);
    expect(reb.details.deityId).toBe('sarenrae');
    expect(reb.feats.map((f) => f.featId).sort()).toEqual(kyra.feats.map((f) => f.featId).sort());
    // Kyra is hand-authored with more languages than her Int budgets, so the rules-based rebuild
    // may clamp a bonus language; assert no spurious languages appear (recovered ⊆ original).
    expect(kyra.languages).toEqual(expect.arrayContaining(reb.languages));
    expect(reb.languages).toContain('common');
  });
});
