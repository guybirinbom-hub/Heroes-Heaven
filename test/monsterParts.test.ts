import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveStrike, deriveDefenses, deriveShield, resilientSaveBonus, deriveAc } from '../src/rules/derive';
import {
  weaponRefinement,
  armorRefinement,
  shieldRefinement,
  senseSkillRefinement,
  refinementCost,
  resolvePath,
  getMpProperty,
  propertiesForKind,
} from '../src/rules/monsterParts';
import { monsterPartsEnabled } from '../src/rules/sources';
import { MONSTER_PART_PROPERTIES } from '../src/rules/monsterParts';
import type { Character, InventoryItem } from '../src/rules/types';

const db = content();
const findWeapon = (die: string) =>
  Object.keys(db.items).find((id) => db.items[id].itemType === 'weapon' && (db.items[id] as { damage: { die: string } }).damage.die === die)!;
const findArmor = () => Object.keys(db.items).find((id) => db.items[id].itemType === 'armor')!;
const findShield = () => Object.keys(db.items).find((id) => db.items[id].itemType === 'shield')!;

describe('Monster Parts — refinement track', () => {
  it('weapon refinement thresholds (Table 4A)', () => {
    expect(weaponRefinement(1)).toMatchObject({ attack: 0, extraDice: 0, imbueSlots: 0 });
    expect(weaponRefinement(2)).toMatchObject({ attack: 1, extraDice: 0, imbueSlots: 1 });
    expect(weaponRefinement(4)).toMatchObject({ attack: 1, extraDice: 1 });
    expect(weaponRefinement(12)).toMatchObject({ attack: 2, extraDice: 2, imbueSlots: 2 });
    expect(weaponRefinement(19)).toMatchObject({ attack: 3, extraDice: 3, imbueSlots: 3 });
  });
  it('armor refinement thresholds (Table 4B)', () => {
    expect(armorRefinement(5)).toMatchObject({ ac: 1, saves: 0, imbueSlots: 1 });
    expect(armorRefinement(8)).toMatchObject({ ac: 1, saves: 1 });
    expect(armorRefinement(20)).toMatchObject({ ac: 3, saves: 3, imbueSlots: 3 });
  });
  it('shield refinement floors (Table 4C) + imbuing at level 4', () => {
    expect(shieldRefinement(3)).toMatchObject({ hardness: 5, hp: 30, bt: 15, imbueSlots: 0 });
    expect(shieldRefinement(4).imbueSlots).toBe(1);
    expect(shieldRefinement(20)).toMatchObject({ hardness: 18, hp: 108, bt: 54 });
  });
  it('perception/skill item bonus (Tables 4D/4E)', () => {
    expect(senseSkillRefinement(3)).toMatchObject({ bonus: 1, imbueSlots: 1 });
    expect(senseSkillRefinement(17).bonus).toBe(3);
  });
  it('refinement cost by level + kind (Table 3)', () => {
    expect(refinementCost(2, 'weapon')).toBe(35);
    expect(refinementCost(2, 'shield')).toBe(20); // shields use the cheaper column
    expect(refinementCost(20, 'armor')).toBe(70000);
  });
});

describe('Monster Parts — imbued property resolution', () => {
  it('Fire Might damage scales cumulatively by level', () => {
    const fire = getMpProperty('fire')!;
    const might = fire.paths.find((p) => p.id === 'might')!;
    expect(resolvePath(might, 4).addDamage).toMatchObject({ flat: 1, type: 'fire' });
    expect(resolvePath(might, 7).addDamage).toMatchObject({ dice: 1, die: 'd4', type: 'fire' });
    expect(resolvePath(might, 10).addDamage).toMatchObject({ dice: 1, die: 'd6', type: 'fire' });
    expect(resolvePath(might, 20).addDamage).toMatchObject({ dice: 1, die: 'd8', type: 'fire' });
  });
  it('Fire Technique grants persistent damage that scales', () => {
    const tech = getMpProperty('fire')!.paths.find((p) => p.id === 'technique')!;
    expect(resolvePath(tech, 4).persistentDamage).toMatchObject({ flat: 1, type: 'fire', persistent: true });
    expect(resolvePath(tech, 18).persistentDamage).toMatchObject({ dice: 1, die: 'd10', persistent: true });
  });
  it('riders accumulate all entries at or below the level', () => {
    const might = getMpProperty('fire')!.paths.find((p) => p.id === 'might')!;
    expect(resolvePath(might, 20).riders.length).toBe(7);
    expect(resolvePath(might, 4).riders.length).toBe(1);
  });
  it('Energy Resistant applies to armor + shields and offers energy choices', () => {
    const er = getMpProperty('energy-resistant')!;
    expect(er.appliesTo).toEqual(expect.arrayContaining(['armor', 'shield']));
    expect(er.resistance?.choices).toContain('fire');
    expect(propertiesForKind('armor').some((p) => p.id === 'energy-resistant')).toBe(true);
  });
});

