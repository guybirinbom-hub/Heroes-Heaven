import { describe, expect, it } from 'vitest';
import { content, build } from './_content';

/**
 * "FOR THE PURPOSES OF PROFICIENCY, YOU TREAT ANY OF THESE THAT ARE MARTIAL WEAPONS AS SIMPLE WEAPONS
 *  AND ANY THAT ARE ADVANCED WEAPONS AS MARTIAL WEAPONS."
 *
 * A REMAP, not a grant of "trained", and it is worth real numbers: a class whose simple proficiency has
 * outrun its martial gets up to +4 to hit on its ancestry weapons compared with being flattened to
 * trained, and an advanced ancestry weapon moves a whole rank.
 *
 * 31 of the 40 records printing this clause carried NO weapon grant at all — the sentence reached the
 * sheet in no form whatsoever. Two halves were missing from the engine as well:
 *
 *   · `treatAsLowerCategory` was computed ONLY inside the chosen-weapon branch, so on a record with a
 *     static weapon list the field parsed, stored, and did nothing.
 *   · There was no way to say "weapons with the dwarf trait" — only named ids — although every one of
 *     these feats prints "weapons with the <ancestry> trait PLUS <three named weapons>".
 *
 * The demotion is per-WEAPON because these lists mix categories: a dwarf's battle axe is martial and
 * their scattergun is advanced, and one rank for the whole clause cannot serve both.
 */
const c = () => content();

describe('ancestry weapon familiarity', () => {
  const dwarf = (withFeat: boolean) =>
    build('fighter', 13, {
      ancestryId: 'dwarf',
      ...(withFeat ? { featPicks: { '1:ancestry:0': 'dwarven-weapon-familiarity' } } : {}),
    });

  it('demotes an ADVANCED ancestry weapon to the martial rank — the case that discriminates', () => {
    const con = c();
    expect(con.items['dwarven-scattergun']?.category).toBe('advanced');
    const without = dwarf(false);
    const withIt = dwarf(true);
    expect(withIt.feats.some((f) => f.featId === 'dwarven-weapon-familiarity')).toBe(true);
    // A 13th-level fighter: advanced expert, martial master. The remap is worth exactly one rank here.
    expect(without.proficiencies.attacks.advanced).toBe('expert');
    expect(without.proficiencies.weaponOverrides?.['dwarven-scattergun']).toBeUndefined();
    expect(withIt.proficiencies.weaponOverrides?.['dwarven-scattergun']).toBe(withIt.proficiencies.attacks.martial);
  });

  it('covers weapons reached only by the TRAIT half, not just the three named ones', () => {
    const con = c();
    const withIt = dwarf(true);
    // Not in critSpecWeapons.bases — it qualifies purely through the dwarf trait.
    expect((con.items['axe-of-the-dwarven-lords']?.traits ?? []).includes('dwarf')).toBe(true);
    expect(withIt.proficiencies.weaponOverrides?.['axe-of-the-dwarven-lords']).toBe(withIt.proficiencies.attacks.martial);
  });

  it('grants nothing without the feat', () => {
    const without = dwarf(false);
    expect(without.proficiencies.weaponOverrides?.['battle-axe']).toBeUndefined();
    expect(without.proficiencies.weaponOverrides?.['axe-of-the-dwarven-lords']).toBeUndefined();
  });

  /**
   * The ancestry entries were DERIVED from each record's own `critSpecWeapons`, so the NAMED weapons a
   * feat makes familiar and the ones it crit-specialises cannot drift apart.
   *
   * ⚠ Only the named weapons. The trait halves may legitimately differ, because they come from two
   * different printed sentences: Centaur Weapon Familiarity says "familiarity with the lance, longbow,
   * longspear, shortbow, and spear" with no trait clause at all, while its critical-specialisation
   * sentence does cover centaur-trait weapons. An earlier version of this test compared traits too and
   * failed on exactly that — the test was wrong, not the data.
   */
  it('names the same weapons for familiarity as for critical specialisation', async () => {
    const { FEAT_GRANTS } = await import('../src/rules/featGrants');
    const con = c();
    const mismatched: string[] = [];
    for (const [id, rec] of Object.entries(con.feats)) {
      const raw = (FEAT_GRANTS as Record<string, { weaponFamiliarity?: unknown }>)[id]?.weaponFamiliarity;
      const fam = (Array.isArray(raw) ? raw[0] : raw) as { weapons?: string[]; treatAsLowerCategory?: boolean } | undefined;
      const cw = (rec as { critSpecWeapons?: { bases?: string[] } }).critSpecWeapons;
      if (!fam?.treatAsLowerCategory || !cw?.bases?.length || !fam.weapons?.length) continue;
      const a = JSON.stringify([...fam.weapons].sort());
      const b = JSON.stringify([...cw.bases].sort());
      if (a !== b) mismatched.push(`${id}\n     familiarity ${a}\n     critSpec    ${b}`);
    }
    expect(mismatched, 'a feat names different weapons for familiarity than for crit spec').toEqual([]);
  });
});
