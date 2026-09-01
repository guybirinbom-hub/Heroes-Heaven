import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveSkill, abilityMod, untrainedSkillBonus } from '../src/rules/derive';
import type { Character, ProficiencyKey } from '../src/rules/types';

/**
 * "Your proficiency bonus to untrained skill checks is equal to your level –2."
 *
 * An untrained skill scored a flat 0 proficiency with no way to say otherwise, so Untrained
 * Improvisation and Eclectic Skill — whose entire content is that sentence — changed no number.
 */
const db = content();

/** A skill this character is genuinely untrained in, so the test measures what it means to. */
const anUntrainedSkill = (ch: Character): ProficiencyKey =>
  (['occultism', 'arcana', 'nature', 'religion', 'crafting', 'thievery'] as ProficiencyKey[]).find(
    (k) => (ch.proficiencies.skills[k] ?? 'untrained') === 'untrained',
  )!;

describe('untrained skill proficiency', () => {
  it('is 0 without one of these feats', () => {
    const ch = build('fighter', 10, {});
    expect(untrainedSkillBonus(ch, db)).toBeNull();
    const key = anUntrainedSkill(ch);
    expect(deriveSkill(ch, key, db).modifier).toBe(abilityMod(ch.abilities[skillAbilityOf(key)]));
  });

  /*
   * This case used to build a LEVEL 10 character and assert level−2. That is the feat's opening value,
   * not its value at 10th: *"This improves to your level –1 at 5th level and your full level at 7th."*
   * The −2 is now asserted at a level where it is actually the printed answer, and the improvements
   * have their own case below. Testing the opening value at 10th froze the missing half in place.
   */
  it('Untrained Improvisation makes it your level minus 2 before it improves', () => {
    const ch = build('fighter', 4, { featPicks: { '3:general': 'untrained-improvisation' } });
    expect(untrainedSkillBonus(ch, db)).toBe(2);
    const key = anUntrainedSkill(ch);
    expect(deriveSkill(ch, key, db).modifier).toBe(abilityMod(ch.abilities[skillAbilityOf(key)]) + 2);
  });

  it('Eclectic Skill makes it your full level', () => {
    const ch = build('investigator', 15, { featPicks: { '15:class': 'eclectic-skill' } });
    expect(untrainedSkillBonus(ch, db)).toBe(15);
  });

  it('it never LOWERS a trained skill', () => {
    const ch = build('fighter', 10, { featPicks: { '3:general': 'untrained-improvisation' } });
    const trained = (Object.keys(ch.proficiencies.skills) as ProficiencyKey[]).find(
      (k) => ch.proficiencies.skills[k] === 'trained',
    );
    if (!trained) return;
    const plain = build('fighter', 10, {});
    expect(deriveSkill(ch, trained, db).modifier).toBe(deriveSkill(plain, trained, db).modifier);
  });

  it('Proficiency Without Level is left alone — "equal to your level" has no meaning there', () => {
    const ch = build('fighter', 10, {
      featPicks: { '3:general': 'untrained-improvisation' },
      variantRules: { proficiencyWithoutLevel: true },
    });
    expect(untrainedSkillBonus(ch, db)).toBeNull();
  });

  it('the data carries both, with the printed subtraction', () => {
    /*
     * Untrained Improvisation prints THREE values, not one: *"equal to your level –2. This improves to
     * your level –1 at 5th level and your full level at 7th level."* Only the −2 was ever stored, so
     * the feat never improved and a 7th-level character stayed two points short of the printed bonus
     * for the rest of their career.
     */
    expect(db.feats['untrained-improvisation'].untrainedProficiency).toEqual({
      levelMinus: 2,
      steps: [
        { atLevel: 5, levelMinus: 1 },
        { atLevel: 7, levelMinus: 0 },
      ],
    });
    expect(db.feats['eclectic-skill'].untrainedProficiency, 'a flat "equal to your level" needs no steps').toEqual({ levelMinus: 0 });
  });

  it('Untrained Improvisation improves at 5th and again at 7th', () => {
    const at = (level: number) => untrainedSkillBonus(build('fighter', level, { featPicks: { '3:general': 'untrained-improvisation' } }), db);
    expect(at(4), 'level 4: 4 − 2, the opening subtraction').toBe(2);
    expect(at(5), 'level 5: −1 now').toBe(4);
    expect(at(6), 'still −1 the level before the next step').toBe(5);
    expect(at(7), 'level 7: the full level').toBe(7);
    expect(at(12), 'and it stays the full level').toBe(12);
  });
});

/** The ability a skill keys off — mirrors derive's own map for the few skills used above. */
function skillAbilityOf(key: ProficiencyKey): 'int' | 'wis' | 'dex' {
  if (key === 'nature' || key === 'religion') return 'wis';
  if (key === 'thievery') return 'dex';
  return 'int';
}
