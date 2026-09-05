import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { FEAT_GRANTS } from '../src/rules/featGrants';
import type { BuildState } from '../src/rules/build';

/*
 * BATCH 29 INSTRUMENT FALLOUT — "…OR AN EXPERT IF YOU WERE ALREADY TRAINED".
 *
 * Fixing `theirAssertions` to ACCUMULATE (their second operation on a track no longer overwrites the
 * first) made Wanderer's Guide's two ops per dedication option visible at once, and eight dedications
 * then reported `theirs=expert ours=trained`. Seven of the eight already delivered the upgrade — the
 * comparer read only the slot's flat `rank` and never its `conditionalRank`, which is where the
 * printed clause lives. Magic Warrior Dedication was the one real gap.
 *
 * *"You become trained in your choice of Arcana or Nature and in Magic Warrior Lore; IF YOU WERE
 * ALREADY TRAINED IN THE SKILL, YOU BECOME AN EXPERT INSTEAD."* (AoN feat-903.)
 *
 * Asserted on BUILT characters and in both directions, because a conditional grant that fires for
 * everyone is as wrong as one that fires for nobody.
 */
const db = content();

/** Every dedication whose printed sentence carries the clause, checked as a class so the lane cannot
 *  lose a record silently — each was read against its own AoN entry in this batch. */
const CLAUSE_DEDICATIONS = [
  'student-of-perfection-dedication',
  'magic-warrior-dedication',
  'magaambyan-attendant-dedication',
  'captivator-dedication',
  'marshal-dedication',
  'lion-blade-dedication',
  'aldori-duelist-dedication',
  'hedge-mage-dedication',
] as const;

describe('the dedication skill CHOICE upgrades an already-trained pick', () => {
  it.each(CLAUSE_DEDICATIONS)('%s carries the upgrade on the slot, not just the Lore', (id) => {
    const slot = FEAT_GRANTS[id]?.skillChoices?.[0];
    expect(slot, `${id} must offer the printed choice`).toBeTruthy();
    expect(slot?.conditionalRank, `${id} drops "or expert if you were already trained"`).toEqual({
      base: 'trained',
      upgraded: 'expert',
    });
  });

  /* A wizard is trained in Arcana off the class chassis, so the pick is redundant and the clause pays
   * the expert. Level 4 keeps the character below any skill increase that could reach expert on its
   * own — the assertion has to be the FEAT's doing. */
  it('a wizard who picks the skill they already have becomes an expert', () => {
    const before = build('wizard', 4, {} as unknown as Partial<BuildState>);
    expect(before.proficiencies.skills.arcana, 'the premise: already trained, not already expert').toBe('trained');

    const ch = build('wizard', 4, {
      featPicks: { '2:class': 'magic-warrior-dedication' },
      featSkillChoices: { 'magic-warrior-dedication:0': 'arcana' },
    } as unknown as Partial<BuildState>);
    expect(ch.proficiencies.skills.arcana).toBe('expert');
  });

  /* …and the mirror image. A fighter has no Arcana, so the same slot pays the base rank and nothing
   * more — the half of the sentence a flat `conditionalRank` reader would over-deliver. */
  it('a fighter who was not trained becomes trained, not expert', () => {
    const ch = build('fighter', 4, {
      featPicks: { '2:class': 'magic-warrior-dedication' },
      featSkillChoices: { 'magic-warrior-dedication:0': 'arcana' },
    } as unknown as Partial<BuildState>);
    expect(ch.proficiencies.skills.arcana).toBe('trained');
  });

  /* The OTHER option of the same slot, so the upgrade is not quietly hard-coded to the first one:
   * a druid is trained in Nature, and Nature is option 1. */
  it('the upgrade follows the pick, not the slot order', () => {
    const ch = build('druid', 4, {
      featPicks: { '2:class': 'magic-warrior-dedication' },
      featSkillChoices: { 'magic-warrior-dedication:0': 'nature' },
    } as unknown as Partial<BuildState>);
    expect(db.classes.druid.trainedSkills?.fixed, 'the premise: Nature comes off the druid chassis').toContain('nature');
    expect(ch.proficiencies.skills.nature).toBe('expert');
    expect(ch.proficiencies.skills.arcana ?? 'untrained', 'the option NOT picked gains nothing').toBe('untrained');
  });
});
