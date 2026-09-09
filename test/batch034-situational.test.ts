import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import {
  characterSituationalIds,
  recordMarkersFor,
  spellSituationalFor,
  statHasSituational,
  type StatRef,
} from '../src/rules/explain';
import { featSituationalFor } from '../src/rules/situationalBonuses';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * Wanderer's-Guide parity batch 034, SITUATIONAL lane.
 *
 * Same discipline as batches 29-33: every assertion goes through the reader the SHEET uses —
 * `spellSituationalFor` (SpellsTab's spell-row riders), `statHasSituational` (the `*` beside a stat)
 * and `featSituationalFor(characterSituationalIds(...))` (the rows inside StatDetailModal) — never
 * the registry literal. Every character is BUILT, so the id an entry is keyed to has to actually
 * arrive through `ownedFeatureIds`; four of these seven ride a route that is not a feat slot (a
 * psychic conscious mind, an oracle mystery's curse, an exemplar ikon pick and an inventor
 * innovation modification).
 */
const db = content();

/** `source :: when :: bonus` for one spell row, as SpellsTab reads it. */
const spellStars = (c: Character, spellId: string) =>
  spellSituationalFor(c, db, spellId).map((s) => `${s.source} :: ${s.when} :: ${s.bonus}`);

/** `when :: bonus` for the rows ONE record contributes to a stat, as StatDetailModal reads them. */
const stars = (c: Character, ref: { kind: string; skill?: string; save?: string; which?: string }, sourceId: string) =>
  featSituationalFor(characterSituationalIds(c, db), ref)
    .filter((s) => s.id === sourceId)
    .map((s) => `${s.when} :: ${s.bonus}`);

describe('the-silent-whisper modifies daze and message, and only for its own psychic', () => {
  /* AoN conscious-mind-10 (The Silent Whisper), Standard Psi Cantrips. Daze: "You can daze from a
   * great distance, your thoughts resounding like a siren in your foes' minds. The range increases
   * to 120 feet." Message: "Your message spell can travel up to 120 feet to reach the target, bending
   * around walls and obstacles; this means you don't need a straight line of effect or line of sight
   * to cast message as long as you know the target's space and there is an unblocked path of 120 feet
   * or less that can reach them. You can cast message in a purely telepathic manner, causing the
   * spell to lose the auditory trait." Both are printed on the conscious mind, so the spell records
   * keep the numbers and traits that are right for every other caster — ruling G puts the rider on
   * the spell, "that's what you're looking at when you cast it." */

  const whisper = build('psychic', 5, { subclassId: 'the-silent-whisper' });
  const grasp = build('psychic', 5, { subclassId: 'the-distant-grasp' });

  // batch 034: the-silent-whisper#daze-range
  it('a Silent Whisper psychic reads the 120-foot range on the daze row', () => {
    // The chosen conscious mind has to actually reach the situational id set, or the entry is invisible.
    expect(characterSituationalIds(whisper, db)).toContain('the-silent-whisper');
    const rows = spellStars(whisper, 'daze');
    expect(rows.length, 'exactly one rider on the daze row').toBe(1);
    expect(rows[0]).toContain('The Silent Whisper');
    expect(rows[0]).toContain('range 120 feet');
    // The spell record itself is untouched — 60 feet is right for everyone else.
    expect(db.spells['daze'].range).toBe('60 feet');
  });

  // batch 034: the-silent-whisper#message-reach
  it('a Silent Whisper psychic reads the walls-and-telepathy rider on the message row', () => {
    const rows = spellStars(whisper, 'message');
    expect(rows.length, 'exactly one rider on the message row').toBe(1);
    expect(rows[0]).toContain('line of effect');
    expect(rows[0]).toContain('line of sight');
    expect(rows[0]).toContain('120 feet');
    expect(rows[0]).toContain('auditory');
    // The spell keeps `auditory` and its printed 120-foot range: only THIS psychic may drop the trait.
    expect(db.spells['message'].traits).toContain('auditory');
    expect(db.spells['message'].range).toBe('120 feet');
  });

  // batch 034: the-silent-whisper#daze-range
  it('a psychic with a different conscious mind, and a wizard, read neither rider', () => {
    expect(spellStars(grasp, 'daze')).toEqual([]);
    expect(spellStars(grasp, 'message')).toEqual([]);
    expect(spellStars(build('wizard', 5), 'daze')).toEqual([]);
  });
});

describe('curse-of-turbulent-moments penalises the AC and the saves it names', () => {
  /* AoN mystery-23 (Time), Curse of Turbulent Moments: "You take a status penalty to your AC against
   * attacks made against you from reactions or free actions and a status penalty to saving throws
   * against effects that would make you fatigued or slowed equal to your cursebound value." The only
   * carrier was the RECORD_MARKERS note on the `cursebound` condition, and `markersFor` matches on/id
   * alone — so a cursebound Time oracle read an unpenalised AC and unpenalised saves. */

  const time = build('oracle', 5, { subclassId: 'time' });
  const battle = build('oracle', 5, { subclassId: 'battle' });

  // batch 034: curse-of-turbulent-moments
  it('a Time oracle owns the curse and reads the AC penalty on the AC row', () => {
    expect(characterSituationalIds(time, db)).toContain('curse-of-turbulent-moments');
    expect(statHasSituational(time, { kind: 'ac' }, db)).toBe(true);
    const rows = stars(time, { kind: 'ac' }, 'curse-of-turbulent-moments');
    expect(rows.length).toBe(1);
    expect(rows[0]).toContain('reactions or free actions');
    expect(rows[0]).toContain('cursebound');
  });

  // batch 034: curse-of-turbulent-moments
  it('all three saves carry the fatigued-or-slowed half of the same sentence', () => {
    for (const save of ['fortitude', 'reflex', 'will'] as const) {
      const rows = stars(time, { kind: 'save', save }, 'curse-of-turbulent-moments');
      expect(rows.length, `${save} carries the curse row`).toBe(1);
      expect(rows[0]).toContain('fatigued or slowed');
      expect(statHasSituational(time, { kind: 'save', save }, db)).toBe(true);
    }
  });

  // batch 034: curse-of-turbulent-moments
  it('the cursebound condition keeps its note as well — Q2 lets a star and a mark coexist', () => {
    const marks = recordMarkersFor(time, db, 'condition', 'cursebound')
      .filter((m) => m.sourceId === 'curse-of-turbulent-moments');
    expect(marks.length).toBe(1);
    expect(marks[0].note).toContain('reactions or free actions');
  });

  // batch 034: curse-of-turbulent-moments
  it('an oracle of another mystery gets none of it', () => {
    expect(stars(battle, { kind: 'ac' }, 'curse-of-turbulent-moments')).toEqual([]);
    expect(stars(battle, { kind: 'save', save: 'will' }, 'curse-of-turbulent-moments')).toEqual([]);
  });
});

describe('elemental-instinct shows the Elemental Rage concealment on the AC row', () => {
  /* AoN's Elemental Rage: "While raging, you're cloaked in a vortex of elemental matter; you become
   * concealed against ranged attacks. You can't use this concealment to Hide or Sneak." The record's
   * only structured payload is its element choice's resistances, so the clause lived in the
   * description alone and no ranged attacker's DC 5 flat check reached the sheet. */

  const elem = build('barbarian', 5, { subclassId: 'elemental-instinct' });
  const fury = build('barbarian', 5, { subclassId: 'fury-instinct' });

  // batch 034: elemental-instinct#concealment
  it('an Elemental Instinct barbarian reads the concealment on AC', () => {
    expect(characterSituationalIds(elem, db)).toContain('elemental-instinct');
    const rows = stars(elem, { kind: 'ac' }, 'elemental-instinct');
    expect(rows.length).toBe(1);
    expect(rows[0]).toContain('while raging, against ranged attacks');
    expect(rows[0]).toContain('DC 5 flat check');
    // print's carve-out travels with it, so the player cannot read it as a Stealth licence.
    expect(rows[0]).toContain("can't be used to Hide or Sneak");
    expect(statHasSituational(elem, { kind: 'ac' }, db)).toBe(true);
  });

  // batch 034: elemental-instinct#concealment
  it('a barbarian of another instinct reads no such row, and Stealth gets nothing either', () => {
    expect(stars(fury, { kind: 'ac' }, 'elemental-instinct')).toEqual([]);
    expect(stars(elem, { kind: 'skill', skill: 'stealth' }, 'elemental-instinct')).toEqual([]);
  });
});

describe('weapon-innovation no longer doubles the Segmented Frame Stealth bonus', () => {
  /* AoN's Segmented Frame: "When it's collapsed to light Bulk, it has the concealable trait, which
   * grants you a +2 circumstance bonus to Stealth checks and DCs to hide or conceal the weapon."
   * Print states it once, on the MODIFICATION. The subclass-keyed copy was a stopgap from before
   * innovation modifications reached `ownedFeatureIds`, so it fired for every weapon inventor. */

  const withFrame = build('inventor', 5, {
    subclassId: 'weapon-innovation',
    inventorModifications: { initial: 'segmented-frame' },
  } as Partial<BuildState>);
  const withoutFrame = build('inventor', 5, {
    subclassId: 'weapon-innovation',
    inventorModifications: { initial: 'hampering-spikes' },
  } as Partial<BuildState>);

  // batch 034: weapon-innovation#segmented-frame-duplicate
  it('a weapon inventor who took Segmented Frame reads the +2 exactly once, from the pick', () => {
    expect(characterSituationalIds(withFrame, db)).toContain('segmented-frame');
    expect(characterSituationalIds(withFrame, db)).toContain('weapon-innovation');
    const ref: { kind: string; skill: string } = { kind: 'skill', skill: 'stealth' };
    expect(stars(withFrame, ref, 'segmented-frame').length).toBe(1);
    expect(stars(withFrame, ref, 'weapon-innovation')).toEqual([]);
  });

  // batch 034: weapon-innovation#segmented-frame-duplicate
  it('a weapon inventor who took a different modification reads no Stealth star at all', () => {
    const ref: { kind: string; skill: string } = { kind: 'skill', skill: 'stealth' };
    expect(stars(withoutFrame, ref, 'segmented-frame')).toEqual([]);
    expect(stars(withoutFrame, ref, 'weapon-innovation')).toEqual([]);
  });
});

describe('scar-of-the-survivor gates its whole Immanence sentence, Diehard included', () => {
  /* AoN ikon-13, Immanence: "Divine energy spreads outward from your scar, reinforcing your flesh.
   * You gain the benefits of the Diehard feat and a +1 status bonus to Fortitude saving throws." ONE
   * sentence, one condition. The Fortitude half was gated here; the Diehard half rode an ungated
   * `grantsFeats: ["diehard"]` on the record, so merely PICKING the ikon handed the feat over for
   * good. The data row that retires `grantsFeats` is authored by the driver
   * (work/.b034-rows-situational.json), so the grant half is proved on a content copy with the field
   * STRIPPED IN MEMORY — never as a patched-vs-shipped delta that would flip once the row lands. */

  const anc = Object.keys(db.ancestries)[0];
  const bg = Object.keys(db.backgrounds)[0];
  /** An exemplar holding this ikon, built against `db` with one record patched. */
  const exemplarWithScar = (patch: (rec: Record<string, unknown>) => void): Character => {
    const rec = structuredClone(db.classFeatures['scar-of-the-survivor']) as unknown as Record<string, unknown>;
    patch(rec);
    const patched = {
      ...db,
      classFeatures: { ...db.classFeatures, 'scar-of-the-survivor': rec },
    } as unknown as ContentDatabase;
    const cls = db.classes['exemplar'];
    return buildCharacter(
      {
        ...emptyBuild(),
        name: 't',
        level: 5,
        classId: 'exemplar',
        ancestryId: anc,
        backgroundId: bg,
        keyAbility: (cls.keyAbility.length === 1 ? cls.keyAbility[0] : null) as BuildState['keyAbility'],
        extraChoices: { ikon: ['scar-of-the-survivor'] },
      },
      patched,
    );
  };

  // batch 034: scar-of-the-survivor#diehard-ungated
  it('with grantsFeats stripped, picking scar-of-the-survivor grants no permanent Diehard', () => {
    const ch = exemplarWithScar((rec) => { delete rec.grantsFeats; });
    expect(ch.feats.some((f) => f.featId === 'diehard')).toBe(false);
  });

  // batch 034: scar-of-the-survivor#diehard-ungated
  it('the ungated grant is what hands Diehard over today, so removing the field is the whole fix', () => {
    // The same builder with the field PRESENT — this is the behaviour the data row retires, pinned
    // here so the test says what it is removing rather than only that it is gone.
    const ch = exemplarWithScar((rec) => { rec.grantsFeats = ['diehard']; });
    const granted = ch.feats.find((f) => f.featId === 'diehard');
    expect(granted?.grantedBy).toBe('scar-of-the-survivor');
  });

  // batch 034: scar-of-the-survivor#diehard-ungated
  it('the Fortitude row carries both halves of the printed sentence, both immanence-gated', () => {
    const ch = build('exemplar', 5, { extraChoices: { ikon: ['scar-of-the-survivor'] } });
    const rows = stars(ch, { kind: 'save', save: 'fortitude' }, 'scar-of-the-survivor');
    expect(rows.length, 'the +1 status and the Diehard clause').toBe(2);
    for (const r of rows) expect(r).toContain('immanence active');
    expect(rows.some((r) => r.includes('+1 status'))).toBe(true);
    expect(rows.some((r) => r.includes('Diehard'))).toBe(true);
  });
});

describe("victors-wreath stars the spell attack row too, not only Strikes", () => {
  /* AoN ikon-21, Immanence: "You inspire your allies to greater glory. You and all your allies in a
   * 15-foot emanation gain a +1 status bonus to attack rolls." Print says "attack rolls" with no
   * qualification, so a spellcasting exemplar (or a spellcasting ally in the emanation) gets it on
   * spell attack rolls as well; the entry carried `strikeAttack` alone. `pennant-of-victory` is the
   * project's precedent for the same printed phrase and already carries both kinds. */

  const wreath = build('exemplar', 8, {
    extraChoices: { ikon: ['victors-wreath'] },
    overrides: { addedFeats: [{ featId: 'wizard-dedication', level: 2, category: 'class' }] },
  } as Partial<BuildState>);

  // batch 034: victors-wreath#spell-attack
  it('an exemplar holding victors-wreath reads the +1 on the spell attack row', () => {
    expect(characterSituationalIds(wreath, db)).toContain('victors-wreath');
    const rows = stars(wreath, { kind: 'spell', which: 'attack' }, 'victors-wreath');
    expect(rows.length).toBe(1);
    expect(rows[0]).toContain('+1 status');
    expect(rows[0]).toContain('15 feet');
    // …and it is the SAME entry that stars Strikes, not a second bonus.
    expect(stars(wreath, { kind: 'strikeAttack' }, 'victors-wreath')).toEqual(rows);
  });

  // batch 034: victors-wreath#spell-attack
  it('the star reaches the real spell attack row of a casting exemplar', () => {
    const entry = wreath.spellcasting.find((s) => s.type === 'prepared' || s.type === 'spontaneous');
    expect(entry, 'the archetype gave this exemplar a spellcasting entry to hang the row on').toBeTruthy();
    const ref: StatRef = { kind: 'spell', entryId: entry!.id, which: 'attack' };
    expect(statHasSituational(wreath, ref, db)).toBe(true);
  });

  // batch 034: victors-wreath#spell-attack
  it('the spell DC row is left alone — print says attack rolls, not DCs', () => {
    expect(stars(wreath, { kind: 'spell', which: 'dc' }, 'victors-wreath')).toEqual([]);
  });
});
