import { describe, expect, it } from 'vitest';
import { legacyEntries, overridesAsOf, readLegacyBlocks, readTweaks, tweaksPageOn } from '../src/rules/blocks/stored';
import type { BuildOverrides } from '../src/rules/types';

/**
 * The stored readers Tweaks part B adds (plan WP1): `legacyEntries` (where each old-key entry is stored,
 * keyed by the same walk as `readLegacyBlocks`), `overridesAsOf` (spec 9: the overrides as of a viewed
 * level), `tweaksPageOn` (B14) and the `imported` / `moved` flags (B11). Synthetic data only.
 */

const SAMPLE: BuildOverrides = {
  allowedFeats: ['risky-feat'],
  addedFeats: [
    { featId: 'fleet', level: 3, category: 'general' },
    { featId: 'fleet', level: 7, category: 'general' },
    { featId: 'fleet', level: 7, category: 'general' },
  ],
  addedFeatures: [{ featureId: 'some-feature', level: 1 }],
  removedFeatIds: ['old-feat'],
  attributes: { str: 18 },
  proficiencies: { stealth: 'expert', 'lore:Sailing Lore': 'trained', fortitude: 'master' },
  addedLanguages: ['draconic'],
  addedSpells: [{ spellId: 'light', rank: 1 }],
  maxHp: 64,
  contentEdits: { feats: { fleet: { name: 'Quick Feet' } }, classFeatures: { 'some-feature': { name: 'Mine' } } },
  meta: { 'proficiencies:stealth': { mode: 'atLeast', from: 5, of: 'expert' } },
};

describe('legacyEntries (plan B 5.2: never a key built by hand)', () => {
  it('legacyEntries keys entries exactly as readLegacyBlocks does', () => {
    const entries = legacyEntries(SAMPLE);
    const inst = readLegacyBlocks(SAMPLE);
    expect(entries.map((e) => e.key)).toEqual(inst.map((i) => i.key));
    expect(entries.map((e) => e.kind)).toEqual(inst.map((i) => i.kind));
    expect(entries.map((e) => [e.list, e.index])).toEqual([
      ['attributes', 'str'],
      ['proficiencies', 'stealth'],
      ['proficiencies', 'lore:Sailing Lore'],
      ['proficiencies', 'fortitude'],
      ['maxHp', 0],
      ['addedFeats', 0],
      ['addedFeats', 1],
      ['addedFeats', 2],
      ['addedFeatures', 0],
      ['addedLanguages', 0],
      ['addedSpells', 0],
      ['removedFeatIds', 0],
      ['allowedFeats', 0],
      ['contentEdits', 'feats/fleet'],
      ['contentEdits', 'classFeatures/some-feature'],
    ]);
    expect(entries.find((e) => e.key === 'addedFeats:fleet@7~2')).toMatchObject({ index: 2, of: 'fleet@7' });
    expect(entries.find((e) => e.key === 'proficiencies:lore:Sailing Lore')!.of).toBe('trained');
    expect(entries.find((e) => e.key === 'maxHp:max-hp')!.of).toBe('64');
    expect(legacyEntries(undefined)).toEqual([]);
  });
});

describe('readLegacyBlocks: imported and moved (B11)', () => {
  it('readLegacyBlocks marks imported and moved entries', () => {
    const ov: BuildOverrides = {
      addedFeats: [{ featId: 'fleet', level: 3, category: 'general' }],
      addedSpells: [{ spellId: 'consecrate', rank: 2 }],
      proficiencies: { stealth: 'expert' },
      meta: {
        'addedFeats:fleet@3': { source: 'import', of: 'fleet@3' },
        'addedSpells:consecrate@2': { source: 'import' }, // a meta with no `of` matches its entry
        'proficiencies:stealth': { mode: 'atLeast', moved: true, of: 'expert' },
      },
    };
    const byKey = new Map(readLegacyBlocks(ov).map((i) => [i.key, i]));
    expect(byKey.get('addedFeats:fleet@3')).toMatchObject({ imported: true });
    expect(byKey.get('addedFeats:fleet@3')!.moved).toBeUndefined();
    expect(byKey.get('addedSpells:consecrate@2')!.imported).toBe(true);
    expect(byKey.get('proficiencies:stealth')).toMatchObject({ kind: 'rank.atLeast', moved: true });
    expect(byKey.get('proficiencies:stealth')!.imported).toBeUndefined();
  });

  it('a stale meta (its of names another value) marks neither', () => {
    const ov: BuildOverrides = {
      addedFeats: [{ featId: 'fleet', level: 5, category: 'general' }],
      proficiencies: { stealth: 'master' },
      meta: { 'addedFeats:fleet@5': { source: 'import', of: 'fleet@3' }, 'proficiencies:stealth': { mode: 'atLeast', moved: true, of: 'expert' } },
    };
    for (const i of readLegacyBlocks(ov)) {
      expect(i.imported, i.key).toBeUndefined();
      expect(i.moved, i.key).toBeUndefined();
    }
  });
});

