import { describe, it, expect } from 'vitest';
import { build, content, firstSubclass, prof } from './_content';
import { buildChoiceOptions, emptyBuild } from '../src/rules/build';
import { ownedFeatureIds } from '../src/rules/derive';
import { deriveEidolon } from '../src/rules/companions';
import type { Character, CompanionConfig } from '../src/rules/types';

/*
 * Two pickers whose ANSWER reached nothing at all.
 *
 * Both were found the same way: the record carries a question, the builder renders it, the player
 * answers it, and no derived value anywhere is a function of that answer. A stored answer with no
 * consumer is indistinguishable from a working feat until you go looking, which is why each test
 * below asserts the OUTCOME (a Strike on the block, a feature the character owns) rather than the
 * presence of a field.
 */

const db = content();

/* ───────────────────────────── Ranged Combatant ───────────────────────────── */

const subclassId = firstSubclass('summoner');
const summoner = (level: number, answer?: string): Character =>
  build('summoner', level, {
    subclassId,
    featPicks: { '2:class:0': 'ranged-combatant' },
    ...(answer ? { featChoices: { '2:class:0': answer } } : {}),
  });
const eidolon = (ch: Character, over: Record<string, unknown> = {}) =>
  deriveEidolon({ id: 'e', kind: 'eidolon', name: '', typeId: subclassId, ...over } as CompanionConfig, ch, db);
const ranged = (ch: Character, over: Record<string, unknown> = {}) =>
  eidolon(ch, over).attacks.find((a) => a.range != null);

describe('Ranged Combatant — the damage type the player picked is the attack’s damage', () => {
  it('the eidolon gains the ranged unarmed attack, and has none without the feat', () => {
    // Measured before the lane existed: an eidolon's block was always exactly the two natural
    // Strikes, whatever evolution feats the summoner had.
    const without = build('summoner', 6, { subclassId });
    expect(eidolon(without).attacks.map((a) => a.name)).toEqual(['Primary', 'Secondary']);
    const a = ranged(summoner(6, 'fire'));
    expect(a, 'no ranged Strike on the block').toBeTruthy();
    expect(a!.range).toBe(30);
    expect(a!.name).toBe('Ranged Combatant');
    // "…has the magical and propulsive traits" — plus the unarmed trait every eidolon Strike carries,
    // and NOT a `range-increment-30` pseudo-trait, which would print the range twice on the row.
    expect(a!.traits.sort()).toEqual(['magical', 'propulsive', 'unarmed']);
  });

  it('the chosen type IS the damage type — a different answer, a different attack', () => {
    expect(ranged(summoner(6, 'fire'))!.damage).toContain('fire');
    expect(ranged(summoner(6, 'acid'))!.damage).toContain('acid');
    expect(ranged(summoner(6, 'fire'))!.damage).not.toContain('slashing');
  });

  it('an unanswered pick says so rather than defaulting to a type nobody chose', () => {
    const a = ranged(summoner(6));
    expect(a, 'the attack exists whether or not the type is chosen').toBeTruthy();
    expect(a!.damage).toContain('chosen damage type');
    expect(a!.damage).not.toContain('slashing');
  });

  it('it rolls Dexterity and adds HALF Strength to damage (propulsive), unlike the melee Strikes', () => {
    // Str 5 / Dex 3: a melee Strike rolls +5 and adds +5; the ranged one rolls +3 and adds +2
    // (floor(5/2)). Deliberately asymmetric so a Str-based attack roll cannot pass by coincidence.
    const ch = summoner(6, 'fire');
    const abilities = { str: 5, dex: 3, con: 3, int: 0, wis: 1, cha: 1 };
    const blk = eidolon(ch, { eidolon: { abilities } });
    const melee = blk.attacks[0];
    const rng = blk.attacks.find((a) => a.range != null)!;
    expect(melee.attack - rng.attack).toBe(abilities.str - abilities.dex);
    expect(melee.damage).toContain('+5');
    expect(rng.damage).toContain('1d4+2 fire');
  });

  it('a NEGATIVE Strength is added in full, which is what propulsive says', () => {
    const rng = ranged(summoner(6, 'fire'), { eidolon: { abilities: { str: -1, dex: 3, con: 3, int: 0, wis: 1, cha: 1 } } })!;
    expect(rng.damage).toContain('1d4-1 fire');
  });

  it('Eidolon Weapon Specialization reaches it too (nothing at 6th, +2 at 7th)', () => {
    expect(ranged(summoner(6, 'fire'), { eidolon: { abilities: { str: 0, dex: 3, con: 3, int: 0, wis: 1, cha: 1 } } })!.damage).toContain('1d4 fire');
    expect(ranged(summoner(7, 'fire'), { eidolon: { abilities: { str: 0, dex: 3, con: 3, int: 0, wis: 1, cha: 1 } } })!.damage).toContain('1d4+2 fire');
  });
});

/* ──────────────────────────── Exemplar Dedication ──────────────────────────── */

