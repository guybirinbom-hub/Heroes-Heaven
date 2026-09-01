import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { FEAT_PICK_GRANTS } from '../src/rules/featPickGrants';
import { FEAT_FEAT_GRANTS } from '../src/rules/featFeatGrants';
import type { BuildState } from '../src/rules/build';

const db = content();

/**
 * "YOU GAIN THE QUICK REPAIR SKILL FEAT. IF YOU ALREADY HAVE THAT FEAT, YOU GAIN A DIFFERENT
 * 1ST-LEVEL SKILL FEAT YOU QUALIFY FOR INSTEAD."
 *
 * Only the first branch shipped. `FEAT_FEAT_GRANTS['engine-bay'] = ['quick-repair']` hands the feat
 * over, and the granted-feat walk dedupes against feats the character already holds — so someone who
 * arrived with Quick Repair had the grant silently dropped and got NOTHING in its place. That silence
 * is the entire content of the printed "instead", and it is the half a player only notices by counting
 * the feats they were owed.
 *
 * The two branches are mutually exclusive by construction: `onlyIfHasFeat` is true exactly when the
 * static grant is dropped as a duplicate, so a character can never collect both.
 */
describe('Engine Bay delivers its "instead" branch', () => {
  const withEngineBay = (extra: Record<string, string> = {}, picks: Record<string, string> = {}) =>
    build('fighter', 4, {
      featPicks: { '2:class:0': 'engine-bay', ...extra },
      pickFeatChoices: picks,
    } as Partial<BuildState>);

  it('the record still grants Quick Repair outright — the first branch is untouched', () => {
    expect(FEAT_FEAT_GRANTS['engine-bay']).toContain('quick-repair');
    expect(withEngineBay().feats.map((f) => f.featId)).toContain('quick-repair');
  });

  it('…and offers NO replacement picker to a character who did not already have it', () => {
    /* The gate is the whole point: a character getting Quick Repair from the feat is not owed a
     * second feat as well. */
    const spec = FEAT_PICK_GRANTS['engine-bay'];
    expect(spec?.onlyIfHasFeat).toBe('quick-repair');
    const plain = withEngineBay({}, { 'engine-bay': 'battle-medicine' });
    expect(plain.feats.map((f) => f.featId)).not.toContain('battle-medicine');
  });

  it('a character who ALREADY has Quick Repair gets the replacement they picked', () => {
    /* Quick Repair taken in its own skill slot, so the grant is the duplicate that gets dropped —
     * exactly the printed condition. */
    const c = withEngineBay({ '2:skill:0': 'quick-repair' }, { 'engine-bay': 'battle-medicine' });
    const ids = c.feats.map((f) => f.featId);
    expect(ids).toContain('quick-repair');
    expect(ids, 'the "instead" feat should arrive').toContain('battle-medicine');
  });

  it('the replacement can never be Quick Repair itself', () => {
    expect(FEAT_PICK_GRANTS['engine-bay']?.exclude).toContain('quick-repair');
    const c = withEngineBay({ '2:skill:0': 'quick-repair' }, { 'engine-bay': 'quick-repair' });
    /* Picking it changes nothing — it is already held, and one feat is not two. */
    expect(c.feats.filter((f) => f.featId === 'quick-repair')).toHaveLength(1);
  });

  it('the feat it names exists, so the gate can actually fire', () => {
    expect(db.feats['quick-repair']).toBeDefined();
    expect(db.feats['battle-medicine']?.level).toBeLessThanOrEqual(1);
  });
});
