import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { ownedFeatureIds } from '../src/rules/derive';

/**
 * A record no character can OWN is invisible, however carefully it is authored.
 *
 * `characterSituationalIds` is built from feats + ancestry + heritage + background + inventory +
 * ownedFeatureIds, and ownedFeatureIds read only cls.features, subclass variants, classChoices and
 * the inventor's modifications. A mythic calling is none of those — build.ts pushed the chosen one to
 * `grantedFeatures`, a display list nothing derives from. So every field on a calling record, every
 * situational star and every action/condition marker keyed on one rendered for nobody.
 *
 * The class-feature audit hit this repeatedly, and its adversaries dismissed real findings on the
 * ground — correctly, at the time.
 */
const db = content();
const CALLINGS = Object.entries(db.classFeatures)
  .filter(([, r]) => (r.traits ?? []).includes('calling'))
  .map(([id]) => id);

describe('a chosen mythic calling is owned', () => {
  it('the corpus really ships calling records', () => {
    expect(CALLINGS.length).toBeGreaterThanOrEqual(18);
  });

  it('choosing one puts it in ownedFeatureIds', () => {
    const id = CALLINGS[0];
    const ch = build('fighter', 10, { mythicEnabled: true, mythicCalling: id });
    expect(ch.mythicCalling, 'the build did not record the calling').toBe(id);
    expect(ownedFeatureIds(ch, db).has(id)).toBe(true);
  });

  it('every calling works, not just the first', () => {
    const missing = CALLINGS.filter((id) => {
      const ch = build('fighter', 10, { mythicEnabled: true, mythicCalling: id });
      return !ownedFeatureIds(ch, db).has(id);
    });
    expect(missing).toEqual([]);
  });

  it('a character without Mythic owns no calling', () => {
    const ch = build('fighter', 10, {});
    const owned = ownedFeatureIds(ch, db);
    expect(CALLINGS.filter((id) => owned.has(id))).toEqual([]);
  });

  it('choosing one calling does not own the others', () => {
    const [first, second] = CALLINGS;
    const ch = build('fighter', 10, { mythicEnabled: true, mythicCalling: first });
    const owned = ownedFeatureIds(ch, db);
    expect(owned.has(first)).toBe(true);
    expect(owned.has(second)).toBe(false);
  });
});
