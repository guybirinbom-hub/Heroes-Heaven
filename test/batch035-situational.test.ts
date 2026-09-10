import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import type { BuildState } from '../src/rules/build';
import {
  characterSituationalIds,
  recordMarkersFor,
  spellSituationalFor,
} from '../src/rules/explain';
import { featSituationalFor } from '../src/rules/situationalBonuses';
import type { Character } from '../src/rules/types';

/**
 * Wanderer's-Guide parity batch 035, SITUATIONAL lane.
 *
 * Same discipline as batches 29-34: every assertion goes through the reader the SHEET uses —
 * `recordMarkersFor` (MainTab's action rows and FeatsTab's feature entries), `spellSituationalFor`
 * (SpellsTab's spell-row riders) and `featSituationalFor(characterSituationalIds(...))` (the rows
 * inside StatDetailModal) — never the registry literal. Every character is BUILT, so the id an entry
 * is keyed to has to actually arrive through `ownedFeatureIds`: six of the seven records here ride a
 * subclass or an innovation modification rather than a feat slot.
 */
const db = content();

/** `when :: bonus` for the rows ONE record contributes to a stat, as StatDetailModal reads them. */
const stars = (c: Character, ref: { kind: string; skill?: string; save?: string; which?: string }, sourceId: string) =>
  featSituationalFor(characterSituationalIds(c, db), ref)
    .filter((s) => s.id === sourceId)
    .map((s) => `${s.when} :: ${s.bonus}`);

/** The marks ONE record puts on an action / condition / feature row. */
const marks = (c: Character, on: 'action' | 'condition' | 'feature', id: string, sourceId: string) =>
  recordMarkersFor(c, db, on, id).filter((m) => m.sourceId === sourceId);

/** `source :: when :: bonus` for one spell row, as SpellsTab reads it. */
const spellStars = (c: Character, spellId: string) =>
  spellSituationalFor(c, db, spellId).map((s) => `${s.source} :: ${s.when} :: ${s.bonus}`);

describe('forensic-medicine-methodology carries its Battle Medicine rider', () => {
  /* AoN methodology-7 (Player Core 2 pg. 104): "When you use Battle Medicine, on a success the target
   * recovers additional Hit Points equal to your level, and the target becomes temporarily immune for
   * only 1 hour, not 1 day." The three GRANTS shipped (Medicine training, Forensic Acumen, Battle
   * Medicine); the rider they exist for had no carrier on either side, and skillActions.ts still tells
   * this investigator the immunity is 1 day. */

  const forensic = build('investigator', 5, { subclassId: 'forensic-medicine-methodology' });
  const empiricism = build('investigator', 5, { subclassId: 'empiricism-methodology' });

  // batch 035: forensic-medicine-methodology#battle-medicine-rider
  it('a forensic-medicine-methodology investigator reads the +level heal on the HP rows', () => {
    // The methodology is a subclass, so it only reaches the registry via ownedFeatureIds.
    expect(characterSituationalIds(forensic, db)).toContain('forensic-medicine-methodology');
    const rows = stars(forensic, { kind: 'hp' }, 'forensic-medicine-methodology');
    expect(rows.length, 'one row for the one printed sentence').toBe(1);
    expect(rows[0]).toContain('Battle Medicine');
    expect(rows[0]).toContain('your level');
  });

  // batch 035: forensic-medicine-methodology#battle-medicine-rider
  it('the shortened immunity travels with it, so the 1-day text is not the last word', () => {
    expect(stars(forensic, { kind: 'hp' }, 'forensic-medicine-methodology')[0]).toContain('1 hour, not 1 day');
  });

  // batch 035: forensic-medicine-methodology#battle-medicine-rider
  it('an investigator of another methodology gets neither half', () => {
    expect(stars(empiricism, { kind: 'hp' }, 'forensic-medicine-methodology')).toEqual([]);
  });

  /* …and the surface the rider actually contradicts. The `hp` star is on THIS character's Hit Points;
   * the printed heal is on the target's, and skillActions.ts's Battle Medicine row still ends "The
   * target is then immune to your Battle Medicine for 1 day." for every reader. The mark puts the
   * printed 1 hour on that row (StatDetailModal slugs the skill action's name to 'battle-medicine',
   * MainTab slugs the activity's the same way). */

  // batch 035: forensic-medicine-methodology#battle-medicine-rider
  it('the Battle Medicine row itself carries the shortened immunity, where the 1-day text is', () => {
    const m = marks(forensic, 'action', 'battle-medicine', 'forensic-medicine-methodology');
    expect(m.length, 'one mark on the action the rider modifies').toBe(1);
    expect(m[0].note).toContain('1 hour, not 1 day');
    expect(m[0].note).toContain('equal to your level');
    expect(m[0].value).toContain('your level');
  });

  // batch 035: forensic-medicine-methodology#battle-medicine-rider
  it('…and no other investigator sees a mark on Battle Medicine', () => {
    expect(recordMarkersFor(empiricism, db, 'action', 'battle-medicine')).toEqual([]);
  });
});

