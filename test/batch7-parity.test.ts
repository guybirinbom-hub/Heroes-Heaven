import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { skillSubstitutions } from '../src/rules/derive';
import { statHasSituational } from '../src/rules/explain';
import { FEAT_SKILL_GRANTS } from '../src/rules/featGrantsAuto';
import { FEAT_FEAT_GRANTS } from '../src/rules/featFeatGrants';
import type { BuildState } from '../src/rules/build';

const db = content();

/**
 * Edgewatch Detective Dedication — the last record of the Wanderer's Guide parity batch 7.
 *
 * *"You become trained in Society or Thievery; if you are already trained in both of these skills, you
 * instead become trained in a skill of your choice. You can use Perception instead of Survival to
 * Track, and you gain the Experienced Tracker skill feat."*
 *
 * Three clauses. The feat grant shipped; the other two did not — the skill grant was three
 * unrestricted picks instead of one restricted one, and the Perception clause was nothing at all.
 */
describe('Edgewatch Detective Dedication', () => {
  it('offers ONE skill, from the pair the feat prints', () => {
    const slots = FEAT_SKILL_GRANTS['edgewatch-detective-dedication']?.skillChoices ?? [];
    expect(slots).toHaveLength(1);
    expect(slots[0].options).toEqual(['society', 'thievery']);
    expect(slots[0].rank).toBe('trained');
    // "if you are already trained in BOTH" — the clause lives on the SLOT, never record-wide: the
    // record-wide flag's reader is guarded on a static `skills` map this record does not have.
    expect(slots[0].redundantFallback).toBe(true);
    expect(FEAT_SKILL_GRANTS['edgewatch-detective-dedication']?.redundantFallback).toBeUndefined();
  });

  it('trains the picked skill and nothing beyond it', () => {
    const ch = build('fighter', 2, {
      featPicks: { '2:class': 'edgewatch-detective-dedication' } as BuildState['featPicks'],
      featSkillChoices: { 'edgewatch-detective-dedication:0': 'thievery' },
    } as Partial<BuildState>);
    expect(ch.proficiencies.skills.thievery).toBe('trained');
    // The two phantom slots used to hand out Acrobatics twice over (an unset `any` slot defaults to
    // Acrobatics), so a character got three trainings the feat never granted.
    const trained = Object.entries(ch.proficiencies.skills).filter(([, r]) => r !== 'untrained');
    expect(trained.length).toBeLessThan(8);
  });

  it('still grants Experienced Tracker', () => {
    expect(FEAT_FEAT_GRANTS['edgewatch-detective-dedication']).toContain('experienced-tracker');
  });

  it('carries the Perception substitution, conditioned on Tracking', () => {
    expect(db.feats['edgewatch-detective-dedication'].skillSubstitutions).toEqual([
      { use: 'perception', forSkill: 'survival', when: 'to Track' },
    ]);
  });

  it('surfaces it on the character, and does NOT rewrite the Survival row', () => {
    const ch = build('fighter', 2, {
      featPicks: { '2:class': 'edgewatch-detective-dedication' } as BuildState['featPicks'],
    } as Partial<BuildState>);
    const sub = skillSubstitutions(ch, db).find((s) => s.sourceId === 'edgewatch-detective-dedication');
    expect(sub).toMatchObject({ use: 'perception', forSkill: 'survival', when: 'to Track' });
    /*
     * A CONDITIONAL substitution is a note beside the skill, not a replacement of its number — the
     * clause only covers Tracking. Perception could never move a skill row anyway, which is why
     * `skillSubstituteFor` skips it explicitly rather than relying on the `when` guard.
     */
    expect(statHasSituational(ch, { kind: 'skill', skill: 'survival' }, db)).toBe(true);
  });
});
