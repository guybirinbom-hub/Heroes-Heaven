import { describe, it, expect } from 'vitest';
import { build } from './_content';
import { FEAT_GRANTS } from '../src/rules/featGrants';
import type { BuildState } from '../src/rules/build';

/**
 * "…YOU ALSO GAIN THAT PROFICIENCY IN THE ARMOR TYPES GRANTED TO YOU BY THIS FEAT."
 *
 * Sentinel Dedication and Mountain Skin both print that sentence, and neither had a carrier: the
 * categories they grant sat at `trained` for the character's whole career. A 13th-level fighter with
 * Sentinel Dedication wore medium armour at TRAINED while their own class had made them a master of
 * it — the feat's second sentence delivered nothing for twelve levels.
 *
 * `armorMirrorBest` is the armour twin of `weaponFamiliarity.mirrorBestCategory`, and like it, it is
 * applied AFTER class advancement — which is precisely when "whenever you gain a class feature that
 * grants you expert or greater proficiency" has finished happening.
 */
describe('armour mirroring follows the class rank, as both records print', () => {
  const withFeat = (classId: string, level: number, featId: string) =>
    build(classId, level, { featPicks: { '2:class:0': featId } } as Partial<BuildState>);

  it('both records carry the lane', () => {
    expect(FEAT_GRANTS['sentinel-dedication']?.armorMirrorBest).toEqual(['light', 'medium', 'heavy']);
    expect(FEAT_GRANTS['mountain-skin']?.armorMirrorBest).toEqual(['medium', 'heavy']);
  });

  it("Sentinel Dedication's medium armour tracks the fighter's own ladder, not a frozen `trained`", () => {
    /* A fighter is expert in all armour at 11th and master at 19th. The dedication grants light and
     * medium at trained; the printed clause says they rise with the class. */
    const low = withFeat('fighter', 2, 'sentinel-dedication');
    const high = withFeat('fighter', 13, 'sentinel-dedication');
    expect(low.proficiencies.defenses.medium).toBe('trained');
    expect(high.proficiencies.defenses.medium).not.toBe('trained');
    expect(high.proficiencies.defenses.medium).toBe(high.proficiencies.defenses.light);
  });

  it('…and it only ever RAISES — a character who never earned heavy keeps what they had', () => {
    const c = withFeat('fighter', 2, 'sentinel-dedication');
    /* At 2nd level nothing has granted expert anywhere, so the mirror is a no-op rather than a
     * promotion: the test would pass vacuously if the mirror invented a rank. */
    expect(c.proficiencies.defenses.heavy).toBe(
      c.proficiencies.defenses.heavy === 'untrained' ? 'untrained' : 'trained',
    );
  });

  /*
   * ⚠ THE PARENTHESIS IS THE POINT. Mountain Skin prints *"any armor (BUT NOT UNARMORED DEFENSE)"*.
   * A monk reaches legendary UNARMORED defence and never advances armour at all, so if unarmored fed
   * the mirror, this feat would hand a monk legendary HEAVY armour — the single reading the printed
   * parenthesis exists to forbid.
   */
  it('unarmored defence never feeds the mirror, however high it climbs', () => {
    const monk = withFeat('monk', 19, 'mountain-skin');
    const unarmored = monk.proficiencies.defenses.unarmored;
    expect(unarmored, 'a 19th-level monk should be well past trained unarmored').not.toBe('trained');
    expect(unarmored).not.toBe('untrained');
    /* Heavy tracks the best of light/medium/heavy — all of which a monk leaves at the feat's own
     * trained — and must NOT have followed unarmored up. */
    expect(monk.proficiencies.defenses.heavy).toBe('trained');
  });
});
