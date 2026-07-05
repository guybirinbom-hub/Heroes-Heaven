import { describe, it, expect } from 'vitest';
import {
  MONSTER_PART_PROPERTIES,
  getMpProperty,
  propertiesForKind,
  resolvePath,
  refinementCost,
  itemLevelForValue,
  propertyLevelForValue,
  imbuedLevelCap,
  weaponRefinement,
  armorRefinement,
  shieldRefinement,
  senseSkillRefinement,
  imbueSlots,
  refinementBenefitsAt,
  salvageValue,
  transferCost,
  SALVAGE_FRACTION,
  TRANSFER_FRACTION,
  monsterPartApex,
  type MpProperty,
  type MpPath,
} from '../src/rules/monsterParts';
import type { MpItemKind } from '../src/rules/types';

const KINDS: MpItemKind[] = ['weapon', 'armor', 'shield', 'perception', 'skill'];

/** The highest structured additional/persistent damage a path resolves to at a given level. */
function dmgAt(path: MpPath, level: number) {
  return resolvePath(path, level);
}

describe('Monster Parts — catalog integrity', () => {
  it('has every property with required fields and well-formed paths', () => {
    expect(MONSTER_PART_PROPERTIES.length).toBeGreaterThanOrEqual(28);
    for (const p of MONSTER_PART_PROPERTIES) {
      expect(p.id, 'id').toBeTruthy();
      expect(p.name, `name for ${p.id}`).toBeTruthy();
      expect(p.appliesTo.length, `appliesTo for ${p.id}`).toBeGreaterThan(0);
      for (const k of p.appliesTo) expect(KINDS).toContain(k);
      expect(p.requirement, `requirement for ${p.id}`).toBeTruthy();
      expect(p.effect, `effect for ${p.id}`).toBeTruthy();
      // Every property must resolve to at least one path (Chaotic/Lawful inherit theirs).
      expect(p.paths.length, `paths for ${p.id}`).toBeGreaterThan(0);
      for (const path of p.paths) {
        expect(path.id, `path id for ${p.id}`).toBeTruthy();
        expect(path.levels.length, `levels for ${p.id}/${path.id}`).toBeGreaterThan(0);
        for (const lv of path.levels) {
          expect(lv.level, `level number for ${p.id}/${path.id}`).toBeGreaterThanOrEqual(1);
          expect(lv.level).toBeLessThanOrEqual(20);
          expect(lv.text, `text for ${p.id}/${path.id}@${lv.level}`).toBeTruthy();
        }
        // Level entries strictly ascend within a path.
        const levels = path.levels.map((l) => l.level);
        expect(levels).toEqual([...levels].sort((a, b) => a - b));
        expect(new Set(levels).size, `distinct levels for ${p.id}/${path.id}`).toBe(levels.length);
      }
    }
  });

  it('has unique property ids', () => {
    const ids = MONSTER_PART_PROPERTIES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves Chaotic/Lawful paths from Unholy/Holy', () => {
    const chaotic = getMpProperty('chaotic')!;
    const unholy = getMpProperty('unholy')!;
    expect(chaotic.paths.map((p) => p.id)).toEqual(unholy.paths.map((p) => p.id));
    const lawful = getMpProperty('lawful')!;
    const holy = getMpProperty('holy')!;
    expect(lawful.paths.map((p) => p.id)).toEqual(holy.paths.map((p) => p.id));
  });

  it('filters properties by item kind', () => {
    expect(propertiesForKind('weapon').some((p) => p.id === 'fire')).toBe(true);
    expect(propertiesForKind('weapon').some((p) => p.id === 'charisma')).toBe(false);
    expect(propertiesForKind('skill').some((p) => p.id === 'charisma')).toBe(true);
    expect(propertiesForKind('shield').some((p) => p.id === 'sturdy')).toBe(true);
    expect(propertiesForKind('perception').some((p) => p.id === 'sensory')).toBe(true);
  });

  it('marks each apex property at level 17 with its attribute', () => {
    for (const [id, ab] of [['charisma', 'cha'], ['strength', 'str'], ['dexterity', 'dex'], ['constitution', 'con'], ['intelligence', 'int'], ['wisdom', 'wis']] as const) {
      const p = getMpProperty(id)!;
      expect(p.apexAbility, id).toBe(ab);
      expect(p.apexLevel).toBe(17);
    }
  });
});