describe('superstition-instinct shows both Rage riders on the Rage action', () => {
  /* AoN instinct-13 (Player Core 2): "When you Rage, you regain Hit Point equal to the temporary HP
   * you gained from the Rage action; you then can't regain HP in this way again for 10 minutes. While
   * raging, if you willingly accept the effects of a magic spell or effect, you are frightened 1. You
   * cannot reduce your frightened condition below 1 as long as you are affected by the spell or
   * effect." Both fire every time this barbarian Rages and lived only in description prose. */

  const superstitious = build('barbarian', 5, { subclassId: 'superstition-instinct' });
  const fury = build('barbarian', 5, { subclassId: 'fury-instinct' });

  // batch 035: superstition-instinct#rage-hp-and-frightened
  it('a superstition-instinct barbarian reads the HP regain on Rage', () => {
    expect(characterSituationalIds(superstitious, db)).toContain('superstition-instinct');
    const m = marks(superstitious, 'action', 'rage', 'superstition-instinct');
    expect(m.length).toBe(1);
    expect(m[0].note).toContain('temporary Hit Points that Rage gave you');
    expect(m[0].note).toContain('10 minutes');
  });

  // batch 035: superstition-instinct#rage-hp-and-frightened
  it('…and the frightened-1 price of accepting magic, floor included', () => {
    const note = marks(superstitious, 'action', 'rage', 'superstition-instinct')[0].note;
    expect(note).toContain('frightened 1');
    expect(note).toContain("can't reduce");
  });

  // batch 035: superstition-instinct#rage-hp-and-frightened
  it('the existing saves-and-damage stars are untouched, and another instinct sees no mark', () => {
    expect(stars(superstitious, { kind: 'save', save: 'will' }, 'superstition-instinct').length).toBe(1);
    expect(marks(fury, 'action', 'rage', 'superstition-instinct')).toEqual([]);
  });
});

