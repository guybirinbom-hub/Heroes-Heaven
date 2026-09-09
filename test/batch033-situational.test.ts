import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { characterSituationalIds, recordMarkersFor, spellSituationalFor } from '../src/rules/explain';
import { featSituationalFor } from '../src/rules/situationalBonuses';
import type { Character } from '../src/rules/types';

/**
 * Wanderer's-Guide parity batch 033, SITUATIONAL lane.
 *
 * Same discipline as batches 29-32: every assertion goes through the reader the SHEET uses —
 * `spellSituationalFor` (SpellsTab's spell-row stars), `recordMarkersFor` (the mark on a condition
 * row) and `featSituationalFor(characterSituationalIds(...))` (the stat-row star list) — never the
 * registry literal. Each character is BUILT, so the id the entry is keyed to has to actually arrive
 * through `ownedFeatureIds`; three of these five entries are keyed to a subclass option, which is a
 * route no previous test on this lane exercised.
 */
const db = content();

/** `when :: bonus` for one spell row, as SpellsTab reads it. */
const spellStars = (c: Character, spellId: string) =>
  spellSituationalFor(c, db, spellId).map((s) => `${s.source} :: ${s.when} :: ${s.bonus}`);

/** `when :: bonus` for one record on one stat row, as StatDetailModal reads it. */
const stars = (c: Character, ref: { kind: string; skill?: string; save?: string }, sourceId: string) =>
  featSituationalFor(characterSituationalIds(c, db), ref)
    .filter((s) => s.id === sourceId)
    .map((s) => `${s.when} :: ${s.bonus}`);

describe('the-distant-grasp modifies its two standard psi cantrips outside the amp', () => {
  /* AoN conscious-mind-7 (The Distant Grasp), Standard Psi Cantrips. Telekinetic Projectile: "Your
   * telekinetic projectiles can fly much further away. Increase the range of telekinetic projectile
   * to 60 feet." Telekinetic Hand: "Your telekinetic hand can carry up to 1 Bulk instead of only
   * light Bulk. If the spell is heightened to 3rd rank or higher, its maximum Bulk is 2. If the
   * spell is heightened to 7th rank or higher, its maximum Bulk is 3." Both are printed on the
   * conscious mind, so the spell records keep their unmodified 30-foot range and light-Bulk limit —
   * correct for every caster who is not a Distant Grasp psychic, and wrong on this one's spell row.
   * Ruling G puts them on the spell: "that's what you're looking at when you cast it." */

  const grasp = build('psychic', 5, { subclassId: 'the-distant-grasp' });
  const step = build('psychic', 5, { subclassId: 'the-unbound-step' });

  // batch 033: the-distant-grasp#telekinetic-projectile
  it('a Distant Grasp psychic reads the 60-foot range on the telekinetic-projectile row', () => {
    // The chosen conscious mind has to actually reach the situational id set, or the entry is invisible.
    expect(characterSituationalIds(grasp, db)).toContain('the-distant-grasp');
    const rows = spellStars(grasp, 'telekinetic-projectile');
    expect(rows.length, 'exactly one rider on the projectile row').toBe(1);
    expect(rows[0]).toContain('The Distant Grasp');
    expect(rows[0]).toContain('60 feet');
    // The spell record itself is untouched — 30 feet is right for everyone else.
    expect(db.spells['telekinetic-projectile'].range).toBe('30 feet');
  });

  // batch 033: the-distant-grasp#telekinetic-hand
  it('a Distant Grasp psychic reads the 1/2/3 Bulk ladder on the telekinetic-hand row', () => {
    const rows = spellStars(grasp, 'telekinetic-hand');
    expect(rows.length, 'exactly one rider on the hand row').toBe(1);
    expect(rows[0]).toContain('1 Bulk instead of light Bulk');
    expect(rows[0]).toContain('2 Bulk at 3rd rank or higher');
    expect(rows[0]).toContain('3 Bulk at 7th or higher');
  });

  // batch 033: the-distant-grasp#telekinetic-projectile
  it('a psychic with a different conscious mind than the-distant-grasp reads neither rider', () => {
    expect(spellStars(step, 'telekinetic-projectile')).toEqual([]);
    expect(spellStars(step, 'telekinetic-hand')).toEqual([]);
    // …and so does a caster of these cantrips from another class entirely.
    expect(spellStars(build('wizard', 5), 'telekinetic-projectile')).toEqual([]);
  });
});

