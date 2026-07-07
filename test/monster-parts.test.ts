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
  MONSTER_PART_TAGS,
  MONSTER_PART_TAG_SET,
  propertyRequirementTags,
  availableMonsterParts,
  hasMatchingPart,
  salvageToMonsterPart,
  mpApplied,
  type MpProperty,
  type MpPath,
} from '../src/rules/monsterParts';
import type { ContentDatabase, InventoryItem, Item, MpItemKind } from '../src/rules/types';

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

// Locks the machine-readable damage/latch/apex values re-verified in the 2026-07 effect-correctness
// audit against Monster Parts - Remaster Conversion v2.md. Each covers a different subtlety the resolver
// depends on (die-skip progressions, persistent vs per-hit, ignore-resistance latch levels, apex level,
// Chaotic/Lawful path reuse).
describe('Monster Parts — audit spot-checks (effect correctness vs ruleset)', () => {
  const path = (id: string, pathId: string) => getMpProperty(id)!.paths.find((p) => p.id === pathId)!;

  it('Acid Might: +1 (L4) → 1d4 (L6) → 1d6 (L8) holds through L14, then 1d8 (L18); ignores resistance from L12', () => {
    const might = path('acid', 'might');
    expect(dmgAt(might, 4).addDamage).toMatchObject({ flat: 1, type: 'acid' });
    expect(dmgAt(might, 8).addDamage).toMatchObject({ dice: 1, die: 'd6', type: 'acid' });
    // L14 has a crit-armor rider but does NOT change the per-hit die (still 1d6).
    expect(dmgAt(might, 14).addDamage).toMatchObject({ dice: 1, die: 'd6', type: 'acid' });
    expect(dmgAt(might, 18).addDamage).toMatchObject({ dice: 1, die: 'd8', type: 'acid' });
    expect(dmgAt(might, 11).ignoreResistance).toBe(false);
    expect(dmgAt(might, 12).ignoreResistance).toBe(true);
  });

  it('Acid Technique: persistent 1 (L4) → 1d6 (L8) → 1d8 (L14) → 1d10 (L18)', () => {
    const tech = path('acid', 'technique');
    expect(dmgAt(tech, 4).persistentDamage).toMatchObject({ flat: 1, type: 'acid', persistent: true });
    expect(dmgAt(tech, 8).persistentDamage).toMatchObject({ dice: 1, die: 'd6', type: 'acid', persistent: true });
    expect(dmgAt(tech, 14).persistentDamage).toMatchObject({ dice: 1, die: 'd8', type: 'acid', persistent: true });
    expect(dmgAt(tech, 18).persistentDamage).toMatchObject({ dice: 1, die: 'd10', type: 'acid', persistent: true });
  });

  it('Bane Technique deals persistent BLEED (not the base type) and skips 1d4', () => {
    const tech = path('bane', 'technique');
    expect(dmgAt(tech, 2).persistentDamage).toMatchObject({ flat: 1, type: 'bleed', persistent: true });
    // L6 jumps straight to 1d6 (no 1d4 step), then 1d8 (L12), 1d10 (L16).
    expect(dmgAt(tech, 6).persistentDamage).toMatchObject({ dice: 1, die: 'd6', type: 'bleed', persistent: true });
    expect(dmgAt(tech, 12).persistentDamage).toMatchObject({ dice: 1, die: 'd8', type: 'bleed', persistent: true });
    expect(dmgAt(tech, 16).persistentDamage).toMatchObject({ dice: 1, die: 'd10', type: 'bleed', persistent: true });
    // The separate per-hit base-type bump appears at L4 (untyped → the weapon's type).
    expect(dmgAt(tech, 4).addDamage).toMatchObject({ flat: 1, type: 'untyped' });
  });

  it('Cold Technique persistent tops out at 1d4 (L18) — the weakest persistent track', () => {
    const tech = path('cold', 'technique');
    expect(dmgAt(tech, 4).persistentDamage).toMatchObject({ flat: 1, type: 'cold', persistent: true });
    expect(dmgAt(tech, 18).persistentDamage).toMatchObject({ dice: 1, die: 'd4', type: 'cold', persistent: true });
    // No addDamage on this path (all riders are Speed penalties / freeze).
    expect(dmgAt(tech, 20).addDamage).toBeUndefined();
  });

  it('Holy Might: spirit +1 (L6) → 1d4 (L8) → 1d6 (L10) → 1d8 (L18); ignore-resistance latch at L14', () => {
    const might = path('holy', 'might');
    expect(dmgAt(might, 6).addDamage).toMatchObject({ flat: 1, type: 'spirit' });
    expect(dmgAt(might, 10).addDamage).toMatchObject({ dice: 1, die: 'd6', type: 'spirit' });
    expect(dmgAt(might, 18).addDamage).toMatchObject({ dice: 1, die: 'd8', type: 'spirit' });
    expect(dmgAt(might, 13).ignoreResistance).toBe(false);
    expect(dmgAt(might, 14).ignoreResistance).toBe(true);
  });

  it('Holy Technique persistent goes 1 (L8) → 1d6 (L10) → 1d10 (L18), skipping 1d8', () => {
    const tech = path('holy', 'technique');
    expect(dmgAt(tech, 8).persistentDamage).toMatchObject({ flat: 1, type: 'spirit', persistent: true });
    expect(dmgAt(tech, 10).persistentDamage).toMatchObject({ dice: 1, die: 'd6', type: 'spirit', persistent: true });
    expect(dmgAt(tech, 18).persistentDamage).toMatchObject({ dice: 1, die: 'd10', type: 'spirit', persistent: true });
  });

  it('Chaotic/Lawful reuse Unholy/Holy paths and resolve the same spirit damage', () => {
    const chaoticMight = getMpProperty('chaotic')!.paths.find((p) => p.id === 'might')!;
    const unholyMight = path('unholy', 'might');
    expect(dmgAt(chaoticMight, 18).addDamage).toEqual(dmgAt(unholyMight, 18).addDamage);
    expect(dmgAt(chaoticMight, 18).addDamage).toMatchObject({ dice: 1, die: 'd8', type: 'spirit' });
    const lawfulTech = getMpProperty('lawful')!.paths.find((p) => p.id === 'technique')!;
    const holyTech = path('holy', 'technique');
    expect(dmgAt(lawfulTech, 18).persistentDamage).toEqual(dmgAt(holyTech, 18).persistentDamage);
  });

  it('Vitality (holy/vitality weapon) scales from L2 on Might and carries persistent from L2 on Technique', () => {
    const might = path('vitality', 'might');
    expect(dmgAt(might, 2).addDamage).toMatchObject({ flat: 1, type: 'vitality' });
    expect(dmgAt(might, 6).addDamage).toMatchObject({ dice: 1, die: 'd6', type: 'vitality' });
    expect(dmgAt(might, 9).ignoreResistance).toBe(false);
    expect(dmgAt(might, 10).ignoreResistance).toBe(true); // Vitality latches at L10, earlier than the L12 norm.
    const tech = path('vitality', 'technique');
    expect(dmgAt(tech, 2).persistentDamage).toMatchObject({ flat: 1, type: 'vitality', persistent: true });
    expect(dmgAt(tech, 12).persistentDamage).toMatchObject({ dice: 1, die: 'd8', type: 'vitality', persistent: true });
  });

  it('Wild Might deals untyped (rolled type) damage and skips 1d4→1d8 correctly', () => {
    const might = path('wild', 'might');
    expect(dmgAt(might, 4).addDamage).toMatchObject({ flat: 1, type: 'untyped' });
    expect(dmgAt(might, 8).addDamage).toMatchObject({ dice: 1, die: 'd6', type: 'untyped' });
    // No 1d?? between L8 and L18 — stays 1d6 at L12/L14 (only the ignore-resistance latch changes).
    expect(dmgAt(might, 14).addDamage).toMatchObject({ dice: 1, die: 'd6', type: 'untyped' });
    expect(dmgAt(might, 12).ignoreResistance).toBe(true);
    expect(dmgAt(might, 18).addDamage).toMatchObject({ dice: 1, die: 'd8', type: 'untyped' });
  });

  it('Sonic has no Magic path (only Might + Technique)', () => {
    const sonic = getMpProperty('sonic')!;
    expect(sonic.paths.map((p) => p.id).sort()).toEqual(['might', 'technique']);
  });

  it('Force/Mental/Void Might latch ignore-resistance at L12 (with a mid non-scaling crit rider level)', () => {
    for (const id of ['force', 'mental', 'void']) {
      const might = path(id, 'might');
      expect(dmgAt(might, 11).ignoreResistance, id).toBe(false);
      expect(dmgAt(might, 12).ignoreResistance, id).toBe(true);
      // L10 carries a crit rider but keeps the 1d6 per-hit die from L8.
      expect(dmgAt(might, 10).addDamage, id).toMatchObject({ dice: 1, die: 'd6' });
    }
  });

  it('Every apex skill/perception property applies its boost exactly at L17, not L16', () => {
    for (const id of ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']) {
      const main = getMpProperty(id)!.paths[0];
      expect(dmgAt(main, 16).riders.some((r) => /apex/i.test(r.text)), id).toBe(false);
      expect(dmgAt(main, 17).riders.some((r) => /apex/i.test(r.text)), id).toBe(true);
    }
  });

  it('Sensory grants its passive senses at the ruleset levels (L6/L12/L16/L18/L20)', () => {
    const sensory = getMpProperty('sensory')!;
    expect(sensory.senses).toEqual([
      { level: 6, sense: 'low-light vision' },
      { level: 12, sense: 'darkvision' },
      { level: 16, sense: '30-foot imprecise scent' },
      { level: 18, sense: 'greater darkvision' },
      { level: 20, sense: '6th-rank truesight (constant)' },
    ]);
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

describe('Monster Parts — tag vocabulary', () => {
  it('groups the tag vocabulary and covers the brief-listed tags', () => {
    // Every group has a name + at least one tag; all tags are lowercase non-empty.
    for (const g of MONSTER_PART_TAGS) {
      expect(g.group).toBeTruthy();
      expect(g.tags.length).toBeGreaterThan(0);
      for (const t of g.tags) {
        expect(t).toBe(t.toLowerCase());
        expect(t.trim()).toBe(t);
      }
    }
    // Energy/damage types.
    for (const t of ['acid', 'cold', 'electricity', 'fire', 'force', 'mental', 'poison', 'sonic', 'spirit', 'vitality', 'void', 'bludgeoning', 'piercing', 'slashing'])
      expect(MONSTER_PART_TAG_SET.has(t), t).toBe(true);
    // Traits, attributes, senses, defenses, a few creature types + skills.
    for (const t of ['holy', 'unholy', 'strength', 'charisma', 'fly', 'low-light vision', 'darkvision', 'scent', 'greater darkvision', 'truesight', 'hardness', 'precision', 'dragon', 'undead', 'athletics', 'stealth'])
      expect(MONSTER_PART_TAG_SET.has(t), t).toBe(true);
  });

  it('the flat set has no duplicates across groups', () => {
    const flat = MONSTER_PART_TAGS.flatMap((g) => g.tags);
    expect(new Set(flat).size).toBe(flat.length);
  });
});

describe('Monster Parts — requirement tags + match hint', () => {
  it('maps energy/apex/sense properties to their requirement tag(s)', () => {
    expect(propertyRequirementTags('fire')).toEqual(['fire']);
    expect(propertyRequirementTags('charisma')).toEqual(['charisma']);
    expect(propertyRequirementTags('winged')).toEqual(['fly']);
    expect(propertyRequirementTags('sturdy')).toEqual(['hardness']);
    expect(propertyRequirementTags('fortification')).toEqual(['precision']);
    expect(propertyRequirementTags('vitality')).toEqual(['vitality', 'holy']);
    // Bane/Spell/Wild have no fixed requirement → empty (always satisfied).
    expect(propertyRequirementTags('bane')).toEqual([]);
    expect(propertyRequirementTags('wild')).toEqual([]);
  });

  it('hasMatchingPart is informational: a fixed requirement needs a matching tag; no-requirement props always match', () => {
    expect(hasMatchingPart('fire', ['fire', 'cold'])).toBe(true);
    expect(hasMatchingPart('fire', ['acid'])).toBe(false);
    expect(hasMatchingPart('fire', new Set(['FIRE'.toLowerCase()]))).toBe(true);
    // vitality matches on EITHER of its tags.
    expect(hasMatchingPart('vitality', ['holy'])).toBe(true);
    // No-requirement properties are always a match, even with an empty bag.
    expect(hasMatchingPart('bane', [])).toBe(true);
    expect(hasMatchingPart('wild', [])).toBe(true);
  });
});

describe('Monster Parts — available parts from inventory', () => {
  const partDef = (id: string, gp: number, tags: string[]): Item => ({
    id,
    name: id,
    itemType: 'treasure',
    value: { gp },
    level: 0,
    price: { gp },
    bulk: 0,
    traits: [],
    rarity: 'common',
    description: '',
    isMonsterPart: true,
    monsterPartTags: tags,
  });
  const plain = (id: string, gp: number): Item => ({
    id, name: id, itemType: 'equipment', level: 0, price: { gp }, bulk: 0, traits: [], rarity: 'common', description: '',
  });

  it('sums gp value (price × qty) and unions tags of isMonsterPart items only', () => {
    const items: Record<string, Item> = {
      'fire-scale': partDef('fire-scale', 100, ['fire']),
      'ice-gland': partDef('ice-gland', 50, ['cold', 'acid']),
      longsword: plain('longsword', 15),
    };
    const inventory: InventoryItem[] = [
      { instanceId: 'i1', itemId: 'fire-scale', quantity: 2 }, // 200 gp
      { instanceId: 'i2', itemId: 'ice-gland', quantity: 1 }, // 50 gp
      { instanceId: 'i3', itemId: 'longsword', quantity: 1 }, // NOT a part
    ];
    const content = { items } as unknown as ContentDatabase;
    const avail = availableMonsterParts(inventory, content);
    expect(avail.totalGp).toBe(250);
    expect(new Set(avail.tags)).toEqual(new Set(['fire', 'cold', 'acid']));
    // The hint composes over the computed tags.
    expect(hasMatchingPart('fire', avail.tags)).toBe(true);
    expect(hasMatchingPart('electricity', avail.tags)).toBe(false);
  });

  it('a tagless monster part still contributes value (and reads as a part)', () => {
    const items: Record<string, Item> = { salvage: partDef('salvage', 300, []) };
    const inventory: InventoryItem[] = [{ instanceId: 'i1', itemId: 'salvage', quantity: 1 }];
    const avail = availableMonsterParts(inventory, { items } as unknown as ContentDatabase);
    expect(avail.totalGp).toBe(300);
    expect(avail.tags).toEqual([]);
  });

  it('accepts a resolver function too, and tolerates an empty/undefined inventory', () => {
    const def = partDef('p', 40, ['void']);
    const avail = availableMonsterParts([{ instanceId: 'i1', itemId: 'p', quantity: 1 }], (id) => (id === 'p' ? def : undefined));
    expect(avail).toEqual({ totalGp: 40, tags: ['void'] });
    expect(availableMonsterParts(undefined, { items: {} } as unknown as ContentDatabase)).toEqual({ totalGp: 0, tags: [] });
  });
});

describe('Monster Parts — salvage to a generic part item', () => {
  it('returns a generic isMonsterPart item worth 50% of the total, with no tags', () => {
    const mp = { kind: 'weapon' as MpItemKind, refineValue: 250, imbuements: [{ propertyId: 'fire', path: 'might', value: 250 }] };
    const item = salvageToMonsterPart(mp, 'longsword');
    expect(item).not.toBeNull();
    expect(item!.isMonsterPart).toBe(true);
    expect(item!.monsterPartTags).toEqual([]);
    expect(item!.price).toEqual({ gp: 250 }); // floor(500 * 0.5)
    expect(item!.itemType).toBe('treasure');
    expect(item!.name).toMatch(/longsword/);
    // Distinct ids per salvage.
    const again = salvageToMonsterPart(mp);
    expect(again!.id).not.toBe(item!.id);
  });

  it('returns null when there is nothing to recover', () => {
    expect(salvageToMonsterPart(undefined)).toBeNull();
    expect(salvageToMonsterPart({ kind: 'weapon', refineValue: 0, imbuements: [] })).toBeNull();
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

describe('Monster Parts — applied-effect readout (item description)', () => {
  it('returns null for an un-refined / absent blob', () => {
    expect(mpApplied(undefined, 'slashing', 20)).toBeNull();
    const empty = mpApplied({ kind: 'weapon', refineValue: 0, imbuements: [] }, 'slashing', 20);
    expect(empty?.refineLines).toEqual([]);
    expect(empty?.imbuements).toEqual([]);
  });

  it('lists weapon refinement benefits + imbue slots at the refined level', () => {
    const a = mpApplied({ kind: 'weapon', refineValue: refinementCost(12, 'weapon'), imbuements: [] }, 'slashing', 20)!;
    expect(a.refinedLevel).toBe(12);
    // At L12: +2 attack (L10), +2 dice (L12), 2 imbue slots (L10).
    expect(a.refineLines.some((l) => /\+2 item bonus to attack/.test(l))).toBe(true);
    expect(a.refineLines.some((l) => /\+2 weapon damage dice/.test(l))).toBe(true);
    expect(a.refineLines.some((l) => /2 imbuing slots/.test(l))).toBe(true);
  });

  it('shows an imbued property effect at its effective (capped) level', () => {
    const a = mpApplied(
      {
        kind: 'weapon',
        refineValue: refinementCost(10, 'weapon'),
        imbuements: [{ propertyId: 'fire', path: 'magic', value: refinementCost(10, 'weapon') }],
      },
      'slashing',
      20,
    )!;
    expect(a.imbuements).toHaveLength(1);
    expect(a.imbuements[0].name.toLowerCase()).toContain('fire');
    expect(a.imbuements[0].level).toBeGreaterThan(0);
    expect(a.imbuements[0].effects.some((e) => /fire/i.test(e))).toBe(true);
  });

  it('caps an imbued property at the character level', () => {
    const highValue = refinementCost(12, 'weapon');
    const a = mpApplied(
      { kind: 'weapon', refineValue: highValue, imbuements: [{ propertyId: 'fire', path: 'magic', value: highValue }] },
      'slashing',
      5,
    )!;
    // Refined level itself is capped at the character's level (5).
    expect(a.refinedLevel).toBe(5);
    expect(a.imbuements[0].level).toBeLessThanOrEqual(5);
  });
});