describe('animal-instinct carries the Spider Web attack', () => {
  /* AoN instinct-8 gives the Spider two attacks — "Fangs | 1d8 P | Grapple, unarmed, venomous" and
   * "Web | Special* | Range increment 15 feet" — with the footnote "The spider's web attack deals no
   * damage, but the target takes a -10-foot circumstance penalty to its Speeds for 1 round on a hit.
   * If a target is hit a second time by the same character's web attack while they have this penalty,
   * they're instead immobilized until they succeed at a check to Escape against your class DC." Only
   * Fangs is in the record, and no Strike row can hold a damageless attack, so the whole thing rides
   * the Rage action the instinct's attacks belong to. */

  const animal = build('barbarian', 5, {
    subclassId: 'animal-instinct',
    featChoices: { 'feature:animal-instinct': 'spider', 'feature:animal-instinct:0': 'spider' },
  } as Partial<BuildState>);
  const giant = build('barbarian', 5, { subclassId: 'giant-instinct' });

  // batch 035: animal-instinct#spider-web
  it('an animal-instinct barbarian reads the Web attack, its range and its Speed penalty', () => {
    expect(characterSituationalIds(animal, db)).toContain('animal-instinct');
    const m = marks(animal, 'action', 'rage', 'animal-instinct');
    expect(m.length).toBe(1);
    expect(m[0].note).toContain('Web');
    expect(m[0].note).toContain('15 feet');
    expect(m[0].note).toContain('−10-foot circumstance penalty');
    expect(m[0].note).toContain('no damage');
  });

  // batch 035: animal-instinct#spider-web
  it('…and the second-hit immobilize, which is the half a Strike row could never say', () => {
    const note = marks(animal, 'action', 'rage', 'animal-instinct')[0].note;
    expect(note).toContain('immobilizes');
    expect(note).toContain('Escape against your class DC');
    // Scoped in the note's first word: a mark cannot be scoped to one answer of the record's choice.
    expect(note.startsWith('Spider:')).toBe(true);
  });

  // batch 035: animal-instinct#spider-web
  it('a barbarian of another instinct sees no Web note', () => {
    expect(marks(giant, 'action', 'rage', 'animal-instinct')).toEqual([]);
  });
});

describe('metallic-reactance shows the Overdrive increase on the Overdrive action', () => {
  /* AoN innovation-5: "You gain resistance equal to 3 + half your level to acid and electricity
   * damage. When under the effects of Overdrive, the resistance increases by 2." The record carries
   * only the flat resistance, so the sheet's number is the un-Overdriven one for everybody; the
   * printed increase goes where the inventor turns Overdrive on. */

  const metallic = build('inventor', 5, {
    subclassId: 'armor-innovation',
    inventorModifications: { initial: 'metallic-reactance' },
  } as Partial<BuildState>);
  const other = build('inventor', 5, {
    subclassId: 'armor-innovation',
    inventorModifications: { initial: 'dense-plating' },
  } as Partial<BuildState>);

  // batch 035: metallic-reactance#overdrive
  it('an inventor who took Metallic Reactance reads the +2 on Overdrive', () => {
    expect(characterSituationalIds(metallic, db)).toContain('metallic-reactance');
    const m = marks(metallic, 'action', 'overdrive', 'metallic-reactance');
    expect(m.length).toBe(1);
    expect(m[0].value).toContain('+2');
    expect(m[0].note).toContain('acid and electricity');
    expect(m[0].note).toContain('5 + half your level');
  });

  // batch 035: metallic-reactance#overdrive
  it('the note says which value the sheet is showing, because the number itself stays flat', () => {
    expect(marks(metallic, 'action', 'overdrive', 'metallic-reactance')[0].note).toContain('un-Overdriven');
  });

  // batch 035: metallic-reactance#overdrive
  it('an inventor with a different modification reads nothing on Overdrive', () => {
    expect(marks(other, 'action', 'overdrive', 'metallic-reactance')).toEqual([]);
  });
});

