import { describe, it, expect } from 'vitest';
import { build } from './_content';
import type { BuildState } from '../src/rules/build';

/*
 * "…if you were already trained in BOTH these skills, you instead …"
 *
 * Fourteen records print a version of this clause and it has three different payoffs, each needing a
 * different field. Six records printed one and modelled none of it, so a character who already had
 * both options simply lost the grant — the archetype charged a feat and gave nothing back.
 *
 * `scripts/skill-clause-check.mjs` (in `npm run verify`) holds the family at zero by reading the SHAPE
 * of each entry. These tests are the other half: that those shapes actually reach a built character.
 * The guard alone would pass on a field authored where no reader looks, which is exactly how the
 * clause failed on Pure Legion Enforcer — a flag set, greppable, and inert.
 */

/** Take a dedication in the class-feat slot of its own level, with `over` supplying the scenario. */
const withDedication = (featId: string, level: number, over: Partial<BuildState> = {}) =>
  build('fighter', level, { featPicks: { [`${level}:class`]: featId }, ...over } as Partial<BuildState>);

describe('the "already trained in both" clause', () => {
  it('Jalmeri Heavenseeker: expert in the pick when both options were already trained', () => {
    /* *"You become trained in either Acrobatics or Occultism; if you were already trained in both
     * these skills, you become an expert in one of them instead."* */
    const fresh = withDedication('jalmeri-heavenseeker-dedication', 4, {
      featSkillChoices: { 'jalmeri-heavenseeker-dedication:0': 'occultism' },
    });
    expect(fresh.proficiencies.skills.occultism).toBe('trained');

    const already = withDedication('jalmeri-heavenseeker-dedication', 4, {
      classSkills: ['occultism', 'acrobatics'],
      featSkillChoices: { 'jalmeri-heavenseeker-dedication:0': 'occultism' },
    });
    expect(already.proficiencies.skills.occultism, 'the clause pays out as expert, not as nothing').toBe('expert');
  });

  it('Guerrilla: the same clause, the same payout', () => {
    const already = withDedication('guerrilla-dedication', 2, {
      classSkills: ['deception', 'thievery'],
      featSkillChoices: { 'guerrilla-dedication:0': 'deception' },
    });
    expect(already.proficiencies.skills.deception).toBe('expert');
  });

  it('Fighter Dedication: a replacement PICK is offered, and granting follows the answer', () => {
    /* *"…if you are already trained in both of these skills, you instead become trained in a skill of
     * your choice."* The offer is what the builder renders; the grant follows the answer. */
    const already = withDedication('fighter-dedication', 2, {
      classSkills: ['acrobatics', 'athletics'],
      featSkillChoices: { 'fighter-dedication:0': 'athletics' },
    });
    expect(already.skillFallbacks?.some((f) => f.featId === 'fighter-dedication')).toBe(true);

    const answered = withDedication('fighter-dedication', 2, {
      classSkills: ['acrobatics', 'athletics'],
      featSkillChoices: { 'fighter-dedication:0': 'athletics', 'fighter-dedication:fallback:athletics': 'medicine' },
    });
    expect(answered.proficiencies.skills.medicine).toBe('trained');
  });

  it('Ghost Hunter: the replacement is a new LORE, not one of the sixteen skills', () => {
    /*
     * *"Pick Spirit Lore or Haunt Lore… If you were already trained in both skills, you become trained
     * in a new Lore skill of your choice."* The fallback branch skips `lore:` keys — correctly, since an
     * OPEN Lore grant is always a new skill — which silently excluded the one record whose options are
     * two NAMED Lores. `loreFallback` lifts the exclusion for that slot only.
     */
    /* The Rivethun Adherent background trains Spirit Lore, so the pick really is redundant — no test
     * fixture reaches in to set a rank the game could not have given the character. */
    const already = withDedication('ghost-hunter-dedication', 2, {
      backgroundId: 'rivethun-adherent',
      featSkillChoices: { 'ghost-hunter-dedication:0': 'lore:spirit' },
      featLoreChoices: { 'ghost-hunter-dedication:fallback:lore:spirit': 'Warfare' },
    } as Partial<BuildState>);
    expect(already.proficiencies.skills['lore:spirit'], 'the background must really have trained it').toBe('trained');
    const fb = already.skillFallbacks?.find((f) => f.featId === 'ghost-hunter-dedication');
    expect(fb?.lore, 'the builder needs to know to render a Lore input, not a skill select').toBe(true);
    expect(already.proficiencies.skills['lore:warfare']).toBe('trained');
  });

  it('Pure Legion Enforcer: the third step waits for EXPERT in both, and yields one pick', () => {
    /*
     * *"You become trained in Intimidation and Religion. If you are already trained in one or both of
     * these skills, you become an expert in that skill. If you are already an expert in both skills,
     * you become trained in a skill of your choice."*
     *
     * The record used to carry a record-wide `redundantFallback`, which reads as modelled and reached
     * no reader at all: that flag needs either a static `skills` map or a choice slot, and this record
     * has neither.
     */
    const trained = withDedication('pure-legion-enforcer-dedication', 6, { classSkills: ['intimidation', 'religion'] });
    expect(trained.proficiencies.skills.intimidation, 'step two: trained becomes expert').toBe('expert');
    expect(
      trained.skillFallbacks?.some((f) => f.featId === 'pure-legion-enforcer-dedication'),
      'step three is owed to EXPERT in both, and these are only trained',
    ).toBeFalsy();
  });
});
