import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveSkill } from '../src/rules/derive';
import type { BuildState } from '../src/rules/build';

const db = content();

/**
 * Officer's Medical Training: *"You are trained in Medicine and can use your Intelligence modifier in
 * place of your Wisdom modifier for Medicine checks."*
 *
 * `skillAbility()` is a fixed skill→attribute map with no override, so the clause shipped as a
 * `situational` NOTE — the sheet printed "use your Intelligence modifier" beside a Medicine number
 * still computed from Wisdom. Found by reading the Wanderer's Guide prose assertions, the one surface
 * no automated comparison covers.
 *
 * Measured before building: ONE record in the whole database prints an ability substitution, so this is
 * a field rather than a lane.
 */

const medicine = (ch: ReturnType<typeof build>) => deriveSkill(ch, 'medicine', db).modifier;

/** A character with the feat, and one without, at the same attributes. */
function pair(int: number, wis: number) {
  const attrs = { int, wis } as Partial<Record<string, number>>;
  const base = { abilityScores: attrs } as unknown as Partial<BuildState>;
  return {
    without: build('fighter', 1, base),
    with: build('fighter', 1, {
      ...base,
      featPicks: { '1:class': 'officers-medical-training' } as BuildState['featPicks'],
    }),
  };
}

describe('Officer’s Medical Training — Intelligence for Medicine', () => {
  it('is authored as a real field, not a display note', () => {
    const rec = db.feats['officers-medical-training'] as { skillAbilitySwap?: { skill: string; use: string }; situational?: unknown };
    expect(rec.skillAbilitySwap).toEqual({ skill: 'medicine', use: 'int' });
    // …and the prose that used to stand in for it is gone, so the clause is not printed twice.
    expect(rec.situational).toBeUndefined();
  });

  it('trains Medicine', () => {
    const ch = build('fighter', 1, { featPicks: { '1:class': 'officers-medical-training' } as BuildState['featPicks'] });
    expect(ch.proficiencies.skills.medicine).toBe('trained');
  });

  /*
   * The number is the point. A high-Intelligence, low-Wisdom character is exactly who takes this feat,
   * and before this their Medicine did not move at all.
   */
  it('raises Medicine when Intelligence beats Wisdom', () => {
    const { with: w } = pair(18, 10);
    const plain = build('fighter', 1, {
      abilityScores: { int: 18, wis: 10 },
      featPicks: { '1:class': 'intimidating-glare' } as BuildState['featPicks'],
    } as unknown as Partial<BuildState>);
    expect(medicine(w)).toBeGreaterThan(deriveSkill(plain, 'medicine', db).modifier + 1);
  });

  /* "CAN use" — an option, so a wiser character keeps Wisdom rather than being forced down to Int. */
  it('never lowers Medicine when Wisdom already beats Intelligence', () => {
    const { with: w, without } = pair(8, 18);
    expect(medicine(w)).toBeGreaterThanOrEqual(deriveSkill(without, 'medicine', db).modifier);
  });

  it('touches no other skill', () => {
    const { with: w, without } = pair(18, 10);
    for (const s of ['nature', 'survival', 'religion'] as const) {
      expect(deriveSkill(w, s, db).modifier).toBe(deriveSkill(without, s, db).modifier);
    }
  });
});
