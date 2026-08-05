import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { build, content } from './_content';
import { deriveDefenses, armorSpecAccess } from '../src/rules/derive';
import { ARMOR_SPEC, armorSpecValue } from '../src/rules/armorSpec';
import type { ArmorItem, Character, InventoryItem } from '../src/rules/types';

/**
 * Armor specialization (Player Core pg. 272). The whole mechanic was missing: no field, no table,
 * and seven armorGroup records that are bare stubs.
 */
const db = content();

const wearing = (ch: Character, itemId: string, potency = 0): Character => ({
  ...ch,
  inventory: [
    { instanceId: 'arm1', itemId, quantity: 1, worn: true, ...(potency ? { runes: { potency } } : {}) } as InventoryItem,
  ],
});
const res = (ch: Character, type: string) => deriveDefenses(ch, db).resistances.find((r) => r.type === type)?.value ?? 0;

/** The first shipped armor of a group at a category. */
const armorOf = (group: string, category: string): string | undefined =>
  Object.entries(db.items).find(([, i]) => i.itemType === 'armor' && (i as ArmorItem).group === group && (i as ArmorItem).category === category)?.[0];

describe('the armor-group table', () => {
  it('covers every group that ships on an item', () => {
    const groups = new Set(
      Object.values(db.items)
        .filter((i) => i.itemType === 'armor')
        .map((i) => (i as ArmorItem).group)
        .filter(Boolean) as string[],
    );
    for (const g of groups) expect(ARMOR_SPEC[g], `no specialization entry for group "${g}"`).toBeTruthy();
  });

  it('scales with the ARMOR potency rune, not the character level', () => {
    expect(armorSpecValue('plate', 'heavy', 0)).toBe(2);
    expect(armorSpecValue('plate', 'heavy', 3)).toBe(5);
    expect(armorSpecValue('plate', 'medium', 3)).toBe(4);
    expect(armorSpecValue('skeletal', 'heavy', 2)).toBe(7); // 5 + 2
    expect(armorSpecValue('chain', 'medium', 1)).toBe(5); // 4 + 1
  });

  it('gives nothing to light, unarmored, cloth or an unknown group', () => {
    // Every printed group text defines a medium and a heavy value and no other.
    expect(armorSpecValue('plate', 'light', 3)).toBe(0);
    expect(armorSpecValue('plate', 'unarmored', 3)).toBe(0);
    expect(armorSpecValue('cloth', 'heavy', 3)).toBe(0);
    expect(armorSpecValue('not-a-group', 'heavy', 3)).toBe(0);
  });
});

describe('who gets it', () => {
  const champ = (lvl: number) => build('champion', lvl);

  it('Armor Expertise unlocks medium and heavy, and only from its own level', () => {
    expect(db.classFeatures['armor-expertise'].armorSpec).toEqual({ categories: ['medium', 'heavy'] });
    const early = armorSpecAccess(champ(1), db);
    const late = armorSpecAccess(champ(20), db);
    expect(early.categories.has('heavy')).toBe(false);
    expect(late.categories.has('heavy')).toBe(true);
    expect(late.categories.has('medium')).toBe(true);
  });

  it('a champion in plate gains slashing resistance once Armor Expertise arrives', () => {
    const plate = armorOf('plate', 'heavy');
    expect(plate).toBeTruthy();
    expect(res(wearing(champ(1), plate!), 'slashing')).toBe(0);
    expect(res(wearing(champ(20), plate!), 'slashing')).toBe(2);
    expect(res(wearing(champ(20), plate!, 3), 'slashing')).toBe(5); // + the potency rune
  });

  it('the breakdown names the armor, not the feature', () => {
    const plate = armorOf('plate', 'heavy')!;
    const d = deriveDefenses(wearing(champ(20), plate), db);
    expect(d.sources['resistance:slashing']?.some((s) => /armor specialization/i.test(s.from))).toBe(true);
  });

  it('a group whose effect is NOT a resistance grants none', () => {
    // Wood damages the ATTACKER; it is not a defence.
    const wood = armorOf('wood', 'medium') ?? armorOf('wood', 'heavy');
    if (!wood) return;
    const d = deriveDefenses(wearing(champ(20), wood), db);
    expect(d.resistances.every((r) => r.value === 0 || !/piercing/.test(r.type) || r.value !== armorSpecValue('wood', 'heavy', 0))).toBe(true);
  });

  it('chain lands under the critical-hits key', () => {
    const chain = armorOf('chain', 'heavy') ?? armorOf('chain', 'medium');
    if (!chain) return;
    const cat = (db.items[chain] as ArmorItem).category;
    expect(res(wearing(champ(20), chain), 'critical-hits')).toBe(armorSpecValue('chain', cat, 0));
  });

  it('LIGHT armor gains nothing even from a record that unlocks it', () => {
    // Unshaken in Iron says "the armor specialization effect of light armor", but no group defines a
    // light value. Recorded faithfully rather than inventing one.
    expect(db.feats['unshaken-in-iron'].armorSpec?.categories).toEqual(['light']);
    const light = armorOf('leather', 'light');
    if (!light) return;
    const c = { ...champ(20), feats: [...champ(20).feats, { featId: 'unshaken-in-iron', level: 8 }] };
    expect(res(wearing(c, light!), 'bludgeoning')).toBe(0);
  });

  it('Hellknight Preferment is scoped to three named armors and adds 1', () => {
    const a = db.feats['hellknight-preferment'].armorSpec!;
    expect(a.items).toEqual(['hellknight-breastplate', 'hellknight-half-plate', 'hellknight-plate']);
    expect(a.bonus).toBe(1);
    const base = build('fighter', 20);
    const c = { ...base, feats: [...base.feats, { featId: 'hellknight-preferment', level: 6 }] };
    // Hellknight Plate is heavy plate: 2 + 0 potency + 1 from the feat.
    expect(res(wearing(c, 'hellknight-plate'), 'slashing')).toBe(3);
    // A DIFFERENT plate armor is not one of the three it names.
    const other = armorOf('plate', 'heavy');
    if (other && other !== 'hellknight-plate') {
      const fighterNoExpertise = { ...build('fighter', 10), feats: [{ featId: 'hellknight-preferment', level: 6 }] };
      expect(armorSpecAccess(fighterNoExpertise, db).items.has(other)).toBe(false);
    }
  });

  it('Armor Specialist unlocks every category the character is proficient in', () => {
    expect(db.feats['armor-specialist'].armorSpec).toEqual({ anyProficient: true });
    const base = build('rogue', 20); // trained in light, untrained in heavy
    const c = { ...base, feats: [...base.feats, { featId: 'armor-specialist', level: 6 }] };
    const access = armorSpecAccess(c, db);
    expect(access.categories.has('light')).toBe(true);
    expect(c.proficiencies.defenses.heavy).toBe('untrained');
    expect(access.categories.has('heavy')).toBe(false); // "you are proficient with"

    // A class that IS trained in medium gets a real number out of it.
    const f = build('fighter', 20);
    const fs = { ...f, feats: [...f.feats, { featId: 'armor-specialist', level: 6 }] };
    const medPlate = armorOf('plate', 'medium');
    if (medPlate) expect(res(wearing(fs, medPlate), 'slashing')).toBe(1);
  });

  it('nothing at all without a granting record', () => {
    const plate = armorOf('plate', 'heavy')!;
    const rogue = build('rogue', 20);
    expect(armorSpecAccess(rogue, db).categories.size).toBe(0);
    expect(res(wearing(rogue, plate), 'slashing')).toBe(0);
  });
});