describe('Monster Parts — spot-checks transcribed from the ruleset', () => {
  it('Fire Might scales +1 → 1d4 → 1d6 → 1d8', () => {
    const might = getMpProperty('fire')!.paths.find((p) => p.id === 'might')!;
    expect(dmgAt(might, 4).addDamage).toMatchObject({ flat: 1, type: 'fire' });
    expect(dmgAt(might, 6).addDamage).toMatchObject({ dice: 1, die: 'd4', type: 'fire' });
    expect(dmgAt(might, 8).addDamage).toMatchObject({ dice: 1, die: 'd6', type: 'fire' });
    // Level 8 text mentions the crit 1d10 persistent fire rider.
    expect(dmgAt(might, 8).riders.find((r) => r.level === 8)!.text).toMatch(/1d10 persistent fire/);
    expect(dmgAt(might, 18).addDamage).toMatchObject({ dice: 1, die: 'd8', type: 'fire' });
  });

  it('Fire Technique starts at 1 persistent fire (L4)', () => {
    const tech = getMpProperty('fire')!.paths.find((p) => p.id === 'technique')!;
    expect(dmgAt(tech, 4).persistentDamage).toMatchObject({ flat: 1, type: 'fire', persistent: true });
    // and ignores resistance from L12.
    expect(dmgAt(tech, 12).ignoreResistance).toBe(true);
    expect(dmgAt(tech, 11).ignoreResistance).toBe(false);
  });

  it('Charisma gains the apex trait at level 17', () => {
    const main = getMpProperty('charisma')!.paths[0];
    expect(dmgAt(main, 17).riders.find((r) => r.level === 17)!.text).toMatch(/apex/i);
  });

  it('Vitality Might starts scaling at level 2 (holy/vitality weapon)', () => {
    const might = getMpProperty('vitality')!.paths.find((p) => p.id === 'might')!;
    expect(dmgAt(might, 2).addDamage).toMatchObject({ flat: 1, type: 'vitality' });
    expect(dmgAt(might, 4).addDamage).toMatchObject({ dice: 1, die: 'd4', type: 'vitality' });
  });

  it('Bane Might deals the weapon base type (untyped) vs the bane creature', () => {
    const might = getMpProperty('bane')!.paths.find((p) => p.id === 'might')!;
    expect(dmgAt(might, 2).addDamage).toMatchObject({ flat: 1, type: 'untyped' });
    expect(dmgAt(might, 20).addDamage).toMatchObject({ dice: 1, die: 'd10', type: 'untyped' });
  });
});

describe('Monster Parts — refinement tables', () => {
  it('weapon refinement: L4 = 2 dice/striking, L12 = greater striking, L19 = major', () => {
    expect(weaponRefinement(4)).toMatchObject({ attack: 1, extraDice: 1, imbueSlots: 1 });
    expect(weaponRefinement(12).extraDice).toBe(2); // greater striking
    expect(weaponRefinement(19).extraDice).toBe(3); // major striking
    expect(weaponRefinement(2)).toMatchObject({ attack: 1, extraDice: 0, imbueSlots: 1 });
    expect(weaponRefinement(16).attack).toBe(3);
    // Reference text spot-check.
    const l4 = refinementBenefitsAt(4, 'weapon');
    expect(l4.find((b) => b.level === 4)!.text).toMatch(/2 damage dice \(striking\)/);
    const l12 = refinementBenefitsAt(12, 'weapon');
    expect(l12.find((b) => b.level === 12)!.text).toMatch(/greater striking/);
  });

  it('armor / shield / perception / skill refinement track', () => {
    expect(armorRefinement(5)).toMatchObject({ ac: 1, saves: 0, imbueSlots: 1 });
    expect(armorRefinement(8).saves).toBe(1); // resilient
    expect(armorRefinement(20).saves).toBe(3); // major resilient
    expect(shieldRefinement(3)).toMatchObject({ hardness: 5, hp: 30, bt: 15 });
    expect(shieldRefinement(20)).toMatchObject({ hardness: 18, hp: 108, bt: 54, imbueSlots: 1 });
    expect(shieldRefinement(3).imbueSlots).toBe(0); // imbuing unlocks at L4
    expect(shieldRefinement(4).imbueSlots).toBe(1);
    expect(senseSkillRefinement(3)).toMatchObject({ bonus: 1, imbueSlots: 1 });
    expect(senseSkillRefinement(17).bonus).toBe(3);
    expect(imbueSlots('weapon', 16)).toBe(3);
    expect(imbueSlots('perception', 2)).toBe(0);
  });

  it('refine cost: weapon L6 = 250 gp, shield/skill L6 = 160 gp', () => {
    expect(refinementCost(6, 'weapon')).toBe(250);
    expect(refinementCost(6, 'armor')).toBe(250);
    expect(refinementCost(6, 'shield')).toBe(160);
    expect(refinementCost(6, 'skill')).toBe(160);
    expect(refinementCost(6, 'perception')).toBe(160);
    expect(refinementCost(1, 'weapon')).toBe(20);
    expect(refinementCost(20, 'weapon')).toBe(70000);
    expect(refinementCost(20, 'skill')).toBe(45000);
  });

  it('itemLevelForValue / propertyLevelForValue map gp → level by threshold', () => {
    // Weapon column: 250 gp = L6, 249 gp = L5.
    expect(itemLevelForValue(250, 'weapon')).toBe(6);
    expect(itemLevelForValue(249, 'weapon')).toBe(5);
    expect(itemLevelForValue(19, 'weapon')).toBe(0); // below L1
    expect(itemLevelForValue(20, 'weapon')).toBe(1);
    expect(itemLevelForValue(70000, 'weapon')).toBe(20);
    // Shield/skill column: 160 gp = L6.
    expect(propertyLevelForValue(160, 'skill')).toBe(6);
    expect(propertyLevelForValue(159, 'skill')).toBe(5);
  });

  it('imbuedLevelCap = min(item level, character level)', () => {
    expect(imbuedLevelCap(10, 6)).toBe(6);
    expect(imbuedLevelCap(4, 10)).toBe(4);
    expect(imbuedLevelCap(0, 10)).toBe(0);
  });
});

