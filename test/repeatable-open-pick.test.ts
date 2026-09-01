import { describe, it, expect } from 'vitest';
import { build } from './_content';
import type { BuildState } from '../src/rules/build';

/*
 * A REPEATABLE FEAT WHOSE PICK IS *OPEN* — the four records the lane move could not reach.
 *
 * 21 repeatable records held a granting pick on `effectChoices`, whose answer is stored once per
 * (record, choiceId), so every taking read the same answer and takes 2..N granted a duplicate. They
 * were moved to the record's own `choice`, which is keyed by SLOT.
 *
 * Qi Spells, Grandmaster Qi Spells and the two Esoteric Spellcasting feats could not follow: their pick
 * is a `spellFilter` — *"choose a 1st-rank monk qi spell"* — and `choice` has no such field, so there
 * was nowhere to move it to. For those the ANSWER KEY became per-taking instead of the lane moving.
 *
 * Both halves are asserted here, because either alone looks like success: the engine reading a slot
 * key is useless if the builder never writes one, and vice versa.
 */
describe('a repeatable feat with an OPEN spell pick', () => {
  const monk = (answers: Record<string, string>) =>
    build('monk', 8, {
      featPicks: { '1:class': 'qi-spells', '4:class': 'qi-spells' },
      effectChoices: answers,
    } as Partial<BuildState>);

  const focusOf = (c: ReturnType<typeof build>) =>
    new Set(c.spellcasting?.filter((e) => e.type === 'focus').flatMap((e) => Object.values(e.repertoire ?? {}).flat()) ?? []);

  it('two takings answered per SLOT learn two different qi spells', () => {
    const c = monk({ '1:class:qi-spell': 'inner-upheaval', '4:class:qi-spell': 'qi-rush' });
    const focus = focusOf(c);
    expect(focus.has('inner-upheaval'), 'the first taking').toBe(true);
    expect(focus.has('qi-rush'), 'the second taking must not overwrite the first').toBe(true);
  });

  it('an answer stored the OLD way still works — a character built before this keeps their spell', () => {
    /*
     * The record key is read as a fallback. Without it, migrating the key would have silently emptied
     * every existing monk's qi spell, which is a worse defect than the one being fixed.
     */
    const c = monk({ 'qi-spells:qi-spell': 'inner-upheaval' });
    expect(focusOf(c).has('inner-upheaval')).toBe(true);
  });
});