describe('the-unbound-step strips a point of the target cover bonus on phase-bolt', () => {
  /* AoN conscious-mind-12 (The Unbound Step): "Your phase bolt temporarily sends the target's cover
   * out of phase if it hits. On a success, reduce the target's circumstance bonus to AC (if any) by
   * 1 until the beginning of your next turn." It moves the TARGET's AC — ruling F, someone else's
   * roll — so no stat row of this character's own sheet can hold it, and only the warp-step Speed
   * clause of this conscious mind had a carrier at all. */

  const step = build('psychic', 5, { subclassId: 'the-unbound-step' });

  // batch 033: the-unbound-step#phase-bolt
  it('an Unbound Step psychic reads the cover-stripping rider on the phase-bolt row', () => {
    expect(characterSituationalIds(step, db)).toContain('the-unbound-step');
    const rows = spellStars(step, 'phase-bolt');
    expect(rows.length, 'exactly one rider on the phase bolt row').toBe(1);
    expect(rows[0]).toContain('The Unbound Step');
    expect(rows[0]).toContain('on a success');
    expect(rows[0]).toContain("circumstance bonus to AC");
    expect(rows[0]).toContain('beginning of your next turn');
  });

  // batch 033: the-unbound-step#phase-bolt
  it('a psychic without the-unbound-step reads a plain phase-bolt row', () => {
    expect(spellStars(build('psychic', 5, { subclassId: 'the-distant-grasp' }), 'phase-bolt')).toEqual([]);
  });
});

describe('curse-of-creeping-ashes cursebound 4 penalises Speeds, it does not kill you', () => {
  /* AoN mystery-20 (Ashes, ORC Divine Mysteries remaster — the record's aonParentId): "Cursebound 4
   * You take a -10-foot status penalty to all your Speeds as your limbs begin to crumble like ash."
   * Our note ended "4: you are consumed and die", a mechanic that appears nowhere in the record.
   * WG encodes the printed clause as a -10 status penalty to SPEED and to each of SPEED_FLY /
   * SPEED_CLIMB / SPEED_BURROW / SPEED_SWIM, which is the same rule. */

  const ashes = build('oracle', 5, { subclassId: 'ashes' });

  // batch 033: curse-of-creeping-ashes#cursebound-4-text
  it('an Ashes oracle reads the printed Speed penalty on the cursebound condition', () => {
    const marks = recordMarkersFor(ashes, db, 'condition', 'cursebound')
      .filter((m) => m.sourceId === 'curse-of-creeping-ashes');
    expect(marks.length, 'the mystery hands its curse over').toBe(1);
    expect(marks[0].note).toContain('−10-foot status penalty to all your Speeds');
    expect(marks[0].note).toContain('crumble like ash');
  });

  // batch 033: curse-of-creeping-ashes#cursebound-4-text
  it('the invented death clause is gone from the curse-of-creeping-ashes note', () => {
    const note = recordMarkersFor(ashes, db, 'condition', 'cursebound')
      .filter((m) => m.sourceId === 'curse-of-creeping-ashes')
      .map((m) => m.note)
      .join(' ');
    expect(note).not.toMatch(/\bdie\b/);
    expect(note).not.toContain('consumed');
    // The three rungs the print DOES have are untouched.
    expect(note).toContain('weakness 2 to fire');
    expect(note).toContain('5 + your level');
  });
});

describe('construct-eidolon Construct Heart states all four save categories and the bleed flat check', () => {
  /* AoN eidolon-4 (Construct Heart): "It doesn't have a construct's normal immunities, but does gain
   * a +2 circumstance bonus to saving throws against death effects, disease, necromancy, and poison
   * effects, as well as effects causing the fatigued or sickened conditions. Additionally, its
   * astral essence bleeds off slowly, and it only needs to succeed at a DC 10 flat check to remove
   * persistent bleed damage (or DC 5 after receiving particularly effective aid)." Our row stopped
   * at an ellipsis after "necromancy" and had no flat-check line at all. */

  const summoner = build('summoner', 5, { subclassId: 'construct-eidolon' });

  // batch 033: construct-eidolon#construct-heart
  it('the save star names poison, fatigued and sickened, not an ellipsis', () => {
    expect(characterSituationalIds(summoner, db)).toContain('construct-eidolon');
    const rows = stars(summoner, { kind: 'save', save: 'fortitude' }, 'construct-eidolon');
    expect(rows.length, 'one save star').toBe(1);
    expect(rows[0]).toContain('+2 circumstance');
    for (const printed of ['death effects', 'disease', 'necromancy', 'poison', 'fatigued', 'sickened']) {
      expect(rows[0], `printed category "${printed}" is displayed`).toContain(printed);
    }
    expect(rows[0], 'no truncation ellipsis left in the displayed string').not.toContain('…');
  });

  // batch 033: construct-eidolon#construct-heart
  it('the DC 10 persistent-bleed flat check reaches the hp row', () => {
    const rows = stars(summoner, { kind: 'hp' }, 'construct-eidolon');
    expect(rows.length, 'one flat-check line, the charhide-goblin shape').toBe(1);
    expect(rows[0]).toContain('persistent bleed damage');
    expect(rows[0]).toContain('DC 10 instead of 15');
    expect(rows[0]).toContain('DC 5');
  });

  // batch 033: construct-eidolon#construct-heart
  it('a summoner with a different eidolon reads neither line', () => {
    const beast = build('summoner', 5, { subclassId: 'beast-eidolon' });
    expect(stars(beast, { kind: 'save', save: 'fortitude' }, 'construct-eidolon')).toEqual([]);
    expect(stars(beast, { kind: 'hp' }, 'construct-eidolon')).toEqual([]);
  });
});