describe('Monster Parts — salvage / transfer', () => {
  it('salvage recovers 50% of the total part value', () => {
    expect(SALVAGE_FRACTION).toBe(0.5);
    const mp = { kind: 'weapon' as MpItemKind, refineValue: 250, imbuements: [{ propertyId: 'fire', path: 'might', value: 250 }] };
    expect(salvageValue(mp)).toBe(250); // floor(500 * 0.5)
    expect(salvageValue(undefined)).toBe(0);
  });

  it('transfer costs 10% of the value difference', () => {
    expect(TRANSFER_FRACTION).toBe(0.1);
    expect(transferCost(1000, 500)).toBe(50); // ceil(500 * 0.1)
    expect(transferCost(500, 500)).toBe(0);
  });
});

describe('Monster Parts — apex from inventory', () => {
  // The apex property's EFFECTIVE level is capped by the item's refined level AND the character level,
  // so the item must be refined to 17+ (and the character be level 17+) for the apex to fire.
  it('picks the apex attribute from an invested apex-imbued item at property level 17+', () => {
    const inv = [
      {
        invested: true,
        monsterPart: {
          kind: 'skill' as MpItemKind,
          refineValue: refinementCost(17, 'skill'),
          imbuements: [{ propertyId: 'charisma', path: 'main', value: refinementCost(17, 'skill') }],
        },
      },
    ];
    expect(monsterPartApex(inv, 17)).toBe('cha');
  });

  it('ignores an un-invested item and a below-17 apex property', () => {
    const notInvested = [
      { monsterPart: { kind: 'skill' as MpItemKind, refineValue: refinementCost(17, 'skill'), imbuements: [{ propertyId: 'strength', path: 'main', value: refinementCost(17, 'skill') }] } },
    ];
    expect(monsterPartApex(notInvested, 17)).toBe(null);
    const tooLow = [
      { invested: true, monsterPart: { kind: 'skill' as MpItemKind, refineValue: refinementCost(17, 'skill'), imbuements: [{ propertyId: 'strength', path: 'main', value: refinementCost(16, 'skill') }] } },
    ];
    expect(monsterPartApex(tooLow, 17)).toBe(null);
  });

  it('respects the character-level cap: a level-16 character gets no level-17 apex', () => {
    const inv = [
      {
        invested: true,
        monsterPart: {
          kind: 'skill' as MpItemKind,
          refineValue: refinementCost(17, 'skill'),
          imbuements: [{ propertyId: 'charisma', path: 'main', value: refinementCost(17, 'skill') }],
        },
      },
    ];
    expect(monsterPartApex(inv, 16)).toBe(null);
  });
});
