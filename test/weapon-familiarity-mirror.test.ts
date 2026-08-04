import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { FEAT_GRANTS } from '../src/rules/featGrants';

/**
 * "You gain proficiency with all advanced bows as if they were MARTIAL weapons."
 *
 * The feat audit found four of these (Advanced Bow Training, Advanced Monastic Weaponry, Advanced
 * Firearm Familiarity, Advanced Shooter) and the only mirror the table had was `mirrorBestCategory`,
 * which takes the best of simple/martial/advanced. That is the ancestry-Expertise rule, not this one:
 * a caster with expert simple weapons and only trained martial would have had their advanced bows
 * pulled up to expert — an over-grant, which this project treats as worse than a gap.
 *
 * These pin the distinction rather than the four feats, so the next "as if they were martial" feat
 * cannot quietly get the wrong one.
 */
const ADVANCED_AS_MARTIAL = ['advanced-bow-training', 'advanced-monastic-weaponry', 'advanced-firearm-familiarity', 'advanced-shooter'];

describe('weaponFamiliarity mirrors the category the text names', () => {
  it('every "as if martial" feat mirrors martial specifically, never the best category', () => {
    for (const id of ADVANCED_AS_MARTIAL) {
      const wf = FEAT_GRANTS[id]?.weaponFamiliarity;
      expect(wf, `${id} has no weaponFamiliarity`).toBeDefined();
      expect(wf!.mirrorCategory, id).toBe('martial');
      expect(wf!.mirrorBestCategory, `${id} must not use the best-of rule`).toBeUndefined();
    }
  });

  it('every weapon named is a real advanced weapon of the group the feat names', () => {
    const db = content();
    const groupOf = (id: string) => db.items[id]?.group;
    for (const id of ADVANCED_AS_MARTIAL) {
      const weapons = FEAT_GRANTS[id]!.weaponFamiliarity!.weapons;
      expect(weapons.length, `${id} lists no weapons`).toBeGreaterThan(0);
      for (const w of weapons) {
        expect(db.items[w], `${id}: "${w}" is not an item in core.json`).toBeDefined();
        expect(db.items[w].category, `${id}: ${w} is not an advanced weapon`).toBe('advanced');
      }
    }
    for (const w of FEAT_GRANTS['advanced-bow-training']!.weaponFamiliarity!.weapons) expect(groupOf(w)).toBe('bow');
    for (const w of FEAT_GRANTS['advanced-firearm-familiarity']!.weaponFamiliarity!.weapons) expect(groupOf(w)).toBe('firearm');
    // Advanced Shooter is the only one spanning two groups: firearms AND crossbows.
    const shooter = FEAT_GRANTS['advanced-shooter']!.weaponFamiliarity!.weapons.map(groupOf);
    expect(new Set(shooter)).toEqual(new Set(['firearm', 'crossbow']));
  });

  it('a fighter with Advanced Bow Training shoots a daikyu at their martial rank, not untrained', () => {
    const ch = build('fighter', 6, { featPicks: { '6:class': 'advanced-bow-training' } });
    const martial = ch.proficiencies.attacks.martial;
    expect(martial).not.toBe('untrained');
    expect(ch.proficiencies.weaponOverrides?.daikyu).toBe(martial);
  });

  it('the mirror follows the MARTIAL rank even when another category is higher', () => {
    // A wizard is expert in simple weapons long before they are anything in martial. The best-of rule
    // would read that expert and hand it to the daikyu; the feat says martial, so the correct result
    // is the martial rank — and when that is untrained, no override at all.
    const ch = build('wizard', 12, { featPicks: { '6:class': 'advanced-bow-training' } });
    const { simple, martial } = ch.proficiencies.attacks;
    const got = ch.proficiencies.weaponOverrides?.daikyu;

    // Guard the premise: if this class ever trains martial to the same rank as simple the test proves
    // nothing, and we want to know rather than keep a green tick.
    expect(simple, 'premise: the wizard must be BETTER in simple than in martial').not.toBe(martial);
    expect(['untrained', 'trained']).toContain(martial);

    if (martial === 'untrained') expect(got).toBeUndefined();
    else expect(got).toBe(martial);
    expect(got, 'must not have been pulled up to the simple rank').not.toBe(simple);
  });
});
