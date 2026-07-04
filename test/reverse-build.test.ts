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

describe('deriveBuildFromCharacter — spell-wipe root cause (non-standard caster entry id)', () => {
  it('a caster whose entry id is NOT `${class}-casting` keeps its spells across a rebuild', () => {
    const b: BuildState = {
      ...emptyBuild(),
      name: 'Imported Cleric',
      level: 5,
      classId: 'cleric',
      ancestryId: 'human',
      backgroundId: 'acolyte',
      keyAbility: 'wis',
      subclassId: firstSubclass('cleric'),
      deityId: 'sarenrae',
      divineFont: 'heal',
      ancestryBoosts: ['str', 'con'],
      backgroundBoosts: ['wis', 'int'],
      levelBoosts: ['wis', 'dex', 'con', 'cha'],
      cantrips: ['light', 'guidance', 'stabilize'],
      spells: { 1: ['heal', 'bless'], 2: ['heal'], 3: ['heal'] },
    };
    const ch0 = buildCharacter(b, C);
    // The canonical derive (id = `cleric-casting`) is the ground truth.
    const canonical = deriveBuildFromCharacter(ch0, C);
    expect(canonical.cantrips.length).toBeGreaterThan(0);
    expect(Object.keys(canonical.spells).length).toBeGreaterThan(0);

    // Simulate an imported character whose caster entry carries a different id (e.g. WG's own).
    const mangled: Character = {
      ...ch0,
      spellcasting: ch0.spellcasting.map((e) => (e.id === 'cleric-casting' ? { ...e, id: 'cleric-divine' } : e)),
    };
    // Before the fix, deriveBuildFromCharacter matched only `cleric-casting` and dropped everything.
    // The structural fallback must recover the SAME cantrips and spells.
    const derived = deriveBuildFromCharacter(mangled, C);
    expect(derived.cantrips.sort()).toEqual(canonical.cantrips.sort());
    expect(derived.spells).toEqual(canonical.spells);
    // And a full rebuild reproduces the spells (proving no silent wipe).
    const rebuilt = buildCharacter(derived, C);
    const casting = rebuilt.spellcasting.find((e) => e.id === 'cleric-casting');
    expect(casting?.cantrips.sort()).toEqual(canonical.cantrips.sort());
    // Every prepared spell id that was chosen survives the round-trip.
    const preparedIds = (e: Character['spellcasting'][number] | undefined) =>
      Object.values(e?.prepared ?? {}).flatMap((slots) => slots.map((s) => s.spellId).filter(Boolean)).sort();
    expect(preparedIds(casting)).toEqual(preparedIds(ch0.spellcasting.find((e) => e.id === 'cleric-casting')));
  });
});

describe('deriveBuildFromCharacter — Dual Class second caster spells', () => {
  it('a Bard × Wizard dual-class character keeps BOTH casters’ spells across a rebuild', () => {
    const b: BuildState = {
      ...emptyBuild(),
      name: 'Dual Caster',
      level: 5,
      classId: 'bard',
      ancestryId: 'human',
      backgroundId: 'acolyte',
      keyAbility: 'cha',
      subclassId: firstSubclass('bard'),
      variantRules: { dualClass: true },
      classId2: 'wizard',
      subclassId2: firstSubclass('wizard'),
      ancestryBoosts: ['con', 'int'],
      backgroundBoosts: ['str', 'dex'],
      levelBoosts: ['cha', 'int', 'con', 'wis'],
      // Primary (bard, spontaneous/occult) spells:
      cantrips: ['light', 'guidance'],
      spells: { 1: ['heal'], 2: ['heal'] },
      // Second class (wizard, prepared/arcane) spellbook:
      cantrips2: ['detect-magic'],
      spells2: { 1: ['grease'], 2: ['see-the-unseen'] },
    };
    const ch0 = buildCharacter(b, C);
    const bard0 = ch0.spellcasting.find((e) => e.id === 'bard-casting');
    const wiz0 = ch0.spellcasting.find((e) => e.id === 'wizard-casting');
    expect(bard0).toBeTruthy();
    expect(wiz0).toBeTruthy();
    // The wizard's spellbook must hold the chosen second-class spells.
    expect(wiz0?.spellbook?.[1]).toContain('grease');
    expect(wiz0?.spellbook?.[2]).toContain('see-the-unseen');
    expect(wiz0?.cantrips).toContain('detect-magic');

    // Round-trip: rebuild from the derived build and confirm the SECOND caster still has its spells.
    const rebuilt = roundTrip(ch0);
    const wiz1 = rebuilt.spellcasting.find((e) => e.id === 'wizard-casting');
    expect(wiz1?.spellbook?.[1], 'wizard spellbook wiped on rebuild').toContain('grease');
    expect(wiz1?.spellbook?.[2]).toContain('see-the-unseen');
    expect(wiz1?.cantrips).toContain('detect-magic');
    // The primary caster is preserved too.
    const bard1 = rebuilt.spellcasting.find((e) => e.id === 'bard-casting');
    expect(bard1?.cantrips.sort()).toContain('light');
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
