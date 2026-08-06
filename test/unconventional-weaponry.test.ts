import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { FEAT_GRANTS } from '../src/rules/featGrants';
import type { BuildState } from '../src/rules/build';
import type { Character, WeaponItem } from '../src/rules/types';

/**
 * Unconventional Weaponry / Unconventional Expertise.
 *
 * The weapon is the PLAYER'S — recorded under a choice flag — so no static `weapons` list could name
 * it, and the base feat shipped marked "Recorded only: … proficiency … not applied". Unconventional
 * Expertise then advances "the weapon you chose for Unconventional Weaponry", a DIFFERENT feat.
 */
const db = content();
const FLAG_SLOT = '1:class';

/** A fighter (trained in all martial) who took the feats and chose `weaponId`. */
const withWeapon = (weaponId: string, opts: { expertise?: boolean; level?: number } = {}): Character => {
  const { expertise = false, level = 13 } = opts;
  return build('fighter', level, {
    featPicks: { [FLAG_SLOT]: 'unconventional-weaponry', ...(expertise ? { '13:class': 'unconventional-expertise' } : {}) },
    featChoices: { [FLAG_SLOT]: weaponId },
  } as Partial<BuildState>);
};

const rankOf = (c: Character, weaponId: string) => c.proficiencies.weaponOverrides?.[weaponId] ?? 'untrained';

describe('the grant is wired to the choice, not to a fixed list', () => {
  it('both feats resolve the same choice flag', () => {
    expect(db.feats['unconventional-weaponry'].choice?.flag).toBe('unconventionalWeapon');
    for (const id of ['unconventional-weaponry', 'unconventional-expertise']) {
      expect(FEAT_GRANTS[id]?.weaponFamiliarity?.weaponFromChoiceFlag, id).toBe('unconventionalWeapon');
    }
  });

  it('nothing is granted before a weapon is chosen', () => {
    const c = build('fighter', 13, { featPicks: { [FLAG_SLOT]: 'unconventional-weaponry' } } as Partial<BuildState>);
    expect(Object.keys(c.proficiencies.weaponOverrides ?? {})).toEqual([]);
  });
});

describe('"you treat it as a simple weapon"', () => {
  const MARTIAL = 'mattock-of-the-titans'; // uncommon martial

  it('the test weapon is what the feat describes', () => {
    const w = db.items[MARTIAL] as WeaponItem;
    expect(w.itemType).toBe('weapon');
    expect(w.category).toBe('martial');
    expect(w.rarity).toBe('uncommon');
  });

  it('an uncommon MARTIAL weapon tracks the SIMPLE rank', () => {
    const c = withWeapon(MARTIAL);
    expect(rankOf(c, MARTIAL)).toBe(c.proficiencies.attacks.simple);
  });

  it('an uncommon ADVANCED weapon tracks the MARTIAL rank instead', () => {
    const ADVANCED = 'heavenly-rolling-flames';
    expect((db.items[ADVANCED] as WeaponItem).category).toBe('advanced');
    const c = withWeapon(ADVANCED);
    expect(rankOf(c, ADVANCED)).toBe(c.proficiencies.attacks.martial);
  });

  it('only the CHOSEN weapon is touched', () => {
    const c = withWeapon(MARTIAL);
    expect(Object.keys(c.proficiencies.weaponOverrides ?? {})).toEqual([MARTIAL]);
  });
});

describe('Unconventional Expertise advances the same weapon', () => {
  const MARTIAL = 'mattock-of-the-titans';

  it('it reaches the best weapon-category rank, which the base feat does not', () => {
    // A 13th-level fighter is at least expert in martial and simple; Weapon Legend/Mastery pushes the
    // best category above `simple`, and the expertise feat follows it.
    const base = withWeapon(MARTIAL, { level: 13 });
    const adv = withWeapon(MARTIAL, { expertise: true, level: 13 });
    const best = (['simple', 'martial', 'advanced'] as const)
      .map((k) => adv.proficiencies.attacks[k])
      .reduce((a, b) => (['untrained', 'trained', 'expert', 'master', 'legendary'].indexOf(a) >= ['untrained', 'trained', 'expert', 'master', 'legendary'].indexOf(b) ? a : b));
    expect(adv.feats.some((f) => f.featId === 'unconventional-expertise')).toBe(true);
    expect(rankOf(adv, MARTIAL)).toBe(best);
    // It never LOWERS what the base feat gave.
    const order = ['untrained', 'trained', 'expert', 'master', 'legendary'];
    expect(order.indexOf(rankOf(adv, MARTIAL))).toBeGreaterThanOrEqual(order.indexOf(rankOf(base, MARTIAL)));
  });
});

describe('the note now tells the truth', () => {
  it('it no longer claims the proficiency is unapplied', () => {
    const note = db.feats['unconventional-weaponry'].choice?.inert ?? '';
    expect(note).toMatch(/access/i);
    expect(note, 'the proficiency half works now').not.toMatch(/proficiency (are|is) not applied/i);
  });
});
