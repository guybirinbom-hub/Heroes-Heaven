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

  it('Untrained Improvisation makes it your level minus 2', () => {
    const ch = build('fighter', 10, { featPicks: { '3:general': 'untrained-improvisation' } });
    expect(untrainedSkillBonus(ch, db)).toBe(8);
    const key = anUntrainedSkill(ch);
    expect(deriveSkill(ch, key, db).modifier).toBe(abilityMod(ch.abilities[skillAbilityOf(key)]) + 8);
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
    expect(db.feats['untrained-improvisation'].untrainedProficiency).toEqual({ levelMinus: 2 });
    expect(db.feats['eclectic-skill'].untrainedProficiency).toEqual({ levelMinus: 0 });
  });
});

/** The ability a skill keys off — mirrors derive's own map for the few skills used above. */
function skillAbilityOf(key: ProficiencyKey): 'int' | 'wis' | 'dex' {
  if (key === 'nature' || key === 'religion') return 'wis';
  if (key === 'thievery') return 'dex';
  return 'int';
}
