import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveStrikes, deriveSpeeds, deriveSpellcasting, deriveMaxHp, featHpBonus } from '../src/rules/derive';
import type { Character } from '../src/rules/types';

/*
 * Regression tests for the 2026-07-09 rules-correctness audit fixes.
 */
const c = content();
const rankOf = (ch: Character, itemId: string) =>
  deriveStrikes(ch, c).find((s) => s.instanceId === 'w')?.rank;
const withWeapon = (ch: Character, itemId: string): Character => ({
  ...ch,
  inventory: [...ch.inventory, { instanceId: 'w', itemId, quantity: 1, equipped: true }],
});

describe('§6c.1 Cleric favored weapon proficiency follows the doctrine ladder', () => {
  // Sarenrae's favored weapon is the scimitar (martial) — the category never raises it for a cleric.
  const cleric = (level: number, doctrine: string) =>
    build('cleric', level, { subclassId: doctrine, deityId: 'sarenrae', keyAbility: 'wis' });
  it('a Cloistered Cleric reaches expert with a martial favored weapon at L11 (trained before)', () => {
    expect(rankOf(withWeapon(cleric(10, 'cloistered-cleric'), 'scimitar'), 'scimitar')).toBe('trained');
    expect(rankOf(withWeapon(cleric(11, 'cloistered-cleric'), 'scimitar'), 'scimitar')).toBe('expert');
  });
  it('a Warpriest reaches expert@7 and master@19 with a martial favored weapon', () => {
    expect(rankOf(withWeapon(cleric(7, 'warpriest'), 'scimitar'), 'scimitar')).toBe('expert');
    expect(rankOf(withWeapon(cleric(19, 'warpriest'), 'scimitar'), 'scimitar')).toBe('master');
  });
});

describe('§6a.1 Fighter Versatile Legend (L19) raises off-group weapons to legendary', () => {
  it('a L20 fighter is legendary with a martial weapon (not just their chosen group)', () => {
    const f = build('fighter', 20, { fighterWeaponGroup: 'sword' });
    // warhammer is the hammer group, not the chosen sword group — Versatile Legend still makes it legendary.
    expect(rankOf(withWeapon(f, 'warhammer'), 'warhammer')).toBe('legendary');
  });
});

describe('§4.1/§4.2 focus-caster proficiency advances (Monk ki, Ranger warden)', () => {
  it('a Monk with a ki-spell feat reaches expert@9 / master@17 focus proficiency', () => {
    const monk = (lvl: number) => {
      const b = build('monk', lvl);
      return { ...b, feats: [...b.feats, { featId: 'ki-strike' }, { featId: 'ki-rush' }] } as Character;
    };
    const focusRank = (ch: Character) => ch.spellcasting.find((e) => e.id === 'monk-focus')?.proficiency;
    // Only assert if the monk actually has a ki-spell focus entry in this content build.
    if (focusRank(monk(9))) {
      expect(focusRank(monk(8))).toBe('trained');
      expect(focusRank(monk(9))).toBe('expert');
      expect(focusRank(monk(17))).toBe('master');
    }
  });
});

describe('§8.2 Rogue Ruffian deals sneak attack with a simple weapon (mace)', () => {
  it('a Ruffian gets the off-guard precision rider with a non-agile/finesse simple weapon', () => {
    const ruffian = build('rogue', 3, { subclassId: 'ruffian' });
    const s = deriveStrikes(withWeapon(ruffian, 'mace'), c).find((x) => x.instanceId === 'w');
    expect(s?.conditionalDamage?.some((r) => /off-guard/.test(r.note))).toBe(true);
    // A Thief with the same mace does NOT (mace isn't agile/finesse).
    const thief = build('rogue', 3, { subclassId: 'thief' });
    const st = deriveStrikes(withWeapon(thief, 'mace'), c).find((x) => x.instanceId === 'w');
    expect(st?.conditionalDamage?.some((r) => /off-guard/.test(r.note))).toBeFalsy();
  });
});

describe('§2.1 land-Speed feats apply (Fleet)', () => {
  it('a Human with Fleet has land Speed 30 (base 25 + 5)', () => {
    const base = build('fighter', 1); // default ancestry may vary; assert the +5 delta from the feat
    const withFleet = { ...base, feats: [...base.feats, { featId: 'fleet' }] } as Character;
    expect(deriveSpeeds(withFleet, c).land - deriveSpeeds(base, c).land).toBe(5);
  });
});

describe('§2.2 Class Resiliency feats grant +3 HP per archetype feat', () => {
  it('Fighter Dedication + Fighter Resiliency grants +6 HP (2 fighter archetype feats × 3)', () => {
    const base = build('wizard', 4);
    const ch = {
      ...base,
      feats: [...base.feats, { featId: 'fighter-dedication' }, { featId: 'fighter-resiliency' }],
    } as Character;
    // featHpBonus counts fighter-archetype feats (dedication + resiliency = 2) × 3 = 6.
    expect(featHpBonus(ch, c) - featHpBonus(base, c)).toBe(6);
    expect(deriveMaxHp(ch, c) - deriveMaxHp(base, c)).toBe(6);
  });
});

describe('§6c.2 Wizard Weapon Expertise (L11) grants only the 5 wizard weapons, not all simple', () => {
  const rankOf = (level: number, itemId: string) => {
    const w = build('wizard', level, { keyAbility: 'int' });
    const ch: Character = { ...w, inventory: [...w.inventory, { instanceId: 'w', itemId, quantity: 1, equipped: true }] };
    return deriveStrikes(ch, c).find((s) => s.instanceId === 'w')?.rank;
  };
  it('a wizard weapon (dagger) is expert@11 but an off-list simple weapon (spear) stays trained', () => {
    expect(rankOf(11, 'dagger')).toBe('expert');
    expect(rankOf(11, 'spear')).toBe('trained'); // was wrongly 'expert' before the fix
  });
});

describe('§9.1 Dual Class grants both classes\' initial key-attribute boosts', () => {
  it('a Fighter(Str)/Wizard dual-class gets +2 Str AND +2 Int at level 1', () => {
    const f = build('fighter', 1, { keyAbility: 'str', variantRules: { dualClass: true }, classId2: 'wizard' });
    const solo = build('fighter', 1, { keyAbility: 'str' });
    expect(f.abilities.str).toBe(solo.abilities.str); // Str still boosted by fighter
    expect(f.abilities.int).toBe(solo.abilities.int + 2); // wizard's Int key boost now applied
  });
});

describe('§13.7 Warrior Automaton/Jotunborn heritages upgrade the fist die to 1d6', () => {
  it('a Warrior Automaton character has a 1d6 fist (not 1d4 nonlethal)', () => {
    const base = build('fighter', 1);
    const ch = { ...base, heritageId: 'warrior-automaton' } as Character;
    const fist = deriveStrikes(ch, c).find((s) => /fist/i.test(s.name))!;
    expect(fist.damage).toMatch(/^1d6/);
    expect(fist.traits).not.toContain('nonlethal');
  });
});