const IKONS = (db.classes.exemplar?.extraChoices ?? []).find((g) => g.id === 'ikon')?.options ?? [];
const exemplar = (answer?: string): Character =>
  build('wizard', 6, {
    featPicks: { '2:class:0': 'exemplar-dedication' },
    ...(answer ? { featChoices: { '2:class:0': answer } } : {}),
  });

describe('Exemplar Dedication — the phantom question replaced by the real one', () => {
  it('no longer asks which ability score, which was its PREREQUISITE rendered as a choice', () => {
    const def = db.feats['exemplar-dedication'].choice;
    expect(def?.prompt).not.toBe('Class DCAbility Score');
    expect((def?.options ?? []).map((o) => o.value).sort()).not.toEqual(['dex', 'str']);
  });

  it('asks for an ikon instead, and every option is a real ikon record', () => {
    const def = db.feats['exemplar-dedication'].choice!;
    expect(def.ownsFeature, 'without ownsFeature the answer owns nothing').toBe(true);
    expect(IKONS.length).toBeGreaterThan(0);
    expect((def.options ?? []).map((o) => o.value).sort()).toEqual(IKONS.map((o) => o.id).sort());
    for (const o of def.options ?? []) {
      expect(db.classFeatures[o.value]?.traits, o.value).toContain('ikon');
    }
  });

  it('the answer OWNS the ikon and the transcendence action it grants', () => {
    // Gleaming Blade's whole mechanical content is its immanence (on the record) and
    // `grantsClassFeatures: ['flowing-spirit-strike']` — the transcendence action. Owning the ikon
    // without resolving its own grant would give the player the ikon and not the action it is for.
    const owned = ownedFeatureIds(exemplar('gleaming-blade'), db);
    expect(owned.has('gleaming-blade')).toBe(true);
    expect(owned.has('flowing-spirit-strike')).toBe(true);
    // …and the Shift Immanence action the dedication grants outright.
    expect(owned.has('shift-immanence')).toBe(true);
  });

  it('a different ikon owns a different transcendence, and an unanswered pick owns none', () => {
    const barrows = ownedFeatureIds(exemplar('barrows-edge'), db);
    expect(barrows.has('drink-of-my-foes')).toBe(true);
    expect(barrows.has('flowing-spirit-strike')).toBe(false);
    const none = ownedFeatureIds(exemplar(), db);
    expect([...none].filter((id) => db.classFeatures[id]?.traits?.includes('ikon'))).toEqual([]);
  });

  it('trains martial weapons and the exemplar class DC', () => {
    const ch = exemplar('gleaming-blade');
    expect(prof(ch, 'martial')).toBe('trained');
    const dc = (ch.secondaryClassDcs ?? []).find((d) => d.classId === 'exemplar');
    expect(dc, 'no exemplar class DC — the feat’s last sentence').toBeTruthy();
    expect(dc!.rank).toBe('trained');
    // The deleted picker asked Strength or Dexterity. This is why it was redundant: the borrowed
    // class DC already takes the exemplar's own key attribute, and the HIGHER of the two when the
    // class allows either. A wizard's Dex beats their Str, so the engine picks Dex unprompted.
    expect(dc!.keyAbility).toBe('dex');
  });

  it('resolving a choice answer’s own grant does not hand a warpriest a 13th-level feature at 1st', () => {
    // The collateral this change had to clear. `ownedFeatureIds` now resolves `grantsClassFeatures`
    // AFTER the chosen subclass and the choice answers join the set, which is what lets an ikon grant
    // its transcendence — and it also exposed four cleric records that had misread *"if you gain the
    // Divine Defense class feature, you also gain expert proficiency in light and medium armor"* as a
    // grant of Divine Defense itself. The cleric class table grants it at 13th, to every cleric.
    const cleric = (level: number, subclassId: string) =>
      ownedFeatureIds(build('cleric', level, { subclassId, deityId: Object.keys(db.deities)[0] }), db);
    expect(cleric(1, 'warpriest').has('divine-defense')).toBe(false);
    expect(cleric(12, 'warpriest').has('divine-defense')).toBe(false);
    expect(cleric(13, 'warpriest').has('divine-defense')).toBe(true);
    expect(cleric(13, 'cloistered-cleric').has('divine-defense')).toBe(true);
    for (const id of ['warpriest', 'battle-creed', 'first-doctrine-warpriest', 'initial-creed']) {
      expect(db.classFeatures[id]?.grantsClassFeatures, id).toBeUndefined();
    }
  });

  it('the picker describes each ikon without a second copy of the text living on the option', () => {
    const def = db.feats['exemplar-dedication'].choice!;
    expect(def.options!.every((o) => !o.description), 'options should carry no duplicated prose').toBe(true);
    const ch = exemplar();
    const opts = buildChoiceOptions('exemplar-dedication', def, { ...emptyBuild(), level: 6 }, db, ch);
    expect(opts).toHaveLength(IKONS.length);
    expect(opts.every((o) => !!o.description)).toBe(true);
    expect(opts.find((o) => o.value === 'gleaming-blade')!.description).toContain('Immanence');
  });
});
