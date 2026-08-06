import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { activeCasterArchetype, archetypeProficiency, archetypeSlots } from '../src/rules/casterArchetypes';

/**
 * The captivator is the archetype that looks most like a slot caster and is not one. Every one of its
 * spellcasting feats ends "You Cast these Spells as occult innate spells", and its ladder runs two
 * levels ahead of the standard one from Expert onward — it is the only archetype that reaches rank 9.
 */
const db = content();

/** A real occult spell of each rank, so the repertoire assertions aren't comparing invented ids. */
const occultAt = (rank: number) =>
  Object.entries(db.spells).find(([, s]) => s.rank === rank && !s.ritual && (s.traditions ?? []).includes('occult'))?.[0] as string;

const SPELLS: Record<number, string[]> = {};
for (let r = 1; r <= 9; r++) SPELLS[r] = [occultAt(r)];
const CANTRIPS = Object.entries(db.spells)
  .filter(([, s]) => s.rank === 0 && (s.traditions ?? []).includes('occult'))
  .slice(0, 2)
  .map(([id]) => id);

const LADDER = {
  '4:class:0': 'captivator-dedication',
  '6:class:0': 'basic-captivator-spellcasting',
  '10:class:0': 'expert-captivator-spellcasting',
  '16:class:0': 'master-captivator-spellcasting',
};

describe('captivator archetype — innate, not slots', () => {
  it('the fixtures are real spells (a missing id would make every assertion below vacuous)', () => {
    expect(CANTRIPS).toHaveLength(2);
    for (let r = 1; r <= 9; r++) expect(typeof SPELLS[r][0], `rank ${r}`).toBe('string');
  });

  it('the dedication grants two occult cantrips cast as innate spells', () => {
    const ch = build('fighter', 4, { featPicks: { '4:class:0': 'captivator-dedication' }, cantrips: CANTRIPS });
    const e = ch.spellcasting.find((s) => s.id === 'captivator-dedication-casting');
    expect(e?.type).toBe('innate');
    expect(e?.tradition).toBe('occult');
    expect(e?.keyAbility).toBe('cha');
    expect(e?.cantrips).toEqual(CANTRIPS);
    // The thing this whole change is about: no slots, ever.
    expect(e?.slots ?? {}).toEqual({});
    expect(e?.prepared ?? {}).toEqual({});
  });

  it('the ranks arrive on the captivator schedule, not the standard one', () => {
    const ranksAt = (level: number, feats: string[]) =>
      Object.keys(archetypeSlots(level, activeCasterArchetype(['captivator-dedication', ...feats])!))
        .map(Number)
        .sort((a, b) => a - b);
    // Basic: 1st@4, 2nd@6, 3rd@8.
    expect(ranksAt(4, ['basic-captivator-spellcasting'])).toEqual([1]);
    expect(ranksAt(6, ['basic-captivator-spellcasting'])).toEqual([1, 2]);
    expect(ranksAt(9, ['basic-captivator-spellcasting'])).toEqual([1, 2, 3]);
    // Expert: 4th@10, 5th@12, 6th@14 — two levels EARLIER than the standard ladder each time.
    expect(ranksAt(14, ['basic-captivator-spellcasting', 'expert-captivator-spellcasting'])).toEqual([1, 2, 3, 4, 5, 6]);
    // Master: 7th@16, 8th@18, 9th@20. No other archetype reaches 9.
    const all = ['basic-captivator-spellcasting', 'expert-captivator-spellcasting', 'master-captivator-spellcasting'];
    expect(ranksAt(18, all)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(ranksAt(20, all)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('proficiency advances on the captivator feats (customUnlocks would otherwise pin it at trained)', () => {
    expect(archetypeProficiency(activeCasterArchetype(['captivator-dedication'])!)).toBe('trained');
    expect(archetypeProficiency(activeCasterArchetype(['captivator-dedication', 'expert-captivator-spellcasting'])!)).toBe('expert');
    expect(archetypeProficiency(activeCasterArchetype(['captivator-dedication', 'master-captivator-spellcasting'])!)).toBe('master');
  });

  it('a level-20 captivator knows one innate spell of every rank through 9', () => {
    const ch = build('fighter', 20, { featPicks: LADDER, cantrips: CANTRIPS, spells: SPELLS });
    const e = ch.spellcasting.find((s) => s.id === 'captivator-dedication-casting');
    expect(e?.type).toBe('innate');
    expect(e?.proficiency).toBe('master');
    expect(e?.slots ?? {}).toEqual({});
    for (let r = 1; r <= 9; r++) expect(e?.repertoire?.[r], `rank ${r}`).toEqual([SPELLS[r][0]]);
  });

  it('Captivating Intensity adds a daily casting below the two highest ranks, and nowhere else', () => {
    const ch = build('fighter', 20, {
      featPicks: { ...LADDER, '18:class:0': 'captivating-intensity' },
      cantrips: CANTRIPS,
      spells: SPELLS,
    });
    const e = ch.spellcasting.find((s) => s.id === 'captivator-dedication-casting');
    expect(e?.innateUses).toBeTruthy();
    // Ranks 1–7 go to 2/day; the top two ranks (8 and 9) are explicitly excluded by the feat.
    for (let r = 1; r <= 7; r++) expect(e?.innateUses?.[SPELLS[r][0]], `rank ${r}`).toBe(2);
    for (const r of [8, 9]) expect(e?.innateUses?.[SPELLS[r][0]], `rank ${r}`).toBeUndefined();
    // Without the feat nothing is bumped at all.
    const plain = build('fighter', 20, { featPicks: LADDER, cantrips: CANTRIPS, spells: SPELLS });
    expect(plain.spellcasting.find((s) => s.id === 'captivator-dedication-casting')?.innateUses).toBeUndefined();
  });

  it('“two highest ranks” follows the character, not the level-20 table', () => {
    // At 9 the captivator knows ranks 1–3, so only rank 1 gets the extra casting.
    const ch = build('fighter', 9, {
      featPicks: { '4:class:0': 'captivator-dedication', '6:class:0': 'basic-captivator-spellcasting', '8:class:0': 'captivating-intensity' },
      cantrips: CANTRIPS,
      spells: SPELLS,
    });
    const e = ch.spellcasting.find((s) => s.id === 'captivator-dedication-casting');
    expect(Object.keys(e?.repertoire ?? {}).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(e?.innateUses).toEqual({ [SPELLS[1][0]]: 2 });
  });
});