describe('Monster Parts — full property catalog', () => {
  it('loads the complete catalog (exemplars + generated)', () => {
    expect(MONSTER_PART_PROPERTIES.length).toBeGreaterThanOrEqual(26);
    const ids = new Set(MONSTER_PART_PROPERTIES.map((p) => p.id));
    for (const id of ['fire', 'energy-resistant', 'acid', 'cold', 'holy', 'unholy', 'void', 'vitality', 'bane', 'wild', 'sensory', 'strength', 'winged', 'sturdy'])
      expect(ids.has(id)).toBe(true);
  });
  it('every property has at least one path with ascending levels', () => {
    for (const p of MONSTER_PART_PROPERTIES) {
      expect(p.paths.length).toBeGreaterThan(0);
      for (const path of p.paths) {
        const levels = path.levels.map((l) => l.level);
        expect([...levels].sort((a, b) => a - b)).toEqual(levels.length ? levels : []);
      }
    }
  });
  it('a generated weapon property resolves cumulative damage (Acid Might)', () => {
    const acid = MONSTER_PART_PROPERTIES.find((p) => p.id === 'acid')!;
    const might = acid.paths.find((p) => p.id === 'might')!;
    expect(resolvePath(might, 6).addDamage).toMatchObject({ dice: 1, die: 'd4', type: 'acid' });
    expect(resolvePath(might, 18).addDamage).toMatchObject({ dice: 1, die: 'd8', type: 'acid' });
  });
  it('apex skill items carry an apexAbility; Sensory carries passive senses', () => {
    expect(MONSTER_PART_PROPERTIES.find((p) => p.id === 'strength')!.apexAbility).toBe('str');
    expect(MONSTER_PART_PROPERTIES.find((p) => p.id === 'sensory')!.senses!.length).toBeGreaterThan(0);
  });
});

describe('Monster Parts — derive integration', () => {
  const refinedWeapon = (refinedLevel: number, imbuements: InventoryItem['monsterPart']['imbuements']): InventoryItem => ({
    instanceId: 'inv-mp',
    itemId: findWeapon('d8'),
    quantity: 1,
    equipped: true,
    monsterPart: { refinedLevel, imbuements },
  });

  it('a refined weapon gets an item bonus to attack + extra dice (no runes needed)', () => {
    const ch = build('fighter', 12, { keyAbility: 'str' });
    const strike = deriveStrike(ch, db, refinedWeapon(12, []))!;
    expect(strike.potencyBonus).toBe(2); // level 12 → +2 attack
    expect(strike.strikingDice).toBe(2); // level 12 → greater striking (2 extra dice)
    expect(strike.damage.startsWith('3d8')).toBe(true); // base 1 + 2 extra dice
  });

  it('an imbued weapon adds the property damage to its Strike', () => {
    const ch = build('fighter', 12, { keyAbility: 'str' });
    const strike = deriveStrike(ch, db, refinedWeapon(12, [{ propertyId: 'fire', path: 'might', level: 10 }]))!;
    expect(strike.damage).toContain('plus 1d6 fire');
  });

  it('imbued persistent damage (Technique) shows as a per-hit persistent term', () => {
    const ch = build('fighter', 12, { keyAbility: 'str' });
    const strike = deriveStrike(ch, db, refinedWeapon(12, [{ propertyId: 'fire', path: 'technique', level: 8 }]))!;
    expect(strike.damage).toContain('persistent fire');
  });

  it('Energy Resistant on a worn armor grants a resistance equal to the property level', () => {
    const ch = build('fighter', 8, { keyAbility: 'str' });
    const armor: InventoryItem = {
      instanceId: 'inv-arm',
      itemId: findArmor(),
      quantity: 1,
      worn: true,
      invested: true,
      monsterPart: { imbuements: [{ propertyId: 'energy-resistant', level: 5, choice: 'fire' }] },
    };
    const ch2: Character = { ...ch, inventory: [armor] };
    const def = deriveDefenses(ch2, db);
    expect(def.resistances).toContainEqual({ type: 'fire', value: 5 });
  });

  it('refined armor grants AC + save item bonuses', () => {
    const ch = build('fighter', 18, { keyAbility: 'str' });
    const armor: InventoryItem = { instanceId: 'inv-arm', itemId: findArmor(), quantity: 1, worn: true, monsterPart: { refinedLevel: 18 } };
    const ch2: Character = { ...ch, inventory: [armor] };
    expect(resilientSaveBonus(ch2, db)).toBe(2); // level 18 armor → +2 saves (greater resilient)
    // AC includes the +3 refinement item bonus (level 18 armor potency-equivalent).
    const baseAc = deriveAc({ ...ch, inventory: [{ ...armor, monsterPart: undefined }] }, db).value;
    expect(deriveAc(ch2, db).value).toBe(baseAc + 3);
  });

  it('refined shield raises Hardness/HP/BT', () => {
    const ch = build('fighter', 16, { keyAbility: 'str' });
    const shield: InventoryItem = { instanceId: 'inv-shd', itemId: findShield(), quantity: 1, equipped: true, monsterPart: { refinedLevel: 16 } };
    const info = deriveShield({ ...ch, inventory: [shield] }, db)!;
    expect(info.hardness).toBeGreaterThanOrEqual(14); // level 16 → hardness 14
  });
});

describe('Monster Parts — subsystem gate', () => {
  const hb = { s1: { name: 'Battlezoo Monster Parts', unlocks: ['monsterParts'] }, s2: { name: 'Other', unlocks: [] } };
  it('off unless the unlocking Source is in enabledSources', () => {
    expect(monsterPartsEnabled({ enabledSources: undefined }, hb)).toBe(false);
    expect(monsterPartsEnabled({ enabledSources: ['Pathfinder Player Core'] }, hb)).toBe(false);
    expect(monsterPartsEnabled({ enabledSources: ['Battlezoo Monster Parts'] }, hb)).toBe(true);
  });
  it('resolves by the Source’s current name (rename-safe via the live Sources map)', () => {
    const renamed = { s1: { name: 'My Parts Book', unlocks: ['monsterParts'] } };
    expect(monsterPartsEnabled({ enabledSources: ['My Parts Book'] }, renamed)).toBe(true);
  });
});
