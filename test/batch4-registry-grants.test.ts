import { describe, it, expect } from 'vitest';
import { build } from './_content';

/**
 * TWO BATCH-4 GRANTS THAT LIVE IN CODE, ASSERTED ON A BUILT CHARACTER.
 *
 * Munitions Crafter and Remnants of the Past both came back from the parity read looking bare — their
 * records carry nothing but an actionCost, while Wanderer's Guide encodes `adjValue SKILL_CRAFTING`
 * plus a giveAbilityBlock, and two giveAbilityBlocks, respectively. The grants do exist, in the
 * featGrantsAuto / featFeatGrants / formulaBook registries.
 *
 * "The registry has an entry" is not the same claim as "the character gets it", and this project's
 * most repeated defect is precisely the gap between those two — an id that no longer matches a record,
 * a lane whose reader was never wired up, a table written but never read. So the verdict is recorded
 * against a BUILD, not against a grep.
 */
describe('batch 4: code-registry grants reach the character', () => {
  it('Munitions Crafter trains Crafting and grants Alchemical Crafting', () => {
    /* Their encoding: adjValue SKILL_CRAFTING = "T", plus a giveAbilityBlock. */
    const c = build('fighter', 4, { featPicks: { '1:class:0': 'munitions-crafter' } });
    expect(c.proficiencies.skills.crafting, 'the trained Crafting half of the feat').not.toBe('untrained');
    expect(c.feats.map((f) => f.featId)).toContain('alchemical-crafting');
  });

  it('Remnants of the Past grants both of the feats it names', () => {
    /* Their encoding: two giveAbilityBlocks. Ours: featFeatGrants ['adopted-ancestry','additional-lore']. */
    const c = build('fighter', 4, { featPicks: { '1:class:0': 'remnants-of-the-past' } });
    const ids = c.feats.map((f) => f.featId);
    expect(ids).toContain('adopted-ancestry');
    expect(ids).toContain('additional-lore');
  });

  it('…and a character without the feats gets neither — the control', () => {
    const bare = build('fighter', 4, {});
    const ids = bare.feats.map((f) => f.featId);
    expect(ids).not.toContain('alchemical-crafting');
    expect(ids).not.toContain('additional-lore');
  });
});