describe('overridesAsOf (spec 9: the overrides as of the viewed level)', () => {
  const LATE: BuildOverrides = {
    attributes: { str: 18 },
    proficiencies: { stealth: 'expert', athletics: 'trained' },
    addedFeats: [
      { featId: 'fleet', level: 1, category: 'general' },
      { featId: 'toughness', level: 8, category: 'general' },
      { featId: 'diehard', level: 2, category: 'general' },
    ],
    addedFeatures: [{ featureId: 'shield-block', level: 6 }],
    addedLanguages: ['elven'],
    blocks: [
      { id: 't1', kind: 'number.add', v: 1, target: 'ac', value: 1, from: 9 },
      { id: 't2', kind: 'number.add', v: 1, target: 'ac', value: 1 },
      { id: 't3', kind: 'strike.extraDamage', v: 1, target: 'attack', value: '1d6', from: 9 },
      { id: 't4', kind: 'number.add', v: 2, target: 'ac', value: 1, from: 9 },
    ],
    meta: {
      'proficiencies:stealth': { mode: 'atLeast', from: 5, reason: 'Guild', of: 'expert' },
      'addedFeats:diehard@2': { from: 6, of: 'diehard@2' },
      'addedLanguages:elven': { from: 4, of: 'elven' },
      'attributes:str': { from: 3, of: '17' }, // stale: it starts nothing
    },
  };

  it('overridesAsOf pauses everything that starts after the level and never mutates its input', () => {
    const before = JSON.stringify(LATE);
    const at3 = overridesAsOf(LATE, 3)!;
    expect(JSON.stringify(LATE)).toBe(before);
    expect(at3).not.toBe(LATE);
    const off = (ov: BuildOverrides) => readTweaks(ov).instances.filter((i) => !i.on).map((i) => i.key).sort();
    expect(off(at3)).toEqual(
      ['proficiencies:stealth', 'addedFeats:toughness@8', 'addedFeats:diehard@2', 'addedFeatures:shield-block@6', 'addedLanguages:elven', 'blocks:t1'].sort(),
    );
    // the paused copy keeps every other meta field, writes `of`, and touches no foreign block
    expect(at3.meta!['proficiencies:stealth']).toEqual({ mode: 'atLeast', from: 5, reason: 'Guild', of: 'expert', on: false });
    expect(at3.meta!['addedFeats:toughness@8']).toEqual({ of: 'toughness@8', on: false });
    expect(at3.meta!['attributes:str']).toBe(LATE.meta!['attributes:str']);
    expect((at3.blocks as unknown[])[2]).toBe((LATE.blocks as unknown[])[2]);
    expect((at3.blocks as unknown[])[3]).toBe((LATE.blocks as unknown[])[3]);
    expect((at3.blocks as unknown[])[1]).toBe((LATE.blocks as unknown[])[1]);
    expect('v' in at3).toBe(false);
    // level 6: the language (from 4) and the start-5 floor are live again; diehard (from 6) and the
    // class feature (level 6) are held; toughness (8) and t1 (9) still wait
    expect(off(overridesAsOf(LATE, 6)!)).toEqual(['addedFeats:toughness@8', 'blocks:t1']);
  });

  it('overridesAsOf returns the same object when nothing starts later', () => {
    expect(overridesAsOf(LATE, 9)).toBe(LATE);
    expect(overridesAsOf(LATE, 20)).toBe(LATE);
    expect(overridesAsOf(undefined, 3)).toBeUndefined();
    // an entry already paused needs no copy
    const paused: BuildOverrides = { addedLanguages: ['elven'], meta: { 'addedLanguages:elven': { from: 9, on: false, of: 'elven' } } };
    expect(overridesAsOf(paused, 1)).toBe(paused);
  });
});

describe('tweaksPageOn (B14)', () => {
  it('tweaksPageOn: no overrides → the option; v absent → on; v 2 → the option', () => {
    expect(tweaksPageOn({})).toBe(false);
    expect(tweaksPageOn({ options: { overridesEnabled: true } })).toBe(true);
    expect(tweaksPageOn({ options: { overridesEnabled: false } })).toBe(false);
    expect(tweaksPageOn({ overrides: { maxHp: 30 } })).toBe(true);
    expect(tweaksPageOn({ overrides: { maxHp: 30 }, options: { overridesEnabled: false } })).toBe(true); // an old hidden card reads ON
    expect(tweaksPageOn({ overrides: { maxHp: 30, v: 2 }, options: { overridesEnabled: false } })).toBe(false);
    expect(tweaksPageOn({ overrides: { maxHp: 30, v: 2 }, options: { overridesEnabled: true } })).toBe(true);
    expect(tweaksPageOn({ overrides: { maxHp: 30, v: 2 } })).toBe(false);
  });
});
