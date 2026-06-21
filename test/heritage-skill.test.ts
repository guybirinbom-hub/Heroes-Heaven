import { describe, it, expect } from 'vitest';
import { build } from './_content';

// Regression for the audit finding: a Skilled human's "trained in one skill of your choice"
// had no picker, so the skill was silently lost. With a heritageSkill set, buildCharacter
// trains it (and bumps it to expert at level 5).
describe('Skilled heritage trained skill', () => {
  it('grants the chosen skill as trained at level 1', () => {
    const ch = build('fighter', 1, { ancestryId: 'human', heritageId: 'skilled-human', heritageSkill: 'stealth' });
    expect(ch.proficiencies.skills['stealth']).toBe('trained');
  });
  it('bumps it to expert at level 5', () => {
    const ch = build('fighter', 5, { ancestryId: 'human', heritageId: 'skilled-human', heritageSkill: 'stealth' });
    expect(ch.proficiencies.skills['stealth']).toBe('expert');
  });
});