describe('items that modify the effect', () => {
  it('Highhelm Stronghold Plate extends its resistance to piercing as well', () => {
    expect((db.items['highhelm-stronghold-plate'] as ArmorItem).armorSpecExtraTypes).toEqual(['piercing']);
    const c = wearing(build('champion', 20), 'highhelm-stronghold-plate');
    expect(res(c, 'slashing')).toBe(2);
    expect(res(c, 'piercing')).toBe(2);
  });

  it('Reinforced Surcoat raises the CHAIN value by 2 and nothing else', () => {
    expect(db.items['reinforced-surcoat'].armorSpecBonus).toEqual({ group: 'chain', value: 2 });
    const chain = armorOf('chain', 'heavy') ?? armorOf('chain', 'medium');
    const plate = armorOf('plate', 'heavy')!;
    const withSurcoat = (itemId: string): Character => ({
      ...build('champion', 20),
      inventory: [
        { instanceId: 'arm1', itemId, quantity: 1, worn: true } as InventoryItem,
        { instanceId: 'sur1', itemId: 'reinforced-surcoat', quantity: 1, worn: true } as InventoryItem,
      ],
    });
    if (chain) {
      const cat = (db.items[chain] as ArmorItem).category;
      expect(res(withSurcoat(chain), 'critical-hits')).toBe(armorSpecValue('chain', cat, 0) + 2);
    }
    // Scoped to the chain group — a plate wearer gains nothing from the surcoat.
    expect(res(withSurcoat(plate), 'slashing')).toBe(2);
  });
});

describe('the data survives a rebuild', () => {
  it('every armorSpec field ships a matching effect-backfill row', () => {
    const backfill = JSON.parse(readFileSync('scripts/data/effect-backfill.json', 'utf8')) as {
      category: string;
      id: string;
      field: string;
      value: unknown;
    }[];
    const expected = [
      ['classFeatures', 'armor-expertise', 'armorSpec'],
      ['feats', 'armor-specialist', 'armorSpec'],
      ['feats', 'unshaken-in-iron', 'armorSpec'],
      ['feats', 'hellknight-preferment', 'armorSpec'],
      ['items', 'highhelm-stronghold-plate', 'armorSpecExtraTypes'],
      ['items', 'reinforced-surcoat', 'armorSpecBonus'],
    ] as const;
    for (const [category, id, field] of expected) {
      const rows = backfill.filter((e) => e.category === category && e.id === id && e.field === field);
      expect(rows, `${category}/${id}.${field} has no backfill row — it dies at the next data rebuild`).toHaveLength(1);
      expect(rows[0].value).toEqual((db as never as Record<string, Record<string, Record<string, unknown>>>)[category][id][field]);
    }
  });
});