describe('the-oscillating-wave rewrites frostbite and ignition for its own psychic', () => {
  /* AoN conscious-mind-9 (The Oscillating Wave), Standard Psi Cantrips. Frostbite: "You can freeze
   * people from even farther away. The range of your frostbite increases to 120 feet." Ignition: "You
   * can drastically increase the heat against targets at a distance. When using ignition as a ranged
   * attack, increase the range to 60 feet. When using ignition as a melee attack, your reach increases
   * by 5 feet." Both are printed on the conscious mind, so the spell records keep the ranges that are
   * right for every other caster — ruling G puts the rider on the spell. */

  const wave = build('psychic', 5, { subclassId: 'the-oscillating-wave' });
  const whisper = build('psychic', 5, { subclassId: 'the-silent-whisper' });

  // batch 035: the-oscillating-wave#psi-cantrip-mods
  it('an Oscillating Wave psychic reads 120 feet on the frostbite row', () => {
    expect(characterSituationalIds(wave, db)).toContain('the-oscillating-wave');
    const rows = spellStars(wave, 'frostbite');
    expect(rows.length, 'exactly one rider on the frostbite row').toBe(1);
    expect(rows[0]).toContain('The Oscillating Wave');
    expect(rows[0]).toContain('range 120 feet');
    // The spell record itself is untouched — 60 feet is right for everyone else.
    expect(db.spells['frostbite'].range).toBe('60 feet');
  });

  // batch 035: the-oscillating-wave#psi-cantrip-mods
  it('…and both halves of the ignition clause on the ignition row', () => {
    const rows = spellStars(wave, 'ignition');
    expect(rows.length, 'exactly one rider on the ignition row').toBe(1);
    expect(rows[0]).toContain('range 60 feet');
    expect(rows[0]).toContain('reach increases by 5 feet');
    expect(db.spells['ignition'].range).toBe('30 feet');
  });

  // batch 035: the-oscillating-wave#psi-cantrip-mods
  it('a psychic of another conscious mind, and a wizard, read neither rider', () => {
    expect(spellStars(whisper, 'frostbite')).toEqual([]);
    expect(spellStars(whisper, 'ignition')).toEqual([]);
    expect(spellStars(build('wizard', 5), 'ignition')).toEqual([]);
  });
});

describe('starless-shadow and devourer-of-decay carry their familiar abilities', () => {
  /* AoN patron-17 (Player Core pg. 185), Familiar of Stalking Night: "When you Cast or Sustain a hex,
   * and your familiar is adjacent to an enemy to which it's concealed, hidden, or undetected, the
   * enemy becomes frightened 1." AoN patron-19 (Howl of the Wild pg. 61), Familiar of Parasitic Might:
   * "One creature within 15 feet of your familiar with less than half of its maximum Hit Points
   * becomes sickened 1 unless it succeeds at a Fortitude saving throw against your spell DC." Both
   * were delivered as tradition + skill + spells only, with the familiar clause carried nowhere; both
   * are enemy-facing, so a note on the Patron feature is the honest surface (ruling F). */

  const shadow = build('witch', 5, { subclassId: 'starless-shadow' });
  const decay = build('witch', 5, { subclassId: 'devourer-of-decay' });

  // batch 035: starless-shadow#familiar-of-stalking-night
  it("a Starless Shadow witch reads Familiar of Stalking Night on the Patron entry", () => {
    expect(characterSituationalIds(shadow, db)).toContain('starless-shadow');
    const m = marks(shadow, 'feature', 'patron', 'starless-shadow');
    expect(m.length).toBe(1);
    expect(m[0].note).toContain('Cast or Sustain a hex');
    expect(m[0].note).toContain('concealed, hidden, or undetected');
    expect(m[0].note).toContain('frightened 1');
  });

  // batch 035: devourer-of-decay#familiar-of-parasitic-might
  it("a Devourer of Decay witch reads Familiar of Parasitic Might on the Patron entry", () => {
    expect(characterSituationalIds(decay, db)).toContain('devourer-of-decay');
    const m = marks(decay, 'feature', 'patron', 'devourer-of-decay');
    expect(m.length).toBe(1);
    expect(m[0].note).toContain('15 feet');
    expect(m[0].note).toContain('half its maximum Hit Points');
    expect(m[0].note).toContain('sickened 1');
    expect(m[0].note).toContain('Fortitude save against your spell DC');
  });

  // batch 035: starless-shadow#familiar-of-stalking-night
  it('neither patron leaks onto the other, and each Patron entry carries exactly one mark', () => {
    expect(marks(shadow, 'feature', 'patron', 'devourer-of-decay')).toEqual([]);
    expect(marks(decay, 'feature', 'patron', 'starless-shadow')).toEqual([]);
    expect(recordMarkersFor(shadow, db, 'feature', 'patron').length).toBe(1);
    expect(recordMarkersFor(decay, db, 'feature', 'patron').length).toBe(1);
  });
});
